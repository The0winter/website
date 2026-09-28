// Keep the reader contract separate from the full detail/editor document.
// Permissions are selected by the access middleware but never serialized here.
export const readerBookFields = ['title', 'author', 'cover_image', 'category', 'status', 'writeVersion'];
export const readerBookProjection = Object.fromEntries(readerBookFields.map(field => [field, 1]));

export function readerBookResponse(book) {
  return {id: String(book._id), ...Object.fromEntries(readerBookFields.filter(field => field in book).map(field => [field, book[field]]))};
}
