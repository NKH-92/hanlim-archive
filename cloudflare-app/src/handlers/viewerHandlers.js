import {
  buildFloorPlanLayout,
  getFloorPlanRegions,
  getRackSummaries,
  getSearchIndexDocuments,
  getSearchIndexMeta,
  getSearchReport,
  getSearchSuggestions,
  getViewerSearchPayload,
  recordSearchClick
} from "../db.js";
import { dashboardPage, qaPage, searchReportPage } from "../html.js";
import { clean } from "../utils.js";
import { resolveSearchOutcome, resolveSearchRequest } from "./searchRequest.js";

export async function handleDashboard(request, env, session) {
  const url = new URL(request.url);
  const search = await resolveSearchRequest(env, url);
  const { query, page, explicitFilters, categories, tags, parsed, filters } = search;

  // 검색엔진 셸: 검색어도 필터도 없으면 검색창 + 문서고 도면 홈을 그린다.
  if (!query && !search.hasExplicitFilter) {
    const [homeRacks, homeRegions] = await Promise.all([
      getRackSummaries(env),
      getFloorPlanRegions(env)
    ]);
    return dashboardPage({
      session,
      mode: "home",
      query: "",
      categories,
      tags,
      filters: explicitFilters,
      floorPlan: buildFloorPlanLayout(homeRacks, homeRegions)
    });
  }

  const [racks, regions, viewerSearch] = await Promise.all([
    getRackSummaries(env),
    getFloorPlanRegions(env),
    getViewerSearchPayload(env, {
      q: parsed.text,
      category: filters.categoryId,
      zone: filters.zoneNumber,
      tag: filters.tagId,
      status: filters.status,
      sort: filters.sort,
      page,
      pageSize: 12
    })
  ]);

  const totalItems = Number(viewerSearch.pagination?.totalItems || 0);
  const didYouMean = await resolveSearchOutcome(env, search, totalItems);

  return dashboardPage({
    session,
    mode: "results",
    query,
    parsedQuery: parsed,
    viewerSearch,
    floorPlan: buildFloorPlanLayout(racks, regions),
    categories,
    tags,
    filters,
    didYouMean
  });
}

export function renderQa(session) {
  return qaPage({ session });
}

export async function handleSearchSuggestions(request, env) {
  const url = new URL(request.url);
  const query = clean(url.searchParams.get("q"));
  const suggestions = await getSearchSuggestions(env, query, 8);

  return new Response(JSON.stringify({ suggestions }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function handleViewerSearch(request, env) {
  const url = new URL(request.url);
  const payload = await getViewerSearchPayload(env, Object.fromEntries(url.searchParams));

  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function handleSearchIndex(request, env) {
  const meta = await getSearchIndexMeta(env);
  const etag = `"idx-${meta.count}-${meta.maxId}-${meta.updated.replace(/[^0-9]/g, "")}"`;

  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  const documents = await getSearchIndexDocuments(env);
  return new Response(JSON.stringify({ updated: meta.updated, documents }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-cache",
      ETag: etag
    }
  });
}

export async function handleSearchClick(request, env) {
  const form = await request.formData();
  const result = await recordSearchClick(env, clean(form.get("q")), Number(form.get("documentId")));

  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 400,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export async function handleAdminSearchReport(env, session) {
  const report = await getSearchReport(env);
  return searchReportPage({ session, report });
}
