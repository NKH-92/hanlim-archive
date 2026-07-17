// 세트와 문서고 기준정보 라우트. 미매칭은 상위 라우터에 null로 넘긴다.
import { matchMasterRoute, matchRackRoute, matchSetRoute } from "../routes.js";
import {
  handleCategoryAction,
  handleSaveCategory,
  handleSaveTag,
  handleTagAction,
  renderCategories,
  renderTags
} from "./adminHandlers.js";
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

export async function routeMasterRequest(request, env, session, url, path) {
  if (path === "/sets" && request.method === "GET") {
    return handleSets(env, session);
  }

  if (path === "/sets/new" && request.method === "GET") {
    return requireManageSets(session) ?? renderNewSetForm(session);
  }

  if (path === "/sets" && request.method === "POST") {
    return requireManageSets(session) ?? handleSaveSet(request, env, session);
  }

  const setRoute = matchSetRoute(path);
  if (setRoute) {
    return handleSetRoute(request, env, session, setRoute);
  }

  if (path === "/racks" && request.method === "GET") {
    return requireManageMasters(session) ?? handleRacks(env, session);
  }

  if (path === "/racks/new" && request.method === "GET") {
    return requireManageMasters(session) ?? renderNewRackForm(session);
  }

  if (path === "/racks/configure" && request.method === "GET") {
    return requireManageMasters(session) ?? renderRackConfigure(env, session);
  }

  if (path === "/racks/configure" && request.method === "POST") {
    return requireManageMasters(session) ?? handleRackConfigure(request, env, session);
  }

  if (path === "/racks" && request.method === "POST") {
    return requireManageMasters(session) ?? handleSaveRack(request, env, session);
  }

  const rackRoute = matchRackRoute(path);
  if (rackRoute) {
    return requireManageMasters(session) ?? handleRackRoute(request, env, session, rackRoute);
  }

  if (path === "/categories" && request.method === "GET") {
    return requireManageMasters(session) ?? renderCategories(env, session);
  }

  if (path === "/categories" && request.method === "POST") {
    return requireManageMasters(session) ?? handleSaveCategory(request, env, session);
  }

  const categoryRoute = matchMasterRoute(path, "categories");
  if (categoryRoute && request.method === "POST") {
    return requireManageMasters(session) ?? handleCategoryAction(request, env, session, categoryRoute);
  }

  if (path === "/tags" && request.method === "GET") {
    return requireManageMasters(session) ?? renderTags(env, session, "", {
      name: url.searchParams.get("name") || ""
    });
  }

  if (path === "/tags" && request.method === "POST") {
    return requireManageMasters(session) ?? handleSaveTag(request, env, session);
  }

  const tagRoute = matchMasterRoute(path, "tags");
  if (tagRoute && request.method === "POST") {
    return requireManageMasters(session) ?? handleTagAction(request, env, session, tagRoute);
  }

  return null;
}
