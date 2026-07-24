import {
  addDocumentsToSet,
  cloneDocumentSet,
  deleteDocumentSet,
  getDocumentSet,
  getDocumentSetDocuments,
  getDocumentSetLogs,
  getDocumentSets,
  removeDocumentFromSet,
  setDocumentSetLock,
  upsertDocumentSet
} from "../domains/sets/index.js";
import { findDocumentsByNumbers, parseDocumentNumberList } from "../domains/documents/index.js";
import { getRackSummaries } from "../domains/racks/index.js";
import { searchDocuments } from "../domains/search/index.js";
import { buildDocumentSetCsv } from "../documentCsv.js";
import { errorPage, notFoundPage } from "../views/authViews.js";
import { setClonePage, setDetailsPage, setFormPage, setsPage } from "../views/setViews.js";
import { hasPermission, PERMISSIONS } from "../permissions.js";
import { redirect } from "../platform/http/responses.js";
import { clean } from "../shared/text/normalize.js";
import { requireManageSets } from "./permissionGuards.js";
import { csvDownloadResponse } from "./responseHelpers.js";

export async function handleSets(request, env, session) {
  const params = new URL(request.url).searchParams;
  const filters = {
    q: clean(params.get("q")),
    status: clean(params.get("status")) || "all",
    sort: clean(params.get("sort")) || "updated"
  };
  const sets = await getDocumentSets(env, filters);
  return setsPage({ session, sets, filters });
}

export function renderNewSetForm(session) {
  return setFormPage({ session, values: {}, action: "/sets", title: "세트 만들기" });
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
  if (
    hasPermission(session, PERMISSIONS.MANAGE_SETS)
    && options.addQuery
    && (!Number(set.is_locked) || options.preserveAddSelection)
  ) {
    const memberIds = new Set(documents.map((document) => document.id));
    const results = await searchDocuments(env, options.addQuery, 200);
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
    selectedCandidateIds: options.selectedCandidateIds || [],
    preserveAddSelection: Boolean(options.preserveAddSelection),
    addResult: options.addResult || null,
    error: options.error || ""
  });
}

