import { FREE_TIER_BUDGET } from "../../config.js";
import {
  buildSearchSuggestions,
  getDocumentCount,
  getDocumentPage,
  getDocumentsForExport,
  MAX_SEARCH_RESULTS,
  searchDocumentsWithSuggestions
} from "../../db.js";
import { buildDocumentCsv } from "../../documentCsv.js";
import { documentsPage } from "../../html.js";
import { paginateSlice } from "../../utils.js";
import { csvDownloadResponse } from "../responseHelpers.js";
import { resolveSearchOutcome, resolveSearchRequest } from "../searchRequest.js";

export async function handleDocuments(request, env, session) {
  const url = new URL(request.url);
  const search = await resolveSearchRequest(env, url);
  const { query, page, categories, tags, parsed, filters } = search;
  const pageSize = FREE_TIER_BUDGET.documentPageSize;
  if (!parsed.text) {
    // 필터 전용 브라우즈는 전체 후보를 Worker 메모리로 가져오지 않는다. COUNT 뒤 실제
    // 페이지를 SQL LIMIT/OFFSET으로 읽고, 자동완성은 그 30행에서만 만든다.
    const totalDocuments = await getDocumentCount(env, filters);
    const totalPages = Math.max(1, Math.ceil(totalDocuments / pageSize));
    const safePage = Math.min(page, totalPages);
    const documents = await getDocumentPage(env, filters, safePage, pageSize);
    const suggestions = filters.status === "disposed" ? [] : buildSearchSuggestions(documents, 10);
    const didYouMean = await resolveSearchOutcome(env, { ...search, page: safePage }, totalDocuments);

    return documentsPage({
      session,
      query,
      parsedQuery: parsed,
      documents,
      categories,
      tags,
      filters,
      suggestions,
      didYouMean,
      pagination: {
        page: safePage,
        pageSize,
        totalDocuments,
        totalPages
      }
    });
  }

  // 호환 필터면 검색 1회로 목록·자동완성을 함께 채운다(중복 D1·스코어링 제거).
  const { documents: allDocuments, suggestions } = await searchDocumentsWithSuggestions(
    env,
    parsed.text,
    MAX_SEARCH_RESULTS,
    filters,
    10
  );
  const sliced = paginateSlice(allDocuments, page, pageSize);
  const didYouMean = await resolveSearchOutcome(env, search, sliced.totalItems);

  return documentsPage({
    session,
    query,
    parsedQuery: parsed,
    documents: sliced.items,
    categories,
    tags,
    filters,
    suggestions: filters.status === "disposed" ? [] : suggestions,
    didYouMean,
    pagination: {
      page: sliced.page,
      pageSize: sliced.pageSize,
      totalDocuments: sliced.totalItems,
      totalPages: sliced.totalPages
    }
  });
}

export async function handleDocumentExport(env) {
  const documents = await getDocumentsForExport(env);
  const csv = buildDocumentCsv(documents);

  return csvDownloadResponse(csv.body, csv.filename);
}
