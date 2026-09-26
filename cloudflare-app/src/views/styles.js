// page()의 기존 import 경로와 CSS 출력 순서를 유지하는 전역 스타일 호환 파사드.

import { workspaceStyles } from "./styles/workspace.js";
import { iconStyles } from "./icons.js";
import { adminStyles } from "./styles/admin.js";
import { appStyles } from "./styles/app.js";
import { appBaseStyles } from "./styles/appBase.js";
import { baseStyles } from "./styles/base.js";
import { floorPlanStyles } from "./styles/floorPlan.js";
import { landingStyles } from "./styles/landing.js";
import { experienceStyles } from "./styles/experience.js";
import { responsivePrintStyles } from "./styles/responsivePrint.js";
import { searchStyles } from "./styles/search.js";
import { searchHomeStyles } from "./styles/searchHome.js";
import { tokenStyles } from "./styles/tokens.js";
import { workflowStyles } from "./styles/workflow.js";

// appBase는 요소 기본값 바로 뒤, app은 업무 화면 조각의 마지막에 둔다. 둘 다 .app-body 범위라 랜딩에는 적용되지 않는다.
const styleFragments = Object.freeze([
  tokenStyles,
  baseStyles,
  searchStyles,
  appBaseStyles,
  floorPlanStyles,
  adminStyles,
  workflowStyles,
  searchHomeStyles,
  experienceStyles,
  responsivePrintStyles,
  workspaceStyles,
  appStyles,
  landingStyles
]);

export function styles() {
  return [iconStyles(), ...styleFragments.map((fragment) => fragment()), "  "].join("\n");
}
