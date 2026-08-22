import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUserProvisionSql,
  parseRoster,
  preflightUserProvision,
  PROTECTED_PROVISION_USERNAMES,
  userProvisionVerificationSql
} from "../scripts/provision-users-guarded.mjs";
import { rosterFromRows } from "../scripts/build-user-roster.mjs";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";

const DATABASE_ID = "a07324c0-7547-48a6-836e-3f0c50b85c36";
const OPERATION_ID = "github-run-30162018149";

function provisionValues(overrides = {}) {
  return {
    envName: "production",
    expectedDatabaseId: DATABASE_ID,
    roster: JSON.stringify([
      { username: "viewer.one@hanlim.com", displayName: "조회 1", team: "SQA팀" },
      { username: "viewer.two@hanlim.com", displayName: "조회 2", team: "QM팀" }
    ]),
    password: "123456",
    confirmation: `PROVISION-USERS:production:${DATABASE_ID}`,
    operationId: OPERATION_ID,
    ...overrides
  };
}

test("사용자 명단 파싱은 헤더를 인식하고 보호 계정을 팀 갱신 전용으로 남긴다", () => {
  const roster = rosterFromRows([
    ["이름", "부서", "이메일주소"],
    ["강현길", "품질본부", "Nalkil@hanlim.com"],
    ["남광현", "SQA팀", "nkh92@hanlim.com"],
    ["", "", ""]
  ]);

  assert.equal(roster.ok, true);
  assert.deepEqual(roster.entries, [
    { username: "nalkil@hanlim.com", displayName: "강현길", team: "품질본부" },
    { username: "nkh92@hanlim.com", displayName: "남광현", team: "SQA팀", teamOnly: true }
  ]);
  assert.deepEqual(roster.protectedUsernames, ["nkh92@hanlim.com"]);
});

test("사용자 명단 파싱은 잘못된 이메일과 중복을 거부한다", () => {
  const invalid = rosterFromRows([
    ["이름", "부서", "이메일주소"],
    ["이름없음", "QM팀", "not-an-email"]
  ]);
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors[0], /이메일 주소를 읽을 수 없습니다/);

  const duplicated = rosterFromRows([
    ["이름", "부서", "이메일주소"],
    ["첫째", "QM팀", "same@hanlim.com"],
    ["둘째", "QM팀", "same@hanlim.com"]
  ]);
  assert.equal(duplicated.ok, false);
  assert.match(duplicated.errors[0], /중복/);
});

test("roster JSON은 형식·중복·건수를 검증한다", () => {
  assert.equal(parseRoster("not json").ok, false);
  assert.equal(parseRoster("[]").ok, false);
  assert.equal(parseRoster(JSON.stringify([{ username: "nkh92@hanlim.com", displayName: "남광현" }])).ok, false);

  const oversized = JSON.stringify(Array.from({ length: 201 }, (_, index) => ({
    username: `user${index}@hanlim.com`,
    displayName: `사용자 ${index}`
  })));
  assert.match(parseRoster(oversized).errors[0], /200명까지/);

  const parsed = parseRoster(JSON.stringify([
    { username: "Viewer.One@hanlim.com", displayName: " 조회 1 ", team: " SQA팀 " },
    { username: "nkh92@hanlim.com", displayName: "남광현", team: "SQA팀" }
  ]));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.entries[0], {
    username: "viewer.one@hanlim.com",
    displayName: "조회 1",
    team: "SQA팀",
    protected: false
  });
  assert.equal(parsed.entries[1].protected, true);
});

test("provisioning preflight는 대상 환경·확인문구·비밀번호 정책을 함께 검사한다", () => {
  assert.equal(preflightUserProvision(provisionValues()).ok, true);

  const wrongConfirm = preflightUserProvision(provisionValues({ confirmation: "PROVISION-USERS:production:other" }));
  assert.equal(wrongConfirm.ok, false);
  assert.ok(wrongConfirm.errors.some((error) => /USER_PROVISION_CONFIRM/.test(error)));

  const shortPassword = preflightUserProvision(provisionValues({ password: "12345" }));
  assert.equal(shortPassword.ok, false);
  assert.ok(shortPassword.errors.some((error) => /USER_PROVISION_PASSWORD/.test(error)));

  const badOperation = preflightUserProvision(provisionValues({ operationId: "short" }));
  assert.equal(badOperation.ok, false);
  assert.ok(badOperation.errors.some((error) => /OPERATION_ID/.test(error)));

  const wrongDatabase = preflightUserProvision(provisionValues({ expectedDatabaseId: "00000000-0000-0000-0000-000000000000" }));
  assert.equal(wrongDatabase.ok, false);
});

