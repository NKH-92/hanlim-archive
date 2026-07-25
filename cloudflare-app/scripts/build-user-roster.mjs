#!/usr/bin/env node
/**
 * 사용자 명단(XLSX/CSV) → provisioning roster JSON 변환기.
 *
 * 이 스크립트는 로컬 전용 도구다. 입력 파일과 출력 JSON은 실명·이메일·팀을 담으므로
 * 저장소에 커밋하지 않는다(.gitignore로 차단). 출력값은 production Environment secret
 * `USER_PROVISION_ROSTER`에 붙여넣는 용도로만 사용한다.
 *
 * 사용법:
 *   node scripts/build-user-roster.mjs --input ../명단.xlsx --out ../provisioning-local/roster.json
 *   node scripts/build-user-roster.mjs --input ../명단.csv  --out ../provisioning-local/roster.json
 *
 * 열 인식: 헤더에서 이름/성명, 부서/팀, 이메일/메일 주소를 찾는다. 헤더가 없으면 이름·부서·이메일 순서로 읽는다.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PROTECTED_PROVISION_USERNAMES } from "./provision-users-guarded.mjs";

const NAME_HEADERS = ["이름", "성명", "name", "displayname"];
const TEAM_HEADERS = ["부서", "팀", "팀명", "부서명", "team", "department"];
const EMAIL_HEADERS = ["이메일주소", "이메일", "메일", "메일주소", "email", "mail", "username"];

export function parseArgs(argv) {
  const args = { input: "", out: "" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--input") args.input = String(argv[index + 1] || "");
    if (argv[index] === "--out") args.out = String(argv[index + 1] || "");
  }
  return args;
}

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replaceAll(" ", "");
}

function headerIndexes(row) {
  const normalized = row.map(normalizeHeader);
  const find = (candidates) => normalized.findIndex((cell) => candidates.includes(cell));
  return { name: find(NAME_HEADERS), team: find(TEAM_HEADERS), email: find(EMAIL_HEADERS) };
}

/** @param {string[][]} rows */
export function rosterFromRows(rows) {
  const table = rows.filter((row) => row.some((cell) => String(cell ?? "").trim()));
  if (!table.length) return { ok: false, errors: ["명단에서 읽을 수 있는 행이 없습니다."] };

  let columns = headerIndexes(table[0]);
  let body = table;
  if (columns.name >= 0 && columns.email >= 0) {
    body = table.slice(1);
  } else {
    columns = { name: 0, team: 1, email: 2 };
  }

  const errors = [];
  const seen = new Set();
  const entries = [];
  const skipped = [];
  body.forEach((row, offset) => {
    const line = offset + (body === table ? 1 : 2);
    const displayName = String(row[columns.name] ?? "").trim();
    const team = columns.team >= 0 ? String(row[columns.team] ?? "").trim() : "";
    const username = String(row[columns.email] ?? "").trim().toLowerCase();
    if (!displayName && !username) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
      errors.push(`${line}행: 이메일 주소를 읽을 수 없습니다.`);
      return;
    }
    if (!displayName) {
      errors.push(`${line}행: 이름이 비어 있습니다.`);
      return;
    }
    if (seen.has(username)) {
      errors.push(`${line}행: 이메일 주소가 중복됩니다.`);
      return;
    }
    seen.add(username);
    const entry = { username, displayName, ...(team ? { team } : {}) };
    // 보호 계정은 생성 대상에서 빼고 팀 갱신 전용으로만 남긴다.
    if (PROTECTED_PROVISION_USERNAMES.has(username)) {
      skipped.push(username);
      entries.push({ ...entry, teamOnly: true });
      return;
    }
    entries.push(entry);
  });

  if (errors.length) return { ok: false, errors };
  if (!entries.length) return { ok: false, errors: ["등록할 사용자가 없습니다."] };
  return { ok: true, entries, protectedUsernames: skipped };
}

function parseCsv(text) {
  return String(text)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.split(",").map((cell) => cell.replace(/^"(.*)"$/, "$1")));
}

async function readXlsxRows(inputPath) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("첫 번째 워크시트를 찾을 수 없습니다.");
  const rows = [];
  sheet.eachRow((row) => {
    rows.push(row.values.slice(1).map((value) => {
      if (value === null || value === undefined) return "";
      if (typeof value === "object" && value.text) return String(value.text);
      if (typeof value === "object" && value.hyperlink) return String(value.hyperlink);
      if (typeof value === "object" && value.result !== undefined) return String(value.result);
      return String(value);
    }));
  });
  return rows;
}

export async function buildUserRoster({ input, out } = {}) {
  if (!input || !out) {
    return { ok: false, errors: ["--input과 --out 경로가 모두 필요합니다."] };
  }
  const rows = /\.csv$/i.test(input)
    ? parseCsv(readFileSync(input, "utf8"))
    : await readXlsxRows(input);
  const roster = rosterFromRows(rows);
  if (!roster.ok) return roster;

  mkdirSync(path.dirname(out), { recursive: true });
  const creatable = roster.entries.filter(({ teamOnly }) => !teamOnly);
  writeFileSync(out, `${JSON.stringify(roster.entries.map(({ teamOnly, ...entry }) => entry), null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  return {
    ok: true,
    out,
    total: roster.entries.length,
    creatable: creatable.length,
    protectedUsernames: roster.protectedUsernames
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await buildUserRoster(parseArgs(process.argv.slice(2)));
  if (!result.ok) {
    for (const error of result.errors) console.error(`[users:roster] ${error}`);
    process.exit(1);
  }
  console.log(JSON.stringify({
    action: "build-user-roster",
    out: result.out,
    total: result.total,
    creatable: result.creatable,
    protected: result.protectedUsernames.length
  }));
}
