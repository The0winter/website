import path from 'node:path';
import {hash, readJson} from '../storage.mjs';

// Explicitly reviewed website titles are pinned to both identities and the
// website book ID. Never infer aliases by name or relax chapter checks.
export function reviewedUploadIdentity(book, remote, stateDir) {
  const record = readJson(path.join(stateDir, 'library-upload-identities', hash(book.sourceUrl) + '.json'));
  if (!record) return book;
  const value = record.value;
  if (!value || record.hash !== hash(value) ||
      value.sourceUrl !== book.sourceUrl || value.author !== book.author || value.localTitle !== book.title ||
      value.bookId !== remote.bookId || value.sourceUrl !== remote.book?.sourceUrl ||
      value.author !== remote.book?.author || value.websiteTitle !== remote.book?.title) {
    throw Error('已审核的上传书名映射与当前书籍不一致，请重新核对；网站原内容保留');
  }
  return {...book, title: value.websiteTitle};
}
