// 뷰 레이어 배럴: 화면 렌더 함수를 views/ 모듈에서 모아 재수출한다.

export { page } from "./views/layout.js";
export { accessDeniedPage, errorPage, loginPage, notFoundPage, signupPage } from "./views/authViews.js";
export { dashboardPage, qaPage, searchReportPage } from "./views/searchViews.js";
export { disposalWorkspacePage, documentDetailsPage, documentFormPage, documentImportPage, documentsPage } from "./views/documentViews.js";
export { setDetailsPage, setFormPage, setsPage } from "./views/setViews.js";
export { rackConfigurePage, rackDetailsPage, rackFormPage, racksPage } from "./views/rackViews.js";
export { adminDashboardPage, adminSettingsPage, categoriesPage, passwordPage, tagsPage } from "./views/adminViews.js";
