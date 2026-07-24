import { getAppConfig } from "../config.js";
import {
  parseDocumentFilters,
  getSearchIndexMeta,
  getSearchReport,
  getSearchSuggestions,
  getViewerSearchPayload,
  recordSearchClick
} from "../domains/search/index.js";
import { buildFloorPlanLayout, getFloorPlanRegions, getRackSummaries } from "../domains/racks/index.js";
import { getDocumentSets } from "../domains/sets/index.js";
import { capabilitiesFromSession } from "../domains/identity/index.js";
import { dashboardPage, qaPage, searchReportPage } from "../views/searchViews.js";
import { floorPlanPage } from "../views/floorPlanViews.js";
import { jsonResponse } from "../platform/http/responses.js";
import { clean } from "../shared/text/normalize.js";
import { resolveSearchOutcome, resolveSearchRequest } from "./searchRequest.js";

export async function handleDashboard(request, env, session) {
  const url = new URL(request.url);
  const search = await resolveSearchRequest(env, url);
  const { query, page, categories, tags, parsed, filters } = search;
  const selectedDocumentIds = parseSelectedDocumentIds(url.searchParams.get("selected"));
  const capabilities = capabilitiesFromSession(session);
  const editableSets = capabilities.canManageSets
    ? await getEditableSetsForWorkspace(env)
    : [];

  const viewerSearch = await getViewerSearchPayload(env, {
      q: parsed.text,
      category: filters.categoryId,
      zone: filters.zoneNumber,
      tag: filters.tagId,
      rack: filters.rackId,
      face: filters.rackFace,
      column: filters.columnNumber,
      shelf: filters.shelfNumber,
      status: filters.status,
      sort: filters.sort,
      page,
      pageSize: 30
    });

  const totalItems = Number(viewerSearch.pagination?.totalItems || 0);
  const didYouMean = await resolveSearchOutcome(env, search, totalItems);
  const isHome = !query && !search.hasExplicitFilter;

  return dashboardPage({
    session,
    mode: isHome ? "home" : "results",
    query,
    parsedQuery: parsed,
    viewerSearch: filters.status === "disposed" ? { ...viewerSearch, suggestions: [] } : viewerSearch,
    categories,
    tags,
    filters,
    didYouMean,
    editableSets,
    selectedDocumentIds
  });
}

function parseSelectedDocumentIds(value) {
  return [...new Set(clean(value).split(",")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0))]
    .slice(0, 200);
}

async function getEditableSetsForWorkspace(env) {
  try {
    return (await getDocumentSets(env)).filter((set) => Number(set.is_locked) !== 1);
  } catch (error) {
    // Password-change compatibility tests intentionally exercise a pre-row-version
    // schema. The workspace must remain usable there, while mutations stay disabled.
    if (String(error?.message || "").includes("no such column: s.row_version")) return [];
    throw error;
  }
}

export function renderQa(session, env) {
  return qaPage({ session, support: getAppConfig(env).support });
}

export async function handleFloorPlan(env, session) {
  const [racks, regions] = await Promise.all([
    getRackSummaries(env),
    getFloorPlanRegions(env)
  ]);
  return floorPlanPage({
    session,
    floorPlan: buildFloorPlanLayout(racks, regions)
  });
}

export async function handleSearchSuggestions(request, env) {
  const url = new URL(request.url);
  const query = clean(url.searchParams.get("q"));
  const filters = parseDocumentFilters(url.searchParams, { query });
  const suggestions = filters.status === "disposed" ? [] : await getSearchSuggestions(env, query, 8);
  return jsonResponse({ suggestions });
}

export async function handleViewerSearch(request, env) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams);
  const payload = await getViewerSearchPayload(env, params);
  if (payload?.ok === false) {
    return jsonResponse(payload, { status: Number(payload.status || 400) });
  }
  const filters = parseDocumentFilters(params, { query: params.q || params.query });
  return jsonResponse(filters.status === "disposed" ? { ...payload, suggestions: [] } : payload);
}

export async function handleSearchIndex(request, env) {
  const meta = await getSearchIndexMeta(env);
  return jsonResponse({
    ok: false,
    code: "SEARCH_INDEX_RETIRED",
    message: "브라우저 전체 검색 인덱스는 종료되었습니다. /api/viewer/search를 사용하세요.",
    updated: meta.updated
  }, { status: 410, cacheControl: "private, no-store" });
}

export async function handleSearchClick(request, env) {
  const form = await request.formData();
  const result = await recordSearchClick(env, clean(form.get("q")), Number(form.get("documentId")));
  return jsonResponse(result, { status: result.ok ? 200 : 400 });
}

export async function handleAdminSearchReport(env, session) {
  const report = await getSearchReport(env);
  return searchReportPage({ session, report });
}
