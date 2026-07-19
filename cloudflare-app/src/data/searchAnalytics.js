// 검색 분석: 클릭 학습 랭킹 + 검색어 로그.
// 마이그레이션 0014 이전 배포에서도 검색이 죽지 않도록 전부 실패 허용.

import { sharedSearchCore } from "../searchCore.js";
import { logError } from "../platform/observability/logger.js";
import { clean } from "../shared/text/normalize.js";

const { compactSearchText } = sharedSearchCore;

export async function getSearchClickHits(env, query) {
  const key = compactSearchText(query);
  if (!key || key.length > 80) return null;
  try {
    const result = await env.DB.prepare(
      "SELECT document_id, hits FROM search_clicks WHERE query_key = ?"
    ).bind(key).all();
    const map = new Map();
    for (const row of result.results ?? []) {
      map.set(Number(row.document_id), Number(row.hits) || 0);
    }
    return map.size ? map : null;
  } catch (error) {
    logError("db.getSearchClickHits", error);
    return null;
  }
}

export async function recordSearchClick(env, query, documentId) {
  const key = compactSearchText(query);
  const id = Number(documentId);
  if (!key || key.length > 80 || !Number.isInteger(id) || id <= 0) {
    return { ok: false };
  }
  try {
    await env.DB.prepare(`
      INSERT INTO search_clicks (query_key, document_id)
      VALUES (?, ?)
      ON CONFLICT(query_key, document_id)
      DO UPDATE SET hits = hits + 1, last_clicked_at = CURRENT_TIMESTAMP
    `).bind(key, id).run();
    return { ok: true };
  } catch (error) {
    logError("db.recordSearchClick", error);
    return { ok: false };
  }
}

export async function recordSearchLog(env, query, resultCount) {
  const text = clean(query);
  const key = compactSearchText(query);
  if (!key || key.length > 80) return;
  try {
    await env.DB.prepare(`
      INSERT INTO search_logs (query_key, query_text, last_result_count)
      VALUES (?, ?, ?)
      ON CONFLICT(query_key)
      DO UPDATE SET
        hits = hits + 1,
        query_text = excluded.query_text,
        last_result_count = excluded.last_result_count,
        last_searched_at = CURRENT_TIMESTAMP
    `).bind(key, text.slice(0, 120), Math.max(0, Number(resultCount) || 0)).run();
  } catch (error) {
    // 분석 로그는 검색 자체를 막지 않는다. 실패는 로깅만 한다.
    logError("db.recordSearchLog", error);
  }
}

export async function getSearchReport(env) {
  try {
    const [top, failed, clicked] = await Promise.all([
      env.DB.prepare(`
        SELECT query_text, hits, last_result_count, last_searched_at
        FROM search_logs
        WHERE last_result_count > 0
        ORDER BY hits DESC, last_searched_at DESC
        LIMIT 20
      `).all(),
      env.DB.prepare(`
        SELECT query_text, hits, last_searched_at
        FROM search_logs
        WHERE last_result_count = 0
        ORDER BY hits DESC, last_searched_at DESC
        LIMIT 20
      `).all(),
      env.DB.prepare(`
        SELECT d.id, d.document_number, d.document_name, SUM(sc.hits) AS click_count
        FROM search_clicks sc
        JOIN documents d ON d.id = sc.document_id
        GROUP BY d.id
        ORDER BY click_count DESC
        LIMIT 10
      `).all()
    ]);
    return {
      topQueries: top.results ?? [],
      failedQueries: failed.results ?? [],
      topDocuments: clicked.results ?? []
    };
  } catch (error) {
    logError("db.getSearchReport", error);
    return { topQueries: [], failedQueries: [], topDocuments: [], unavailable: true };
  }
}

export async function getDocumentClickPopularity(env) {
  try {
    const result = await env.DB.prepare(
      "SELECT document_id, SUM(hits) AS total FROM search_clicks GROUP BY document_id"
    ).all();
    return new Map((result.results ?? []).map((row) => [Number(row.document_id), Number(row.total) || 0]));
  } catch (error) {
    logError("db.getDocumentClickPopularity", error);
    return new Map();
  }
}
