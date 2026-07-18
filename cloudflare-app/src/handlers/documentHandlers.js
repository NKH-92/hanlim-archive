// 기존 라우터의 공개 import 경로를 유지하는 문서 핸들러 호환 배럴이다.
export { handleDocumentExport, handleDocuments } from "./documents/browse.js";
export {
  handleCreateDocument,
  handleDuplicateDocumentCheck,
  handleDocumentRoute,
  renderCreateDocument
} from "./documents/crud.js";
export {
  handleBulkDispose,
  handleSelectedDisposal,
  handleDisposalWorkspace,
  handleFilteredDispose
} from "./documents/disposal.js";
