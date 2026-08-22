#!/usr/bin/env node

const accountId = required("CLOUDFLARE_ACCOUNT_ID");
const apiToken = required("CLOUDFLARE_API_TOKEN");
const sourceDatabaseId = required("SOURCE_D1_DATABASE_ID");
const targetDatabaseId = required("TARGET_D1_DATABASE_ID");

if (sourceDatabaseId === targetDatabaseId) {
  throw new Error("source와 target D1은 서로 달라야 합니다.");
}

const sourceUsers = await query(sourceDatabaseId, `
  SELECT *
  FROM app_users
  WHERE status = 'approved'
  ORDER BY id
`);
if (sourceUsers.length === 0) throw new Error("보존할 승인 사용자가 없습니다.");

const sourceColumns = await tableColumns(sourceDatabaseId, "app_users");
const targetColumns = await tableColumns(targetDatabaseId, "app_users");
const userColumns = sourceColumns.filter((column) => targetColumns.includes(column));
if (!userColumns.includes("id") || !userColumns.includes("username")) {
  throw new Error("app_users identity 열을 확인할 수 없습니다.");
}

const roleTemplates = await query(sourceDatabaseId, "SELECT * FROM user_role_templates ORDER BY id");
const sourceTemplateColumns = await tableColumns(sourceDatabaseId, "user_role_templates");
const targetTemplateColumns = await tableColumns(targetDatabaseId, "user_role_templates");
const templateColumns = sourceTemplateColumns.filter((column) => targetTemplateColumns.includes(column));

await batch(targetDatabaseId, [
  { sql: "DELETE FROM app_users", params: [] },
  ...sourceUsers.map((user) => insertStatement("app_users", userColumns, user)),
  { sql: "DELETE FROM user_role_templates", params: [] },
  ...roleTemplates.map((template) => insertStatement("user_role_templates", templateColumns, template))
]);

const verification = await query(targetDatabaseId, `
  SELECT
    COUNT(*) AS approved_user_count,
    SUM(CASE WHEN role = 'Admin'
      AND can_manage_users = 1
      AND must_change_password = 0
      AND COALESCE(security_review_required, 0) = 0
      THEN 1 ELSE 0 END) AS ready_admin_count
  FROM app_users
  WHERE status = 'approved'
`);
const approvedUserCount = Number(verification[0]?.approved_user_count || 0);
const readyAdminCount = Number(verification[0]?.ready_admin_count || 0);
if (approvedUserCount !== sourceUsers.length || readyAdminCount < 1) {
  throw new Error("새 Core의 승인 사용자 또는 Admin readiness 검증에 실패했습니다.");
}

console.log(JSON.stringify({
  action: "prepare-fresh-core-identity",
  approvedUserCount,
  readyAdminCount,
  roleTemplateCount: roleTemplates.length
}));

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} 환경변수가 필요합니다.`);
  return value;
}

async function tableColumns(databaseId, tableName) {
  const rows = await query(databaseId, `PRAGMA table_info(${quoteIdentifier(tableName)})`);
  return rows.map((row) => String(row.name));
}

function insertStatement(tableName, columns, row) {
  const names = columns.map(quoteIdentifier).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  return {
    sql: `INSERT INTO ${quoteIdentifier(tableName)} (${names}) VALUES (${placeholders})`,
    params: columns.map((column) => row[column] ?? null)
  };
}

function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error("안전하지 않은 SQL identifier입니다.");
  return `"${value}"`;
}

async function query(databaseId, sql, params = []) {
  const payload = await request(databaseId, { sql, params });
  const execution = Array.isArray(payload) ? payload.at(-1) : payload;
  return execution?.results || [];
}

async function batch(databaseId, statements) {
  const payload = await request(databaseId, { batch: statements });
  const executions = Array.isArray(payload) ? payload : [payload];
  if (executions.length !== statements.length || executions.some((execution) => execution?.success !== true)) {
    throw new Error("새 Core identity batch가 완전히 적용되지 않았습니다.");
  }
}

async function request(databaseId, body) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );
  const envelope = await response.json();
  if (!response.ok || envelope?.success !== true) {
    const code = envelope?.errors?.[0]?.code || response.status;
    throw new Error(`D1 API 요청이 실패했습니다(code=${code}).`);
  }
  return envelope.result;
}
