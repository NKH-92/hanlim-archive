import {
  changeUserPassword,
  clearLoginFailures,
  createSessionCookie,
  expiredSessionCookie,
  getMissingSetup,
  isLoginLocked,
  readSession,
  recordLoginFailure,
  validateUser
} from "./auth.js";
import {
  DEFAULT_RACK_COLUMNS,
  DEFAULT_RACK_SHELVES,
  getAppConfig,
  MAX_RACK_COLUMNS,
  MAX_RACKS_PER_ZONE,
  MAX_RACK_SHELVES,
  RACK_ZONES
} from "./config.js";
import {
  categoriesPage,
  adminDashboardPage,
  adminSettingsPage,
  custodyCardPage,
  dashboardPage,
  documentDetailsPage,
  documentFormPage,
  documentGuidePage,
  documentImportPage,
  documentsPage,
  errorPage,
  loginPage,
  moveFormPage,
  notFoundPage,
  passwordPage,
  picklistPage,
  qaPage,
  rackDetailsPage,
  rackFormPage,
  rackConfigurePage,
  racksPage,
  searchReportPage,
  setDetailsPage,
  setFormPage,
  setPicklistPage,
  setsPage,
  signupPage,
  tagsPage,
  accessDeniedPage
} from "./html.js";
import {
  addDocumentsToSet,
  approveUser,
  buildFloorPlanLayout,
  checkoutDocument,
  createDocument,
  createSignupRequest,
  configureRackCounts,
  deleteCategory,
  deleteDocumentSet,
  deleteTag,
  findDocumentsByNumbers,
  disposeDocument,
  getActiveCategories,
  getActiveTags,
  getAppUsers,
  getCategories,
  getDidYouMeanSuggestions,
  getDisposalLogs,
  getDocument,
  getDocumentAuditLogs,
  getDocumentCheckoutLogs,
  getDocumentMovementLogs,
  getDocumentQualitySummary,
  getDocumentSet,
  getDocumentSetDocuments,
  getDocumentSetLogs,
  getDocumentSets,
  getDocumentTags,
  getDocumentsForExport,
  getFloorPlanRegions,
  getPopularDocuments,
  getRackDetails,
  getRackDocuments,
  getRackSummaries,
  getSearchIndexDocuments,
  getSearchIndexMeta,
  getSearchReport,
  getSearchSuggestions,
  getSlotNeighbors,
  getSlotOptions,
  getTags,
  MAX_SEARCH_RESULTS,
  moveDocument,
  parseDocumentNumberList,
  parseSearchQuery,
  recordSearchClick,
  recordSearchLog,
  permanentlyDeleteDocument,
  rejectUser,
  removeDocumentFromSet,
  resolvePicklist,
  restoreDocument,
  returnDocument,
  searchDocuments,
  updateDocument,
  upsertCategory,
  upsertDocumentSet,
  upsertRack,
  upsertTag,
  validateDocumentInput,
  getViewerSearchPayload,
  valuesFromDocumentForm
} from "./db.js";
import { buildDocumentCsv, prepareDocumentImportRows, readDocumentImportRows } from "./documentCsv.js";
import { matchAdminUserRoute, matchDocumentRoute, matchMasterRoute, matchRackRoute, matchSetRoute } from "./routes.js";
import { clean, isTrustedPostOrigin, isValidCsrfToken, logError, normalizePath, redirect, sanitizeReturnUrl } from "./utils.js";
import { withSecurityHeaders } from "./security.js";

export default {
  async fetch(request, env) {
    let response;
    try {
      response = await route(request, env);
    } catch (error) {
      // 미처리 예외: 원시 오류 메시지를 사용자에게 노출하지 않는다(정보 노출 방지).
      // 상관용 짧은 reqId만 사용자에게 주고, 전체 오류는 서버 로그에만 남긴다.
      const url = new URL(request.url);
      const reqId = shortRequestId();
      logError("worker.fetch", error, { reqId, method: request.method, path: normalizePath(url.pathname) });
      const session = await readSession(request, env).catch(() => null);
      response = errorPage(
        `처리 중 오류가 발생했습니다. 계속되면 관리자에게 오류코드 ${reqId} 를 알려주세요.`,
        session,
        500
      );
    }
    return withSecurityHeaders(response, request);
  }
};

