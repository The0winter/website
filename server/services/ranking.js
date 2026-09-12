import {dayKey} from './content.js';

// Ranking pages opt into these sorts; ordinary discovery sorts stay unchanged.
export const rankingViewFields = Object.freeze({
  rank_day: 'daily_views', rank_week: 'weekly_views',
  rank_month: 'monthly_views', rank_total: 'views',
});

export function rankingPipeline(filter, orderBy, order, skip, limit, now = new Date()) {
  if (!Object.hasOwn(rankingViewFields, orderBy)) throw new Error('Unknown ranking period');
  const field = rankingViewFields[orderBy], direction = order === 'asc' ? 1 : -1;
  const today = dayKey(now), calendar = new Date(today + 'T00:00:00Z');
  calendar.setUTCDate(calendar.getUTCDate() - ((calendar.getUTCDay() + 6) % 7));
  const start = orderBy === 'rank_week' ? calendar.toISOString().slice(0, 10)
    : orderBy === 'rank_month' ? today.slice(0, 7) + '-01' : today;
  const period = orderBy === 'rank_total' ? [] : [
    // Read receipts are durable and deduplicated. Derive calendar periods in
    // China time directly, so rankings do not depend on the statistics worker.
    {$lookup: {from: 'readdailies', localField: '_id', foreignField: 'bookId', pipeline: [
      {$match: {day: {$gte: start, $lte: today}}},
      {$group: {_id: null, views: {$sum: '$views'}}},
    ], as: 'rankingReads'}},
  ];
  return [
    {$match: filter},
    ...period,
    {$set: {
      rankingViews: {$max: [0, {$ifNull: [orderBy === 'rank_total' ? `$${field}` : {$arrayElemAt: ['$rankingReads.views', 0]}, 0]}]},
      rankingRating: {$min: [5, {$max: [0, {$ifNull: ['$rating', 0]}]}]},
    }},
    // Normalize the entire selected category BEFORE limiting or paging.
    // Browsing contributes up to 80 points; the five-star rating up to 20.
    {$setWindowFields: {output: {rankingMaxViews: {$max: '$rankingViews', window: {documents: ['unbounded', 'unbounded']}}}}},
    {$set: {rankingScore: {$add: [
      {$cond: [{$gt: ['$rankingMaxViews', 0]}, {$multiply: [80, {$divide: ['$rankingViews', '$rankingMaxViews']}]}, 0]},
      {$multiply: [4, '$rankingRating']},
    ]}}},
    {$sort: {rankingScore: direction, rankingViews: direction, rankingRating: direction, _id: 1}},
    {$skip: skip}, {$limit: limit},
    {$unset: ['rankingMaxViews', 'rankingRating', 'rankingReads']},
  ];
}