export async function handleSaveSet(request, env, session, id = 0) {
  const form = await request.formData();
  const values = {
    id,
    name: clean(form.get("name")),
    description: clean(form.get("description")),
    ...(id ? { expectedRowVersion: Number(form.get("expectedRowVersion")) } : {})
  };
  const result = await upsertDocumentSet(env, values, session);

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

export async function handleSetRoute(request, env, session, routeInfo) {
  const { id, action } = routeInfo;

  if (request.method === "GET" && action === "details") {
    const url = new URL(request.url);
    return renderSetDetails(env, session, id, { addQuery: clean(url.searchParams.get("add-q")) });
  }

  if (request.method === "GET" && (action === "export" || action === "export.csv")) {
    const set = await getDocumentSet(env, id);
    if (!set) return notFoundPage(session);
    const documents = await getDocumentSetDocuments(env, id);
    const csv = buildDocumentSetCsv(set, documents);
    return csvDownloadResponse(csv.body, csv.filename);
  }

  if (request.method === "GET" && action === "edit") {
    const denied = requireManageSets(session);
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
    return requireManageSets(session) ?? handleSaveSet(request, env, session, id);
  }

  if (request.method === "GET" && action === "clone") {
    const denied = requireManageSets(session);
    if (denied) return denied;
    const set = await getDocumentSet(env, id);
    if (!set) return notFoundPage(session);
    const documents = await getDocumentSetDocuments(env, id);
    return setClonePage({ session, set, documentCount: documents.length });
  }

  if (request.method === "POST" && action === "clone") {
    const denied = requireManageSets(session);
    if (denied) return denied;
    const set = await getDocumentSet(env, id);
    if (!set) return notFoundPage(session);
    const form = await request.formData();
    const values = {
      name: clean(form.get("name")),
      expectedRowVersion: Number(form.get("expectedRowVersion"))
    };
    const result = await cloneDocumentSet(env, id, values, session);
    if (!result.ok) {
      const documents = await getDocumentSetDocuments(env, id);
      return setClonePage({ session, set, documentCount: documents.length, values, error: result.message });
    }
    return redirect(`/sets/${result.id}?toast=saved`);
  }

  if (request.method === "POST" && action === "delete") {
    const denied = requireManageSets(session);
    if (denied) {
      return denied;
    }

    const form = await request.formData();
    const result = await deleteDocumentSet(env, id, session, Number(form.get("expectedRowVersion")));
    if (!result.ok) {
      return errorPage(result.message, session, 400);
    }

    return redirect("/sets");
  }

  if (request.method === "POST" && action === "add") {
    return requireManageSets(session) ?? handleAddSetDocuments(request, env, session, id);
  }

  if (request.method === "POST" && action === "remove") {
    const denied = requireManageSets(session);
    if (denied) {
      return denied;
    }

    const form = await request.formData();
    const documentId = Number(form.get("documentId"));
    const result = await removeDocumentFromSet(env, id, documentId, session, Number(form.get("expectedRowVersion")));

    if (!result.ok) {
      return renderSetDetails(env, session, id, { error: result.message });
    }

    return redirect(`/sets/${id}`);
  }

  if (request.method === "POST" && (action === "lock" || action === "unlock")) {
    const denied = requireManageSets(session);
    if (denied) return denied;
    const form = await request.formData();
    const result = await setDocumentSetLock(env, id, action === "lock", form.get("reason"), session, Number(form.get("expectedRowVersion")));
    if (!result.ok) {
      return renderSetDetails(env, session, id, { error: result.message });
    }
    return redirect(`/sets/${id}?toast=${action === "lock" ? "set-locked" : "set-unlocked"}`);
  }

  return notFoundPage(session);
}

async function handleAddSetDocuments(request, env, session, setId) {
  const form = await request.formData();
  const returnTo = safeWorkspaceReturn(form.get("returnTo"));
  const addQuery = clean(form.get("add-q"));
  const selectedIds = [...new Set(
    form.getAll("documentIds")
      .flatMap((value) => clean(value).split(","))
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0)
  )];
  const set = await getDocumentSet(env, setId);
  if (!set) {
    return notFoundPage(session);
  }

  if (Number(set.is_locked) === 1) {
    if (returnTo) return redirect(workspaceErrorReturn(returnTo, selectedIds));
    return renderSetDetails(env, session, setId, {
      addQuery,
      selectedCandidateIds: selectedIds,
      preserveAddSelection: Boolean(addQuery || selectedIds.length),
      error: "세트가 잠겨 문서를 추가하지 못했습니다. 검색 조건과 선택 문서는 그대로 유지했습니다."
    });
  }

  const documentId = Number(form.get("documentId"));
  const expectedRowVersion = Number(form.get("expectedRowVersion"));

  if (selectedIds.length) {
    if (selectedIds.length > 200) {
      if (returnTo) return redirect(workspaceErrorReturn(returnTo, selectedIds));
      return renderSetDetails(env, session, setId, {
        addQuery,
        selectedCandidateIds: selectedIds.slice(0, 200),
        error: "일괄 추가는 한 번에 200건 이하만 선택하세요."
      });
    }
    const result = await addDocumentsToSet(env, setId, selectedIds, session, expectedRowVersion);
    if (result.message) {
      if (returnTo) return redirect(workspaceErrorReturn(returnTo, selectedIds));
      return renderSetDetails(env, session, setId, {
        addQuery,
        selectedCandidateIds: selectedIds,
        error: result.message
      });
    }
    if (returnTo) return redirect(withToast(returnTo, "saved"));
    return renderSetDetails(env, session, setId, { addResult: { added: result.added, missing: [] } });
  }

  if (documentId) {
    const result = await addDocumentsToSet(env, setId, [documentId], session, expectedRowVersion);
    if (result.message) return renderSetDetails(env, session, setId, { error: result.message });
    const { added } = result;
    return renderSetDetails(env, session, setId, {
      addQuery: clean(form.get("add-q")),
      addResult: { added, missing: [] }
    });
  }

  const numbers = parseDocumentNumberList(form.get("numbers"));

  if (!numbers.length) {
    return renderSetDetails(env, session, setId, { error: "추가할 문서번호를 입력하세요." });
  }

  if (numbers.length > 200) {
    return renderSetDetails(env, session, setId, { error: "일괄 추가는 한 번에 200건 이하로 입력하세요." });
  }

  const { documents, missing } = await findDocumentsByNumbers(env, numbers);
  const result = await addDocumentsToSet(env, setId, documents.map((document) => document.id), session, expectedRowVersion);
  if (result.message) return renderSetDetails(env, session, setId, { error: result.message });
  const { added } = result;

  return renderSetDetails(env, session, setId, { addResult: { added, missing } });
}

function safeWorkspaceReturn(value) {
  const path = clean(value);
  try {
    const url = new URL(path, "https://archive.local");
    return url.origin === "https://archive.local" && url.pathname === "/app"
      ? `${url.pathname}${url.search}`
      : "";
  } catch {
    return "";
  }
}

function withToast(path, toast) {
  const url = new URL(path, "https://archive.local");
  url.searchParams.set("toast", toast);
  return `${url.pathname}${url.search}`;
}

function workspaceErrorReturn(path, selectedIds) {
  const url = new URL(path, "https://archive.local");
  const ids = selectedIds.slice(0, 200);
  if (ids.length) url.searchParams.set("selected", ids.join(","));
  return withToast(`${url.pathname}${url.search}`, "error");
}