function shortRequestId() {
  try {
    return crypto.randomUUID().split("-")[0];
  } catch {
    return "unknown";
  }
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);

  if (path.startsWith("/images/") || path === "/favicon.ico") {
    return env.ASSETS.fetch(request);
  }

  // 무인증 헬스체크: D1 도달성까지 확인해 외부 업타임 모니터가 종단 상태를 알 수 있게 한다.
  if (path === "/healthz" && request.method === "GET") {
    return handleHealthCheck(env);
  }

  if (request.method === "POST" && !isTrustedPostOrigin(request)) {
    return errorPage("잘못된 요청 출처입니다.", null, 403);
  }

  if (path === "/login" && request.method === "GET") {
    return loginPage({
      returnUrl: url.searchParams.get("returnUrl") || "/",
      error: clean(url.searchParams.get("error")),
      signupSubmitted: url.searchParams.has("signup"),
      setupWarning: getMissingSetup(env)
    });
  }

  if (path === "/login" && request.method === "POST") {
    return handleLogin(request, env);
  }

  if (path === "/signup" && request.method === "GET") {
    return signupPage({});
  }

  if (path === "/signup" && request.method === "POST") {
    return handleSignup(request, env);
  }

  const session = await readSession(request, env);

  if (!session) {
    return redirect(`/login?returnUrl=${encodeURIComponent(url.pathname + url.search)}`);
  }

  if (request.method === "POST" && !await isValidCsrfToken(request, session)) {
    return errorPage("요청 보안 토큰이 유효하지 않습니다. 화면을 새로고침한 뒤 다시 시도하세요.", session, 403);
  }

  if (path === "/logout") {
    return redirect("/login", { "Set-Cookie": expiredSessionCookie(url.protocol === "https:") });
  }

  if (path === "/" && request.method === "GET") {
    return redirect(session.role === "Admin" ? "/admin" : "/app");
  }

  if (path === "/app" && request.method === "GET") {
    return handleDashboard(request, env, session);
  }

  if (path === "/qa" && request.method === "GET") {
    return qaPage({ session });
  }

  if (path === "/api/search-suggestions" && request.method === "GET") {
    return handleSearchSuggestions(request, env);
  }

  if (path === "/api/viewer/search" && request.method === "GET") {
    return handleViewerSearch(request, env);
  }

  if (path === "/api/search-index" && request.method === "GET") {
    return handleSearchIndex(request, env);
  }

  if (path === "/api/search-click" && request.method === "POST") {
    return handleSearchClick(request, env);
  }

  if (path === "/account/password" && request.method === "GET") {
    return passwordPage({ session });
  }

  if (path === "/account/password" && request.method === "POST") {
    return handleChangePassword(request, env, session);
  }

  if (path === "/admin" && request.method === "GET") {
    return requireAdmin(session) ?? handleAdminDashboard(env, session);
  }

  if (path === "/admin/settings" && request.method === "GET") {
    return requireAdmin(session) ?? handleAdminSettings(env, session);
  }

  if (path === "/admin/search-report" && request.method === "GET") {
    return requireAdmin(session) ?? handleAdminSearchReport(env, session);
  }

  const adminUserRoute = matchAdminUserRoute(path);

  if (adminUserRoute && request.method === "POST") {
    return requireAdmin(session) ?? handleAdminUserAction(env, session, adminUserRoute);
  }

  if (path === "/documents" && request.method === "GET") {
    return handleDocuments(request, env, session);
  }

  if (path === "/documents/bulk-dispose" && request.method === "POST") {
    return requireAdmin(session) ?? handleBulkDispose(request, env, session);
  }

  if (path === "/documents/export.csv" && request.method === "GET") {
    return requireAdmin(session) ?? handleDocumentExport(env);
  }

  if (path === "/documents/import" && request.method === "GET") {
    return requireAdmin(session) ?? documentImportPage({ session });
  }

  if (path === "/documents/import" && request.method === "POST") {
    return requireAdmin(session) ?? handleDocumentImport(request, env, session);
  }

  if (path === "/documents/new" && request.method === "GET") {
    return requireAdmin(session) ?? renderCreateDocument(env, session);
  }

  if (path === "/documents" && request.method === "POST") {
    return requireAdmin(session) ?? handleCreateDocument(request, env, session);
  }

  const documentRoute = matchDocumentRoute(path);

  if (documentRoute) {
    return handleDocumentRoute(request, env, session, documentRoute);
  }

  if (path === "/picklist" && request.method === "GET") {
    return picklistPage({ session });
  }

  if (path === "/picklist" && request.method === "POST") {
    return handleAdhocPicklist(request, env, session);
  }

  if (path === "/sets" && request.method === "GET") {
    return handleSets(env, session);
  }

  if (path === "/sets/new" && request.method === "GET") {
    return requireAdmin(session) ?? setFormPage({ session, values: {}, action: "/sets", title: "세트 만들기" });
  }

  if (path === "/sets" && request.method === "POST") {
    return requireAdmin(session) ?? handleSaveSet(request, env, session);
  }

  const setRoute = matchSetRoute(path);

  if (setRoute) {
    return handleSetRoute(request, env, session, setRoute);
  }

  if (path === "/racks" && request.method === "GET") {
    return requireAdmin(session) ?? handleRacks(env, session);
  }

  if (path === "/racks/new" && request.method === "GET") {
    return requireAdmin(session) ?? rackFormPage({
      session,
      values: {
        rackNumber: 1,
        columnCount: DEFAULT_RACK_COLUMNS,
        shelfCount: DEFAULT_RACK_SHELVES
      },
      action: "/racks",
      title: "랙 추가"
    });
  }

  if (path === "/racks/configure" && request.method === "GET") {
    return requireAdmin(session) ?? renderRackConfigure(env, session);
  }

  if (path === "/racks/configure" && request.method === "POST") {
    return requireAdmin(session) ?? handleRackConfigure(request, env, session);
  }

  if (path === "/racks" && request.method === "POST") {
    return requireAdmin(session) ?? handleSaveRack(request, env, session);
  }

  const rackRoute = matchRackRoute(path);

  if (rackRoute) {
    return requireAdmin(session) ?? handleRackRoute(request, env, session, rackRoute);
  }

  if (path === "/categories" && request.method === "GET") {
    return requireAdmin(session) ?? renderCategories(env, session);
  }

  if (path === "/categories" && request.method === "POST") {
    return requireAdmin(session) ?? handleSaveCategory(request, env, session);
  }

  const categoryRoute = matchMasterRoute(path, "categories");

  if (categoryRoute && request.method === "POST") {
    return requireAdmin(session) ?? handleCategoryAction(request, env, session, categoryRoute);
  }

  if (path === "/tags" && request.method === "GET") {
    return requireAdmin(session) ?? renderTags(env, session);
  }

  if (path === "/tags" && request.method === "POST") {
    return requireAdmin(session) ?? handleSaveTag(request, env, session);
  }

  const tagRoute = matchMasterRoute(path, "tags");

  if (tagRoute && request.method === "POST") {
    return requireAdmin(session) ?? handleTagAction(request, env, session, tagRoute);
  }

  return notFoundPage(session);
}

