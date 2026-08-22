#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

let accountId = "";
let apiToken = "";

export const ROLE_TEMPLATE_COMPARISON_COLUMNS = Object.freeze([
  "key", "label",
  "can_manage_documents", "can_move_documents", "can_manage_disposals", "can_manage_sets",
  "can_manage_masters", "can_manage_users", "can_view_audit", "can_apply_document_snapshots",
  "row_version", "updated_by"
]);

async function main() {
  accountId = required("CLOUDFLARE_ACCOUNT_ID");
  apiToken = required("CLOUDFLARE_API_TOKEN");
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

  const roleTemplateSql = roleTemplateComparisonSql();
  const roleTemplates = await query(sourceDatabaseId, roleTemplateSql);
  const targetRoleTemplates = await query(targetDatabaseId, roleTemplateSql);
  if (JSON.stringify(roleTemplates) !== JSON.stringify(targetRoleTemplates)) {
    throw new Error("운영 Core와 새 Core의 역할 템플릿이 일치하지 않습니다.");
  }

  await batch(targetDatabaseId, buildIdentityCopyBatch({
    sourceUsers,
    userColumns
  }));

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
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} 환경변수가 필요합니다.`);
  return value;
}

async function tableColumns(databaseId, tableName) {
  const rows = await query(databaseId, `PRAGMA table_info(${quoteIdentifier(tableName)})`);
  return rows.map((row) => String(row.name));
}

export function bulkInsertStatement(tableName, columns, rows) {
  if (!Array.isArray(columns) || columns.length === 0) throw new Error("복제할 열이 없습니다.");
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("복제할 행이 없습니다.");
  const names = columns.map(quoteIdentifier).join(", ");
  const selectors = columns.map((column) => `json_extract(value, '$.${column}')`).join(", ");
  return {
    sql: `INSERT INTO ${quoteIdentifier(tableName)} (${names}) SELECT ${selectors} FROM json_each(?)`,
    params: [JSON.stringify(rows)]
  };
}

export function buildIdentityCopyBatch({ sourceUsers, userColumns }) {
  return [
    { sql: "DELETE FROM app_users", params: [] },
    bulkInsertStatement("app_users", userColumns, sourceUsers)
  ];
}

export function roleTemplateComparisonSql() {
  return `SELECT ${ROLE_TEMPLATE_COMPARISON_COLUMNS.map(quoteIdentifier).join(", ")} FROM user_role_templates ORDER BY key`;
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
