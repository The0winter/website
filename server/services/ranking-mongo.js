// Keep the native MongoDB path in the database too: the web server receives
// one page, instead of every book followed by a second remote statistics read.
export async function rankedMongoBooks(Book, filter, period, direction, skip, limit, projection) {
  const pipeline = [{$match: filter}];
  if (period) pipeline.push({$lookup: {
    from: 'readdailies', localField: '_id', foreignField: 'bookId', as: 'rankingPeriod',
    pipeline: [{$match: {day: {$gte: period.start, $lte: period.today}}},
      {$group: {_id: null, views: {$sum: '$views'}}}],
  }});
  pipeline.push(
    {$set: {
      rankingViews: {$max: [0, {$ifNull: [period ? {$first: '$rankingPeriod.views'} : '$views', 0]}]},
      rankingRating: {$min: [5, {$max: [0, {$ifNull: ['$rating', 0]}]}]},
    }},
    {$setWindowFields: {output: {rankingMaxViews: {$max: '$rankingViews', window: {documents: ['unbounded', 'unbounded']}}}}},
    {$set: {rankingScore: {$add: [
      {$cond: [{$gt: ['$rankingMaxViews', 0]}, {$multiply: [80, {$divide: ['$rankingViews', '$rankingMaxViews']}]}, 0]},
      {$multiply: [4, '$rankingRating']},
    ]}}},
    {$facet: {
      rows: [{$sort: {rankingScore: direction, rankingViews: direction, rankingRating: direction, _id: 1}},
        {$skip: skip}, {$limit: limit}, {$unset: ['rankingPeriod', 'rankingRating', 'rankingMaxViews']},
        ...(projection ? [{$project: projection}] : [])],
      total: [{$count: 'count'}],
    }},
  );
  const [result] = await Book.aggregate(pipeline).option({maxTimeMS: 3000});
  return {rows: result?.rows ?? [], total: result?.total[0]?.count ?? 0};
}