async function handleHealthCheck(env) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (error) {
    logError("worker.healthz", error);
    return new Response(JSON.stringify({ ok: false }), { status: 503, headers });
  }
}

async function handleLogin(request, env) {
  const form = await request.formData();
  const username = clean(form.get("username"));
  const password = String(form.get("password") ?? "");
  const returnUrl = sanitizeReturnUrl(clean(form.get("returnUrl")) || "/");

  if (await isLoginLocked(env, username)) {
    return redirect(`/login?error=locked&returnUrl=${encodeURIComponent(returnUrl)}`);
  }

  const user = await validateUser(env, username, password);

  if (!user) {
    await recordLoginFailure(env, username);
    return redirect(`/login?error=1&returnUrl=${encodeURIComponent(returnUrl)}`);
  }

  await clearLoginFailures(env, username);

  const secureCookie = new URL(request.url).protocol === "https:";
  const destination = returnUrl === "/" ? (user.role === "Admin" ? "/admin" : "/app") : returnUrl;
  return redirect(destination, { "Set-Cookie": await createSessionCookie(user, env, secureCookie) });
}

async function handleSignup(request, env) {
  const form = await request.formData();
  const values = {
    username: clean(form.get("username")),
    displayName: clean(form.get("displayName")),
    password: String(form.get("password") ?? "")
  };
  const result = await createSignupRequest(env, values);

  if (!result.ok) {
    return signupPage({ values, error: result.message });
  }

  return redirect("/login?signup=1");
}

async function handleDashboard(request, env, session) {
  const url = new URL(request.url);
  const query = clean(url.searchParams.get("q"));
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const explicitFilters = {
    categoryId: Number(url.searchParams.get("category")) || 0,
    zoneNumber: Number(url.searchParams.get("zone")) || 0,
    tagId: Number(url.searchParams.get("tag")) || 0,
    status: clean(url.searchParams.get("status")),
    sort: clean(url.searchParams.get("sort"))
  };
  const [categories, tags] = await Promise.all([
    getActiveCategories(env),
    getActiveTags(env)
  ]);

  const hasExplicitFilter = Boolean(
    explicitFilters.categoryId || explicitFilters.zoneNumber || explicitFilters.tagId || explicitFilters.status
  );

  // 검색엔진 셸: 검색어도 필터도 없으면 검색창만 있는 홈을 그린다.
  if (!query && !hasExplicitFilter) {
    const popular = await getPopularDocuments(env, 5);
    return dashboardPage({
      session,
      mode: "home",
      query: "",
      categories,
      tags,
      filters: explicitFilters,
      popular
    });
  }

  // "2구역 PV" 같은 검색어를 필터 + 남은 텍스트로 분해한다.
  const parsed = parseSearchQuery(query, { categories, tags, explicit: explicitFilters });
  const filters = {
    categoryId: explicitFilters.categoryId || parsed.filters.categoryId || 0,
    zoneNumber: explicitFilters.zoneNumber || parsed.filters.zoneNumber || 0,
    tagId: explicitFilters.tagId || parsed.filters.tagId || 0,
    status: explicitFilters.status || parsed.filters.status || "",
    sort: explicitFilters.sort || (parsed.text ? "relevance" : "updated")
  };

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
  const didYouMean = query && totalItems === 0 ? await getDidYouMeanSuggestions(env, parsed.text || query, 3) : [];

  if (query && page === 1) {
    await recordSearchLog(env, query, totalItems);
  }

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

async function handleSearchIndex(request, env) {
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

async function handleSearchClick(request, env) {
  const form = await request.formData();
  const result = await recordSearchClick(env, clean(form.get("q")), Number(form.get("documentId")));

  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 400,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

async function handleAdminSearchReport(env, session) {
  const report = await getSearchReport(env);
  return searchReportPage({ session, report });
}

async function handleAdminDashboard(env, session) {
  const [users, quality] = await Promise.all([
    getAppUsers(env),
    getDocumentQualitySummary(env)
  ]);
  const pendingCount = users.filter((user) => user.status === "pending").length;

  return adminDashboardPage({ session, pendingCount, quality });
}

async function handleAdminSettings(env, session) {
  const users = await getAppUsers(env);

  return adminSettingsPage({ session, users });
}

async function handleAdminUserAction(env, session, routeInfo) {
  const result = routeInfo.action === "approve"
    ? await approveUser(env, routeInfo.id, session.username)
    : await rejectUser(env, routeInfo.id, session.username);

  if (!result.ok) {
    return errorPage("처리할 수 있는 가입 신청을 찾지 못했습니다.", session, 400);
  }

  const toast = routeInfo.action === "approve" ? "approved" : "rejected";
  return redirect(`/admin/settings?toast=${toast}`);
}

async function handleDocuments(request, env, session) {
  const url = new URL(request.url);
  const query = clean(url.searchParams.get("q"));
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = 30;
  const explicitFilters = {
    categoryId: Number(url.searchParams.get("category")) || 0,
    zoneNumber: Number(url.searchParams.get("zone")) || 0,
    tagId: Number(url.searchParams.get("tag")) || 0,
    status: clean(url.searchParams.get("status")),
    sort: clean(url.searchParams.get("sort"))
  };
  const [categories, tags] = await Promise.all([
    getActiveCategories(env),
    getActiveTags(env)
  ]);
  const parsed = parseSearchQuery(query, { categories, tags, explicit: explicitFilters });
  const filters = {
    categoryId: explicitFilters.categoryId || parsed.filters.categoryId || 0,
    zoneNumber: explicitFilters.zoneNumber || parsed.filters.zoneNumber || 0,
    tagId: explicitFilters.tagId || parsed.filters.tagId || 0,
    status: explicitFilters.status || parsed.filters.status || "",
    sort: explicitFilters.sort || (parsed.text ? "relevance" : "updated")
  };
  const [allDocuments, suggestions] = await Promise.all([
    searchDocuments(env, parsed.text, MAX_SEARCH_RESULTS, filters),
    getSearchSuggestions(env, parsed.text, 10)
  ]);
  const totalDocuments = allDocuments.length;
  const totalPages = Math.max(1, Math.ceil(totalDocuments / pageSize));
  const currentPage = Math.min(page, totalPages);
  const documents = allDocuments.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const didYouMean = query && totalDocuments === 0 ? await getDidYouMeanSuggestions(env, parsed.text || query, 3) : [];

  if (query && page === 1) {
    await recordSearchLog(env, query, totalDocuments);
  }

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
    pagination: { page: currentPage, pageSize, totalDocuments, totalPages }
  });
}

async function handleSearchSuggestions(request, env) {
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

async function handleViewerSearch(request, env) {
  const url = new URL(request.url);
  const payload = await getViewerSearchPayload(env, Object.fromEntries(url.searchParams));

  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function handleDocumentExport(env) {
  const documents = await getDocumentsForExport(env);
  const csv = buildDocumentCsv(documents);

  return new Response(csv.body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csv.filename}"`,
      "Cache-Control": "no-store"
    }
  });
}

