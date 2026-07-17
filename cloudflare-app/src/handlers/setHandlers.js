import {
  addDocumentsToSet,
  deleteDocumentSet,
  findDocumentsByNumbers,
  getDocumentSet,
  getDocumentSetDocuments,
  getDocumentSetLogs,
  getDocumentSets,
  getRackSummaries,
  parseDocumentNumberList,
  removeDocumentFromSet,
  searchDocuments,
  setDocumentSetLock,
  upsertDocumentSet
} from "../db.js";
import { buildDocumentSetCsv } from "../documentCsv.js";
import { errorPage, notFoundPage, setDetailsPage, setFormPage, setsPage } from "../html.js";
import { hasPermission, PERMISSIONS } from "../permissions.js";
import { clean, redirect } from "../utils.js";
import { requireManageSets } from "./permissionGuards.js";
import { csvDownloadResponse } from "./responseHelpers.js";

export async function handleSets(env, session) {
  const sets = await getDocumentSets(env);
  return setsPage({ session, sets });
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
  if (hasPermission(session, PERMISSIONS.MANAGE_SETS) && options.addQuery && !Number(set.is_locked)) {
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

export async function handleSaveSet(request, env, session, id = 0) {
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

  if (request.method === "POST" && action === "delete") {
    const denied = requireManageSets(session);
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
    return requireManageSets(session) ?? handleAddSetDocuments(request, env, session, id);
  }

  if (request.method === "POST" && action === "remove") {
    const denied = requireManageSets(session);
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

  if (request.method === "POST" && (action === "lock" || action === "unlock")) {
    const denied = requireManageSets(session);
    if (denied) return denied;
    const form = await request.formData();
    const result = await setDocumentSetLock(env, id, action === "lock", form.get("reason"), session);
    if (!result.ok) {
      return renderSetDetails(env, session, id, { error: result.message });
    }
    return redirect(`/sets/${id}?toast=${action === "lock" ? "set-locked" : "set-unlocked"}`);
  }

  return notFoundPage(session);
}

async function handleAddSetDocuments(request, env, session, setId) {
  const set = await getDocumentSet(env, setId);
  if (!set) {
    return notFoundPage(session);
  }
  if (Number(set.is_locked) === 1) {
    return renderSetDetails(env, session, setId, { error: "잠긴 세트는 문서를 추가할 수 없습니다." });
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
    return renderSetDetails(env, session, setId, { error: "추가할 문서번호를 입력하세요." });
  }

  if (numbers.length > 200) {
    return renderSetDetails(env, session, setId, { error: "일괄 추가는 한 번에 200건 이하로 입력하세요." });
  }

  const { documents, missing } = await findDocumentsByNumbers(env, numbers);
  const { added } = await addDocumentsToSet(env, setId, documents.map((document) => document.id), session.displayName);

  return renderSetDetails(env, session, setId, { addResult: { added, missing } });
}
