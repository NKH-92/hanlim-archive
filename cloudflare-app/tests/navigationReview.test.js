import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { navigationFeedbackScript } from "../src/views/clientScript/navigationFeedback.js";

function activeNavigation(path, hrefs) {
  const items = hrefs.map((href) => ({
    href,
    attributes: {},
    getAttribute: (key) => key === "href" ? href : "",
    setAttribute(key, value) { this.attributes[key] = value; },
    classList: { add() {} }
  }));
  const context = {
    location: new URL(path, "https://archive.example"),
    URL, URLSearchParams,
    document: { querySelectorAll: (selector) => selector.startsWith(".archive-nav-item") ? items : [], addEventListener() {} },
    localStorage: { getItem: () => null }
  };
  vm.runInNewContext(navigationFeedbackScript(), context);
  return items.filter((item) => item.attributes["aria-current"] === "page").map((item) => item.href);
}

test("상세 업무는 상위 메뉴를 표시하고 정확한 경로와 쿼리 선택을 유지한다", () => {
  const hrefs = ["/app", "/documents/new", "/documents/import", "/documents/disposal", "/documents/disposal?tab=documents", "/admin"];
  for (const [path, expected] of [
    ["/documents/7", "/app"],
    ["/documents/7/revise?returnTo=%2Fapp", "/app"],
    ["/documents/7/move", "/app"],
    ["/documents/new", "/documents/new"],
    ["/document-snapshots/7", "/documents/import"],
    ["/disposal-batches/7", "/documents/disposal"],
    ["/documents/disposal?tab=documents", "/documents/disposal?tab=documents"],
    ["/documents/disposal", "/documents/disposal"],
    ["/admin/settings", "/admin"]
  ]) {
    assert.deepEqual(activeNavigation(path, hrefs), [expected], path);
  }
});

test("사용자 추가·권한·역할 화면은 운영 관리가 아니라 사용자 관리 메뉴를 표시한다", () => {
  const hrefs = ["/app", "/admin", "/admin/settings", "/admin/audit"];
  for (const [path, expected] of [
    ["/admin/users/new", "/admin/settings"],
    ["/admin/users/17/permissions", "/admin/settings"],
    ["/admin/users/17/reset-password", "/admin/settings"],
    ["/admin/role-templates", "/admin/settings"],
    ["/admin/role-templates/viewer/edit", "/admin/settings"],
    ["/admin/search-report", "/admin"],
    ["/admin/audit", "/admin/audit"]
  ]) {
    assert.deepEqual(activeNavigation(path, hrefs), [expected], path);
  }
});
