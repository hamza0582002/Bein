/** Object-URL cache for cover blobs so the same cover is never re-allocated. */

const cache = new Map();

export function coverUrl(book) {
  if (!book?.cover) return null;
  if (cache.has(book.id)) return cache.get(book.id);
  const url = URL.createObjectURL(book.cover);
  cache.set(book.id, url);
  return url;
}

export function releaseCover(bookId) {
  const url = cache.get(bookId);
  if (url) {
    URL.revokeObjectURL(url);
    cache.delete(bookId);
  }
}

export function releaseAll() {
  cache.forEach((url) => URL.revokeObjectURL(url));
  cache.clear();
}
