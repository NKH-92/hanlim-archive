export function actorFixture(overrides = {}) {
  return {
    userId: 17,
    username: "archive.admin",
    displayName: "문서고 관리자",
    role: "Admin",
    ...overrides
  };
}

export function documentFixture(overrides = {}) {
  return {
    id: 5,
    storage_code: "ARC-000005",
    document_number: "DOC-005",
    revision_number: "Rev.1",
    document_name: "기준 문서",
    status: "active",
    updated_at: "2026-07-17 09:10:11",
    row_version: 1,
    ...overrides
  };
}