async function handleDocumentImport(request, env, session) {
  const config = getAppConfig(env);
  const form = await request.formData();
  const importRows = await readDocumentImportRows(form, config.csvImport);

  if (!importRows.ok) {
    return documentImportPage({ session, error: importRows.error });
  }

  const [categories, tags, slots] = await Promise.all([
    getCategories(env),
    getTags(env),
    getSlotOptions(env)
  ]);
  const prepared = prepareDocumentImportRows(importRows.rows, { categories, tags, slots });
  if (prepared.errors.length) {
    return documentImportPage({
      session,
      error: `가져오기 전 검증 오류가 있습니다: ${prepared.errors.slice(0, 8).join(" / ")}${prepared.errors.length > 8 ? " ..." : ""}`
    });
  }

  let created = 0;
  let disposed = 0;
  const failures = [];

  // 행별로 독립 처리하고 실패를 집계한다. 중간 한 행이 실패해도 일반 500 대신
  // "생성 N · 폐기반영 M · 실패 K" 요약을 돌려줘 운영자가 후속 조치할 수 있게 한다.
  for (let index = 0; index < prepared.items.length; index += 1) {
    const item = prepared.items[index];
    const rowNumber = index + 2; // 헤더(1행) 다음부터
    try {
      const id = await createDocument(env, item.values, session.displayName, session.role);
      created += 1;

      if (item.status === "disposed") {
        await disposeDocument(env, id, session.displayName, "CSV 가져오기 폐기 상태 반영", session.role);
        disposed += 1;
      }
    } catch (error) {
      logError("import.row", error, { row: rowNumber });
      failures.push(`${rowNumber}행: ${error.message || "등록 실패"}`);
    }
  }

  return documentImportPage({ session, result: { created, disposed, failures } });
}

async function renderCreateDocument(env, session, values = {}, error = "") {
  const [categories, tags, slots] = await Promise.all([
    getActiveCategories(env),
    getActiveTags(env),
    getSlotOptions(env)
  ]);

  return documentFormPage({
    session,
    title: "문서 등록",
    action: "/documents",
    values,
    categories,
    tags,
    slots,
    selectedTags: values.tagIds || [],
    error
  });
}

async function handleCreateDocument(request, env, session) {
  const values = valuesFromDocumentForm(await request.formData());
  const validation = await validateDocumentInput(env, values);

  if (validation) {
    return renderCreateDocument(env, session, values, validation);
  }

  const id = await createDocument(env, values, session.displayName, session.role);
  return redirect(`/documents/${id}?toast=created`);
}

