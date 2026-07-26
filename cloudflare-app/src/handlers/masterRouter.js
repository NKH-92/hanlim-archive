// 세트·랙·기준정보 라우트. routeRegistry가 해석한 route id와 params만 사용한다.
import {
  handleCategoryAction,
  handleSaveCategory,
  handleSaveTag,
  handleTagAction,
  renderCategories,
  renderTags
} from "../domains/masters/index.js";
import { requireManageMasters, requireManageSets } from "./permissionGuards.js";
import {
  handleRackConfigure,
  handleRackRoute,
  handleRacks,
  handleSaveRack,
  renderNewRackForm,
  renderRackConfigure
} from "./rackHandlers.js";
import { handleSaveSet, handleSetRoute, handleSets, renderNewSetForm } from "./setHandlers.js";

export async function routeMasterRequest(request, env, session, url, resolved) {
  const routeId = resolved?.descriptor?.id || "";
  const params = resolved?.params || {};

  if (routeId === "sets.list") return handleSets(request, env, session);
  if (routeId === "sets.create.form") return requireManageSets(session) ?? renderNewSetForm(session);
  if (routeId === "sets.create") return requireManageSets(session) ?? handleSaveSet(request, env, session);
  if (routeId.startsWith("sets.")) {
    const action = setAction(routeId);
    return action ? handleSetRoute(request, env, session, { id: Number(params.id), action }) : null;
  }

  if (routeId === "racks.list") return requireManageMasters(session) ?? handleRacks(env, session);
  if (routeId === "racks.new") return requireManageMasters(session) ?? renderNewRackForm(session);
  if (routeId === "racks.configure.form") {
    return requireManageMasters(session) ?? renderRackConfigure(env, session);
  }
  if (routeId === "racks.configure") {
    return requireManageMasters(session) ?? handleRackConfigure(request, env, session);
  }
  if (routeId === "racks.create") return requireManageMasters(session) ?? handleSaveRack(request, env, session);
  if (routeId.startsWith("racks.")) {
    const action = routeId === "racks.details" ? "details" : "edit";
    return requireManageMasters(session) ?? handleRackRoute(request, env, session, {
      id: Number(params.id),
      action
    });
  }

  if (routeId === "categories.list") return requireManageMasters(session) ?? renderCategories(env, session);
  if (routeId === "categories.save") return requireManageMasters(session) ?? handleSaveCategory(request, env, session);
  if (routeId === "categories.edit" || routeId === "categories.delete") {
    return requireManageMasters(session) ?? handleCategoryAction(request, env, session, {
      id: Number(params.id),
      action: routeId === "categories.edit" ? "edit" : "delete"
    });
  }

  if (routeId === "tags.list") {
    return requireManageMasters(session) ?? renderTags(env, session, "", {
      name: url.searchParams.get("name") || ""
    });
  }
  if (routeId === "tags.save") return requireManageMasters(session) ?? handleSaveTag(request, env, session);
  if (routeId === "tags.edit" || routeId === "tags.delete") {
    return requireManageMasters(session) ?? handleTagAction(request, env, session, {
      id: Number(params.id),
      action: routeId === "tags.edit" ? "edit" : "delete"
    });
  }

  return null;
}

function setAction(routeId) {
  if (routeId === "sets.details") return "details";
  if (routeId === "sets.export") return "export";
  if (routeId === "sets.export.csv") return "export.csv";
  if (routeId === "sets.edit.form" || routeId === "sets.edit") return "edit";
  if (routeId === "sets.clone.form" || routeId === "sets.clone") return "clone";
  if (routeId === "sets.delete") return "delete";
  if (routeId === "sets.add") return "add";
  if (routeId === "sets.remove") return "remove";
  if (routeId === "sets.lock") return "lock";
  if (routeId === "sets.unlock") return "unlock";
  return "";
}
