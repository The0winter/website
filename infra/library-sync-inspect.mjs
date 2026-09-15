import {libraryBookFields, libraryRevision} from '../shared/library-revision.mjs';

const fail = message => { throw Object.assign(Error(message), {publicMessage: message}); };
const allowed = book => !!book.importManaged && !book.author_id && !book.deletedAt;

export async function inspectLibraryHeaders(identities, {Book}) {
  if (!Array.isArray(identities) || identities.length > 200 || identities.some(book => typeof book.sourceUrl !== 'string')) fail('批量核对参数无效');
  const rows = await Book.find({sourceUrl: {$in: identities.map(book => book.sourceUrl)}}).select(libraryBookFields).lean();
  const matches = new Map();
  for (const book of rows) {
    const group = matches.get(book.sourceUrl) || []; group.push(book); matches.set(book.sourceUrl, group);
  }
  return identities.map(identity => {
    const books = matches.get(identity.sourceUrl) || [], book = books[0];
    // Missing/ambiguous/ineligible identities always take the guarded full path.
    return {sourceUrl: identity.sourceUrl, token: books.length === 1 && allowed(book) ? libraryRevision(book) : null};
  });
}

export async function inspectVersionedLibraryBook(job, {Book, Chapter, bodyHash}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const books = await Book.find({sourceUrl: job.sourceUrl}).select(libraryBookFields).limit(2).lean();
    if (books.length > 1) fail('网站存在多个相同来源的作品，请先核对');
    const book = books[0];
    if (!book) {
      if ((await Book.find({title: job.title, author: job.author}).select('_id').limit(1).lean()).length) fail('网站已有同名同作者的其他来源版本，请先核对来源绑定，避免重复建书');
      return {book: null, chapters: [], token: null};
    }
    if (!allowed(book)) fail('网站作品已下架或归属不允许自动导入，请先核对');
    const token = libraryRevision(book);
    const partial = !!job.knownToken && job.knownToken === token && Array.isArray(job.numbers);
    if (partial && job.numbers.some(n => !Number.isSafeInteger(n) || n < 1)) fail('章节核对参数无效');
    const filter = {bookId: book._id, ...(partial ? {chapter_number: {$in: job.numbers}} : {})};
    const rows = partial && !job.numbers.length ? [] : await Chapter.find(filter).select('chapter_number title content contentSha256 sourceUrl deletedAt').sort({chapter_number: 1}).lean();
    // Do not associate a mixed, concurrently modified directory with a token.
    const after = await Book.findById(book._id).select(libraryBookFields).lean();
    if (libraryRevision(after) !== token) continue;
    return {book: Object.fromEntries(['title', 'author', 'sourceUrl', 'description', 'category', 'status'].map(key => [key, book[key]])),
      bookId: String(book._id), token, partial, chapters: rows.map(c => ({number: c.chapter_number, title: c.title, link: c.sourceUrl,
        deleted: !!c.deletedAt, hash: typeof c.content === 'string' ? bodyHash(c.content) : c.contentSha256}))};
  }
  fail('核对期间网站作品连续变化，请再次上传核对；已完成批次保留');
}
