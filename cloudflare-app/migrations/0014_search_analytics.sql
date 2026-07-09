-- 검색 클릭 학습 + 검색어 로그 (아이디어 8, 9)
-- search_clicks: 정규화된 검색어별로 어떤 문서가 클릭됐는지 집계해 랭킹 부스트에 쓴다.
-- search_logs: 검색어별 실행 횟수와 마지막 결과 수를 집계해 실패 검색 리포트에 쓴다.

CREATE TABLE IF NOT EXISTS search_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_key TEXT NOT NULL,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  hits INTEGER NOT NULL DEFAULT 1,
  last_clicked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (query_key, document_id)
);

CREATE INDEX IF NOT EXISTS idx_search_clicks_query ON search_clicks(query_key);
CREATE INDEX IF NOT EXISTS idx_search_clicks_document ON search_clicks(document_id);

CREATE TABLE IF NOT EXISTS search_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_key TEXT NOT NULL UNIQUE,
  query_text TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1,
  last_result_count INTEGER NOT NULL DEFAULT 0,
  last_searched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_search_logs_result ON search_logs(last_result_count, hits);
