// 데이터 품질 작업목록 라우트.

import { dataQualityPage, getDataQualityPage } from "../domains/dataQuality/index.js";
import { requireManageDocuments } from "./permissionGuards.js";

export async function handleDataQuality(request, env, session) {
  const denied = requireManageDocuments(session);
  if (denied) return denied;
  const url = new URL(request.url);
  const result = await getDataQualityPage(
    env,
    url.searchParams.get("issue"),
    Number(url.searchParams.get("page")),
    30
  );
  return dataQualityPage({ session, result });
}
