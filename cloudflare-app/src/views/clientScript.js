// page()의 기존 import 경로와 생성 스크립트 순서를 유지하는 클라이언트 호환 파사드.

import { escapeHtml } from "../utils.js";
import { bootstrapScript } from "./clientScript/bootstrap.js";
import { bulkCommandScript } from "./clientScript/bulkCommands.js";
import { instantSearchScript } from "./clientScript/instantSearch.js";
import { navigationFeedbackScript } from "./clientScript/navigationFeedback.js";
import { suggestionScript } from "./clientScript/suggestions.js";

// 즉시 검색 페이지에 검색 코어 원본을 그대로 내려보낸다(로직 단일 출처).
// wrangler(esbuild) 번들이 함수 소스에 __name() 헬퍼를 주입하므로 브라우저용 shim을 함께 보낸다.
export function searchCoreScript() {
  return `<script type="module" src="/assets/search-core.js"></script>`;
}

// escapeHtmlClient는 서버 utils.escapeHtml 소스를 그대로 내려보낸다(이스케이프 규칙 단일 출처).
// 각 조각은 하나의 DOMContentLoaded 콜백 안에서 기존 순서대로 이어진다.
export function clientScript() {
  return [
    "",
    bootstrapScript(escapeHtml.toString()),
    suggestionScript(),
    bulkCommandScript(),
    navigationFeedbackScript(),
    instantSearchScript(),
    "    });",
    "  "
  ].join("\n");
}
