export function paginateSlice(items, page, pageSize) {
  const parsedSize = Number(pageSize);
  const size = Number.isFinite(parsedSize) && parsedSize >= 1 ? Math.floor(parsedSize) : 1;
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / size));
  const parsedPage = Number(page);
  const requestedPage = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;
  const currentPage = Math.min(requestedPage, totalPages);
  const offset = (currentPage - 1) * size;
  return { items: items.slice(offset, offset + size), page: currentPage, pageSize: size, totalItems, totalPages };
}