async function handleDocumentRoute(request, env, session, routeInfo) {
  const { id, action } = routeInfo;

  if (request.method === "GET" && action === "details") {
    const [document, tags, movementLogs, disposalLogs, auditLogs, checkoutLogs] = await Promise.all([
      getDocument(env, id),
      getDocumentTags(env, id),
      getDocumentMovementLogs(env, id),
      getDisposalLogs(env, id),
      getDocumentAuditLogs(env, id),
      getDocumentCheckoutLogs(env, id)
    ]);

    if (!document) {
      return notFoundPage(session);
    }

    return documentDetailsPage({ session, document, tags, movementLogs, disposalLogs, auditLogs, checkoutLogs });
  }

  if (request.method === "GET" && action === "guide") {
    const document = await getDocument(env, id);

    if (!document) {
      return notFoundPage(session);
    }

    const [racks, regions, neighbors] = await Promise.all([
      getRackSummaries(env),
      getFloorPlanRegions(env),
      getSlotNeighbors(env, document)
    ]);

    return documentGuidePage({ session, document, floorPlan: buildFloorPlanLayout(racks, regions), neighbors });
  }

  if (request.method === "GET" && action === "custody") {
    const [document, movementLogs, checkoutLogs] = await Promise.all([
      getDocument(env, id),
      getDocumentMovementLogs(env, id),
      getDocumentCheckoutLogs(env, id)
    ]);

    if (!document) {
      return notFoundPage(session);
    }

    return custodyCardPage({ session, document, movementLogs, checkoutLogs });
  }

  if (request.method === "GET" && action === "edit") {
    const denied = requireAdmin(session);
    if (denied) {
      return denied;
    }

    const [document, tags, categories, activeTags, slots] = await Promise.all([
      getDocument(env, id),
      getDocumentTags(env, id),
      getCategories(env),
      getTags(env),
      getSlotOptions(env)
    ]);

    if (!document) {
      return notFoundPage(session);
    }

    if (document.status === "disposed") {
      return errorPage("폐기 상태 문서는 폐기를 해제하기 전까지 수정할 수 없습니다.", session, 400);
    }

    return documentFormPage({
      session,
      title: "문서 수정",
      action: `/documents/${id}/edit`,
      values: documentToFormValues(document),
      categories,
      tags: activeTags,
      slots,
      selectedTags: tags.map((tag) => tag.id),
      showLocation: false
    });
  }

  if (request.method === "POST" && action === "edit") {
    const denied = requireAdmin(session);
    if (denied) {
      return denied;
    }

    const document = await getDocument(env, id);
    if (!document) {
      return notFoundPage(session);
    }

    const values = valuesFromDocumentForm(await request.formData());
    values.rackSlotId = document.rack_slot_id;
    values.rackFace = document.rack_face;
    const validation = await validateDocumentInput(env, values, id, {
      allowInactiveCategoryId: document.category_id
    });

    if (validation) {
      const [categories, tags, slots] = await Promise.all([getCategories(env), getTags(env), getSlotOptions(env)]);
      return documentFormPage({
        session,
        title: "문서 수정",
        action: `/documents/${id}/edit`,
        values,
        categories,
        tags,
        slots,
        selectedTags: values.tagIds,
        error: validation,
        showLocation: false
      });
    }

    const result = await updateDocument(env, id, values, session.displayName, session.role);
    if (!result.ok) {
      return errorPage(result.message, session, 400);
    }

    return redirect(`/documents/${id}?toast=updated`);
  }

  if (request.method === "GET" && action === "move") {
    const denied = requireAdmin(session);
    if (denied) {
      return denied;
    }

    const [document, slots] = await Promise.all([getDocument(env, id), getSlotOptions(env)]);
    if (!document) {
      return notFoundPage(session);
    }
    if (document.status === "disposed") {
      return errorPage("폐기 상태 문서는 폐기를 해제하기 전까지 이동할 수 없습니다.", session, 400);
    }

    return moveFormPage({ session, document, slots });
  }

  if (request.method === "POST" && action === "move") {
    const denied = requireAdmin(session);
    if (denied) {
      return denied;
    }

    const form = await request.formData();
    const document = await getDocument(env, id);
    if (!document) {
      return notFoundPage(session);
    }

    const values = {
      documentNumber: document.document_number,
      revisionNumber: document.revision_number,
      documentName: document.document_name,
      categoryId: document.category_id,
      rackSlotId: Number(form.get("rackSlotId")),
      rackFace: clean(form.get("rackFace")).toUpperCase(),
      note: clean(form.get("note")),
      expectedUpdatedAt: clean(form.get("expectedUpdatedAt"))
    };
    const validation = await validateDocumentInput(env, values, id);

    if (validation) {
      const slots = await getSlotOptions(env);
      return moveFormPage({ session, document, slots, error: validation });
    }

    const result = await moveDocument(env, id, values, session.displayName, session.role);
    if (!result.ok) {
      return errorPage(result.message, session, 400);
    }

    return redirect(`/documents/${id}?toast=moved`);
  }

  if (request.method === "POST" && action === "checkout") {
    const denied = requireAdmin(session);
    if (denied) {
      return denied;
    }

    const form = await request.formData();
    const result = await checkoutDocument(env, id, {
      borrower: clean(form.get("borrower")),
      purpose: clean(form.get("purpose"))
    }, session.displayName, session.role);
    if (!result.ok) {
      return errorPage(result.message, session, 400);
    }
    return redirect(`/documents/${id}?toast=checked-out`);
  }

  if (request.method === "POST" && action === "return") {
    const denied = requireAdmin(session);
    if (denied) {
      return denied;
    }

    const result = await returnDocument(env, id, session.displayName, session.role);
    if (!result.ok) {
      return errorPage(result.message, session, 400);
    }
    return redirect(`/documents/${id}?toast=returned`);
  }

  if (request.method === "POST" && action === "dispose") {
    const denied = requireAdmin(session);
    if (denied) {
      return denied;
    }

    const form = await request.formData();
    const result = await disposeDocument(env, id, session.displayName, clean(form.get("reason")), session.role);
    if (!result.ok) {
      return errorPage(result.message, session, 400);
    }
    return redirect(`/documents/${id}?toast=disposed`);
  }

  if (request.method === "POST" && action === "restore") {
    const denied = requireAdmin(session);
    if (denied) {
      return denied;
    }

    const result = await restoreDocument(env, id, session.displayName, session.role);
    if (!result.ok) {
      return errorPage(result.message, session, 400);
    }
    return redirect(`/documents/${id}?toast=restored`);
  }

  if (request.method === "POST" && action === "delete-permanent") {
    const denied = requireAdmin(session);
    if (denied) {
      return denied;
    }

    const result = await permanentlyDeleteDocument(env, id, session.displayName, session.role);
    if (!result.ok) {
      return errorPage(result.message, session, 400);
    }
    return redirect("/documents?toast=deleted");
  }

  return notFoundPage(session);
}