test("생성 SQL은 조회 권한·최초 변경 강제만 심고 기존 계정은 팀만 갱신한다", async () => {
  const database = await createMigratedDatabase();
  try {
    // migration 0027~0041이 남긴 실제 보호 계정 상태를 기준으로 검증한다.
    const protectedColumns = `
      display_name, status, role, password_salt, password_hash,
      must_change_password, security_review_required, approved_by, session_epoch
    `;
    const before = database.prepare(`
      SELECT ${protectedColumns} FROM app_users WHERE username = 'nkh92@hanlim.com'
    `).get();
    assert.ok(before, "보호 계정이 migration으로 존재해야 한다");
    const usersBefore = database.prepare("SELECT COUNT(*) AS count FROM app_users").get().count;

    const entries = [
      { username: "viewer.one@hanlim.com", displayName: "조회 1", team: "SQA팀", protected: false },
      { username: "nkh92@hanlim.com", displayName: "남광현", team: "SQA팀", protected: true }
    ];
    const sql = buildUserProvisionSql({
      entries,
      passwordRecords: new Map([["viewer.one@hanlim.com", { salt: "new-salt", hash: "new-hash" }]]),
      provisioningActor: `guarded-user-provisioning:${OPERATION_ID}`
    });

    const insertStatements = sql.split(";").filter((statement) => /INSERT INTO app_users/.test(statement));
    assert.equal(insertStatements.length, 1);
    assert.doesNotMatch(insertStatements[0], /nkh92@hanlim\.com/);
    assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM app_users WHERE username = 'viewer\.one@hanlim\.com'\)/);
    database.exec(sql);

    const created = database.prepare(`
      SELECT display_name, team, status, role, role_template_key, must_change_password,
        security_review_required, approved_by, password_salt,
        can_manage_documents, can_move_documents, can_manage_disposals, can_manage_sets,
        can_manage_masters, can_manage_users, can_view_audit, can_apply_document_snapshots
      FROM app_users WHERE username = 'viewer.one@hanlim.com'
    `).get();
    assert.deepEqual({ ...created }, {
      display_name: "조회 1",
      team: "SQA팀",
      status: "approved",
      role: "User",
      role_template_key: "viewer",
      must_change_password: 1,
      security_review_required: 0,
      approved_by: `guarded-user-provisioning:${OPERATION_ID}`,
      password_salt: "new-salt",
      can_manage_documents: 0,
      can_move_documents: 0,
      can_manage_disposals: 0,
      can_manage_sets: 0,
      can_manage_masters: 0,
      can_manage_users: 0,
      can_view_audit: 0,
      can_apply_document_snapshots: 0
    });

    // 보호 계정은 팀만 채워지고 credential·역할·상태·session epoch는 그대로다.
    const after = database.prepare(`
      SELECT team, ${protectedColumns} FROM app_users WHERE username = 'nkh92@hanlim.com'
    `).get();
    const { team, ...unchanged } = after;
    assert.equal(team, "SQA팀");
    assert.deepEqual({ ...unchanged }, { ...before });

    // 같은 SQL을 다시 실행해도 계정이 늘거나 credential이 바뀌지 않는다.
    database.exec(sql);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM app_users").get().count, usersBefore + 1);
    assert.equal(
      database.prepare("SELECT password_salt FROM app_users WHERE username = 'viewer.one@hanlim.com'").get().password_salt,
      "new-salt"
    );
  } finally {
    database.close();
  }
});

test("검증 쿼리는 명단 전원 존재와 이번 작업 계정의 조회 권한 형태를 확인한다", () => {
  const sql = userProvisionVerificationSql({
    entries: [{ username: "viewer.one@hanlim.com" }, { username: "viewer.two@hanlim.com" }],
    provisioningActor: `guarded-user-provisioning:${OPERATION_ID}`
  });
  assert.match(sql, /present_count/);
  assert.match(sql, /ready_count/);
  assert.match(sql, /must_change_password = 1/);
  assert.match(sql, /role_template_key = 'viewer'/);
  for (const column of [
    "can_manage_documents",
    "can_move_documents",
    "can_manage_disposals",
    "can_manage_sets",
    "can_manage_masters",
    "can_manage_users",
    "can_view_audit",
    "can_apply_document_snapshots"
  ]) {
    assert.match(sql, new RegExp(`${column} = 0`));
  }
});

test("보호 계정 목록은 알려진 bootstrap·smoke 계정을 포함한다", () => {
  assert.equal(PROTECTED_PROVISION_USERNAMES.has("nkh92@hanlim.com"), true);
  assert.equal(PROTECTED_PROVISION_USERNAMES.has("release-smoke@hanlim.internal"), true);
});
