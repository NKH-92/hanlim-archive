import {
  DEFAULT_RACK_COLUMNS,
  DEFAULT_RACK_SHELVES,
  MAX_RACKS_PER_ZONE,
  RACK_ZONES
} from "../config.js";
import {
  configureRackCounts,
  getRackConfigurationVersion,
  getRackDetails,
  getRackDocuments,
  getRackGrid,
  getRackSummaries,
  upsertRack
} from "../domains/racks/index.js";
import { notFoundPage } from "../views/authViews.js";
import { rackConfigurePage, rackDetailsPage, rackFormPage, racksPage } from "../views/rackViews.js";
import { redirect } from "../platform/http/responses.js";
import { logError } from "../platform/observability/logger.js";
import { clean } from "../shared/text/normalize.js";
import { requireManageMasters } from "./permissionGuards.js";
import { isExpectedChangeAbort } from "../platform/d1/expectedChange.js";

export async function handleRacks(env, session) {
  const racks = await getRackSummaries(env);
  return racksPage({ session, racks });
}

export function renderNewRackForm(session) {
  return rackFormPage({
    session,
    values: { rackNumber: 1 },
    action: "/racks",
    title: "랙 추가"
  });
}

export async function handleRackRoute(request, env, session, routeInfo) {
  const { id, action } = routeInfo;

  if (request.method === "GET" && action === "details") {
    const [rack, documents, grid] = await Promise.all([
      getRackDetails(env, id),
      getRackDocuments(env, id),
      getRackGrid(env, id)
    ]);

    if (!rack) {
      return notFoundPage(session);
    }

    const url = new URL(request.url);
    const selectedFace = url.searchParams.get("face") === "B" ? "B" : "A";
    const selectedColumn = Number(url.searchParams.get("column"));
    const selectedShelf = Number(url.searchParams.get("shelf"));
    return rackDetailsPage({
      session,
      rack,
      documents,
      grid,
      selectedFace,
      selectedColumn: Number.isInteger(selectedColumn) && selectedColumn > 0 ? selectedColumn : 0,
      selectedShelf: Number.isInteger(selectedShelf) && selectedShelf > 0 ? selectedShelf : 0
    });
  }

  if (request.method === "GET" && action === "edit") {
    const denied = requireManageMasters(session);
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
    const denied = requireManageMasters(session);
    if (denied) {
      return denied;
    }
    return handleSaveRack(request, env, session, id);
  }

  return notFoundPage(session);
}

export async function renderRackConfigure(env, session, error = "") {
  const [racks, expectedVersion] = await Promise.all([
    getRackSummaries(env),
    getRackConfigurationVersion(env)
  ]);
  const counts = Object.fromEntries(RACK_ZONES.map((zone) => [zone, 0]));

  for (const rack of racks) {
    counts[rack.zone_number] = Math.max(counts[rack.zone_number], rack.rack_number);
  }

  return rackConfigurePage({ session, counts, expectedVersion, error });
}

export async function handleRackConfigure(request, env, session) {
  const form = await request.formData();
  const counts = Object.fromEntries(
    RACK_ZONES.map((zone) => [zone, Number(form.get(`zone${zone}Count`))])
  );
  const result = await configureRackCounts(env, counts, session, Number(form.get("expectedVersion")));

  if (!result.ok) {
    return renderRackConfigure(env, session, result.message);
  }

  return redirect("/racks?toast=saved");
}

export async function handleSaveRack(request, env, session, id = 0) {
  const form = await request.formData();
  const values = {
    id,
    zoneNumber: Number(form.get("zoneNumber")),
    rackNumber: Number(form.get("rackNumber")),
    // 랙 구조는 실물 규격(면당 7열×6선반=42칸)으로 고정한다. 폼 입력을 받지 않으며,
    // 과거 규격으로 남아 있던 랙도 저장 시 이 값으로 정렬된다.
    columnCount: DEFAULT_RACK_COLUMNS,
    shelfCount: DEFAULT_RACK_SHELVES,
    name: clean(form.get("name")),
    description: clean(form.get("description")),
    isSingleSided: form.get("isSingleSided") === "1",
    isActive: form.get("isActive") === "1",
    ...(id ? { expectedRowVersion: Number(form.get("expectedRowVersion")) } : {})
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
        error: "2면에 문서가 있는 랙은 단면 랙으로 변경할 수 없습니다."
      });
    }
  }

  try {
    const rackId = await upsertRack(env, values, session);
    return redirect(`/racks/${rackId}?toast=saved`);
  } catch (error) {
    if (isExpectedChangeAbort(error)) {
      return rackFormPage({
        session,
        values,
        action: id ? `/racks/${id}/edit` : "/racks",
        title: id ? "랙 수정" : "랙 추가",
        error: error.message
      });
    }
    const duplicate = error instanceof Error
      && (error.code === "RACK_LOCATION_EXISTS" || error.message.includes("UNIQUE"));
    if (!duplicate) {
      logError("rack.save", error, { rackId: id || null });
    }
    return rackFormPage({
      session,
      values,
      action: id ? `/racks/${id}/edit` : "/racks",
      title: id ? "랙 수정" : "랙 추가",
      error: duplicate ? "같은 구역에 동일한 랙 번호가 이미 있습니다." : "랙을 저장하는 중 오류가 발생했습니다."
    });
  }
}