async function handleSets(env, session) {
  const sets = await getDocumentSets(env);
  return setsPage({ session, sets });
}

async function handleAdhocPicklist(request, env, session) {
  const form = await request.formData();
  const raw = clean(form.get("numbers"));
  const numbers = parseDocumentNumberList(raw);

  if (!numbers.length) {
    return picklistPage({ session, raw, error: "문서번호 또는 보관코드를 붙여넣으세요." });
  }
  if (numbers.length > 300) {
    return picklistPage({ session, raw, error: "한 번에 300건 이하로 입력하세요. 나눠서 조회하세요." });
  }

  const [{ documents, missing }, racks, regions] = await Promise.all([
    resolvePicklist(env, numbers),
    getRackSummaries(env),
    getFloorPlanRegions(env)
  ]);

  return picklistPage({
    session,
    raw,
    requested: numbers.length,
    documents,
    missing,
    floorPlan: buildFloorPlanLayout(racks, regions)
  });
}

async function renderSetDetails(env, session, id, options = {}) {
  const set = await getDocumentSet(env, id);
  if (!set) {
    return notFoundPage(session);
  }

  const [documents, racks, logs] = await Promise.all([
    getDocumentSetDocuments(env, id),
    getRackSummaries(env),
    getDocumentSetLogs(env, id)
  ]);

  let addCandidates = null;
  if (session.role === "Admin" && options.addQuery) {
    const memberIds = new Set(documents.map((document) => document.id));
    const results = await searchDocuments(env, options.addQuery, 20);
    addCandidates = results.map((document) => ({ ...document, inSet: memberIds.has(document.id) }));
  }

  return setDetailsPage({
    session,
    set,
    documents,
    racks,
    logs,
    addQuery: options.addQuery || "",
    addCandidates,
    addResult: options.addResult || null,
    error: options.error || ""
  });
}

async function handleSaveSet(request, env, session, id = 0) {
  const form = await request.formData();
  const values = {
    id,
    name: clean(form.get("name")),
    description: clean(form.get("description"))
  };
  const result = await upsertDocumentSet(env, values, session.displayName);

  if (!result.ok) {
    return setFormPage({
      session,
      values,
      action: id ? `/sets/${id}/edit` : "/sets",
      title: id ? "세트 수정" : "세트 만들기",
      error: result.message
    });
  }

  return redirect(`/sets/${result.id}`);
}

async function handleSetRoute(request, env, session, routeInfo) {
  const { id, action } = routeInfo;

  if (request.method === "GET" && action === "details") {
    const url = new URL(request.url);
    return renderSetDetails(env, session, id, { addQuery: clean(url.searchParams.get("add-q")) });
  }

  if (request.method === "GET" && action === "picklist") {
    const set = await getDocumentSet(env, id);
    if (!set) {
      return notFoundPage(session);
    }

    const [documents, racks, regions] = await Promise.all([
      getDocumentSetDocuments(env, id),
      getRackSummaries(env),
      getFloorPlanRegions(env)
    ]);

    return setPicklistPage({ session, set, documents, floorPlan: buildFloorPlanLayout(racks, regions) });
  }

  if (request.method === "GET" && action === "edit") {
    const denied = requireAdmin(session);
    if (denied) {
      return denied;
    }

    const set = await getDocumentSet(env, id);
    if (!set) {
      return notFoundPage(session);
    }

    return setFormPage({ session, values: set, action: `/sets/${id}/edit`, title: "세트 수정" });
  }

  if (request.method === "POST" && action === "edit") {
    return requireAdmin(session) ?? handleSaveSet(request, env, session, id);
  }

  if (request.method === "POST" && action === "delete") {
    const denied = requireAdmin(session);
    if (denied) {
      return denied;
    }

    const result = await deleteDocumentSet(env, id, session.displayName);
    if (!result.ok) {
      return errorPage(result.message, session, 400);
    }

    return redirect("/sets");
  }

  if (request.method === "POST" && action === "add") {
    return requireAdmin(session) ?? handleAddSetDocuments(request, env, session, id);
  }

  if (request.method === "POST" && action === "remove") {
    const denied = requireAdmin(session);
    if (denied) {
      return denied;
    }

    const form = await request.formData();
    const documentId = Number(form.get("documentId"));
    const result = await removeDocumentFromSet(env, id, documentId, session.displayName);

    if (!result.ok) {
      return renderSetDetails(env, session, id, { error: result.message });
    }

    return redirect(`/sets/${id}`);
  }

  return notFoundPage(session);
}

async function handleAddSetDocuments(request, env, session, setId) {
  const set = await getDocumentSet(env, setId);
  if (!set) {
    return notFoundPage(session);
  }

  const form = await request.formData();
  const documentId = Number(form.get("documentId"));

  if (documentId) {
    const { added } = await addDocumentsToSet(env, setId, [documentId], session.displayName);
    return renderSetDetails(env, session, setId, {
      addQuery: clean(form.get("add-q")),
      addResult: { added, missing: [] }
    });
  }

  const numbers = parseDocumentNumberList(form.get("numbers"));

  if (!numbers.length) {
    return renderSetDetails(env, session, setId, { error: "추가할 문서번호 또는 보관코드를 입력하세요." });
  }

  if (numbers.length > 200) {
    return renderSetDetails(env, session, setId, { error: "일괄 추가는 한 번에 200건 이하로 입력하세요." });
  }

  const { documents, missing } = await findDocumentsByNumbers(env, numbers);
  const { added } = await addDocumentsToSet(env, setId, documents.map((document) => document.id), session.displayName);

  return renderSetDetails(env, session, setId, { addResult: { added, missing } });
}

async function handleRacks(env, session) {
  const racks = await getRackSummaries(env);
  return racksPage({ session, racks });
}

async function handleRackRoute(request, env, session, routeInfo) {
  const { id, action } = routeInfo;

  if (request.method === "GET" && action === "details") {
    const [rack, documents] = await Promise.all([
      getRackDetails(env, id),
      getRackDocuments(env, id)
    ]);

    if (!rack) {
      return notFoundPage(session);
    }

    return rackDetailsPage({ session, rack, documents });
  }

  if (request.method === "GET" && action === "edit") {
    const denied = requireAdmin(session);
    if (denied) {
      return denied;
    }

    const rack = await getRackDetails(env, id);
    if (!rack) {
      return notFoundPage(session);
    }
    return rackFormPage({ session, values: rack, action: `/racks/${id}/edit`, title: "랙 수정" });
  }

  if (request.method === "POST" && action === "edit") {
    const denied = requireAdmin(session);
    if (denied) {
      return denied;
    }
    return handleSaveRack(request, env, session, id);
  }

  return notFoundPage(session);
}

async function renderRackConfigure(env, session, error = "") {
  const racks = await getRackSummaries(env);
  const counts = Object.fromEntries(RACK_ZONES.map((zone) => [zone, 0]));

  for (const rack of racks) {
    counts[rack.zone_number] = Math.max(counts[rack.zone_number], rack.rack_number);
  }

  return rackConfigurePage({ session, counts, error });
}

async function handleRackConfigure(request, env, session) {
  const form = await request.formData();
  const counts = Object.fromEntries(
    RACK_ZONES.map((zone) => [zone, Number(form.get(`zone${zone}Count`))])
  );
  const result = await configureRackCounts(env, counts);

  if (!result.ok) {
    return renderRackConfigure(env, session, result.message);
  }

  return redirect("/racks?toast=saved");
}

async function handleSaveRack(request, env, session, id = 0) {
  const form = await request.formData();
  const values = {
    id,
    zoneNumber: Number(form.get("zoneNumber")),
    rackNumber: Number(form.get("rackNumber")),
    columnCount: Number(form.get("columnCount")),
    shelfCount: Number(form.get("shelfCount")),
    name: clean(form.get("name")),
    description: clean(form.get("description")),
    isSingleSided: form.get("isSingleSided") === "1",
    isActive: form.get("isActive") === "1"
  };

  if (!RACK_ZONES.includes(values.zoneNumber) || values.rackNumber < 1 || values.rackNumber > MAX_RACKS_PER_ZONE) {
    return rackFormPage({
      session,
      values,
      action: id ? `/racks/${id}/edit` : "/racks",
      title: id ? "랙 수정" : "랙 추가",
      error: `구역은 ${RACK_ZONES.join(", ")}, 랙 번호는 1~${MAX_RACKS_PER_ZONE} 사이여야 합니다.`
    });
  }

  if (values.columnCount < 1 || values.columnCount > MAX_RACK_COLUMNS || values.shelfCount < 1 || values.shelfCount > MAX_RACK_SHELVES) {
    return rackFormPage({
      session,
      values,
      action: id ? `/racks/${id}/edit` : "/racks",
      title: id ? "랙 수정" : "랙 추가",
      error: `랙 구조는 1~${MAX_RACK_COLUMNS}열, 1~${MAX_RACK_SHELVES}선반 사이로 설정해야 합니다.`
    });
  }

  if (id && !values.isActive) {
    const documents = await getRackDocuments(env, id);
    if (documents.length) {
      return rackFormPage({
        session,
        values,
        action: `/racks/${id}/edit`,
        title: "랙 수정",
        error: "문서가 보관된 랙은 비활성화할 수 없습니다."
      });
    }
  }

  if (id && values.isSingleSided) {
    const documents = await getRackDocuments(env, id);
    if (documents.some((document) => document.rack_face === "B")) {
      return rackFormPage({
        session,
        values,
        action: `/racks/${id}/edit`,
        title: "랙 수정",
        error: "B면에 문서가 있는 랙은 단면 랙으로 변경할 수 없습니다."
      });
    }
  }

  try {
    const rackId = await upsertRack(env, values);
    return redirect(`/racks/${rackId}?toast=saved`);
  } catch (error) {
    return rackFormPage({
      session,
      values,
      action: id ? `/racks/${id}/edit` : "/racks",
      title: id ? "랙 수정" : "랙 추가",
      error: error.message.includes("UNIQUE") ? "같은 구역에 동일한 랙 번호가 이미 있습니다." : error.message
    });
  }
}

async function renderCategories(env, session, error = "", values = {}) {
  return categoriesPage({ session, categories: await getCategories(env), error, values });
}

async function handleSaveCategory(request, env, session, id = 0) {
  const form = await request.formData();
  const values = {
    id,
    name: clean(form.get("name")),
    description: clean(form.get("description")),
    sortOrder: Number(form.get("sortOrder") || 0),
    isActive: id ? form.get("isActive") === "1" : true
  };
  const result = await upsertCategory(env, values);

  if (!result.ok) {
    return renderCategories(env, session, result.message, values);
  }

  return redirect("/categories?toast=saved");
}

async function handleCategoryAction(request, env, session, routeInfo) {
  if (routeInfo.action === "edit") {
    return handleSaveCategory(request, env, session, routeInfo.id);
  }

  const result = await deleteCategory(env, routeInfo.id);
  if (!result.ok) {
    return renderCategories(env, session, result.message);
  }

  return redirect("/categories?toast=saved");
}

async function renderTags(env, session, error = "", values = {}) {
  return tagsPage({ session, tags: await getTags(env), error, values });
}

async function handleSaveTag(request, env, session, id = 0) {
  const form = await request.formData();
  const values = {
    id,
    name: clean(form.get("name")),
    description: clean(form.get("description")),
    isActive: id ? form.get("isActive") === "1" : true
  };
  const result = await upsertTag(env, values);

  if (!result.ok) {
    return renderTags(env, session, result.message, values);
  }

  return redirect("/tags?toast=saved");
}

async function handleTagAction(request, env, session, routeInfo) {
  if (routeInfo.action === "edit") {
    return handleSaveTag(request, env, session, routeInfo.id);
  }

  const result = await deleteTag(env, routeInfo.id);
  if (!result.ok) {
    return renderTags(env, session, result.message);
  }

  return redirect("/tags?toast=saved");
}

function requireAdmin(session) {
  return session.role === "Admin" ? null : accessDeniedPage(session);
}

function documentToFormValues(document) {
  return {
    documentNumber: document.document_number,
    revisionNumber: document.revision_number,
    documentName: document.document_name,
    categoryId: document.category_id,
    rackSlotId: document.rack_slot_id,
    rackFace: document.rack_face,
    note: document.note || "",
    updatedAt: document.updated_at
  };
}

async function handleChangePassword(request, env, session) {
  const form = await request.formData();
  const currentPassword = String(form.get("currentPassword") ?? "");
  const newPassword = String(form.get("newPassword") ?? "");
  const confirmPassword = String(form.get("confirmPassword") ?? "");

  if (!currentPassword || !newPassword) {
    return passwordPage({ session, error: "모든 필드를 입력하세요." });
  }

  if (newPassword.length < 8) {
    return passwordPage({ session, error: "새 비밀번호는 8자 이상이어야 합니다." });
  }

  if (newPassword !== confirmPassword) {
    return passwordPage({ session, error: "새 비밀번호가 일치하지 않습니다." });
  }

  const result = await changeUserPassword(env, session.username, currentPassword, newPassword);
  if (!result.ok) {
    return passwordPage({ session, error: result.message });
  }

  return passwordPage({ session, success: true });
}

async function handleBulkDispose(request, env, session) {
  const form = await request.formData();
  const idsRaw = clean(form.get("ids"));
  const reason = clean(form.get("reason"));

  if (!idsRaw || !reason) {
    return redirect("/documents?toast=error");
  }

  const ids = idsRaw.split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0);

  if (ids.length > 20) {
    return errorPage("일괄 폐기는 한 번에 20건 이하로 선택해 주세요.", session, 400);
  }

  for (const id of ids) {
    await disposeDocument(env, id, session.displayName, reason, session.role);
  }

  return redirect(`/documents?toast=bulk-disposed`);
}
