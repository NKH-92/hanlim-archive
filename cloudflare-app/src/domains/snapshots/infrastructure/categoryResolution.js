const CATEGORY_JSON = "COALESCE(row.after_json, row.normalized_json)";

export function resolvedSnapshotCategoryIdSql(jsonExpression = CATEGORY_JSON) {
  return `COALESCE(
    NULLIF(CAST(json_extract(${jsonExpression}, '$.values.categoryId') AS INTEGER), 0),
    (
      SELECT category.id
      FROM categories category
      WHERE LOWER(category.name) = LOWER(TRIM(json_extract(${jsonExpression}, '$.values.categoryName')))
      ORDER BY category.id
      LIMIT 1
    )
  )`;
}

export function autoCategoryInsertStatement(env, snapshotId, { bootstrapToken = "" } = {}) {
  const tokenGuard = bootstrapToken
    ? "AND snapshot.bootstrap_processing_token = ?"
    : "";
  const statement = env.DB.prepare(`
    WITH pending AS (
      SELECT MIN(TRIM(json_extract(${CATEGORY_JSON}, '$.values.categoryName'))) AS name
      FROM document_snapshot_rows row
      JOIN document_snapshots snapshot
        ON snapshot.id = row.snapshot_id
       AND snapshot.status = 'applying'
       ${tokenGuard}
      WHERE row.snapshot_id = ?
        AND row.action IN ('create', 'update')
        AND NULLIF(CAST(json_extract(${CATEGORY_JSON}, '$.values.categoryId') AS INTEGER), 0) IS NULL
        AND TRIM(COALESCE(json_extract(${CATEGORY_JSON}, '$.values.categoryName'), '')) <> ''
      GROUP BY LOWER(TRIM(json_extract(${CATEGORY_JSON}, '$.values.categoryName')))
    ), ranked AS (
      SELECT name, ROW_NUMBER() OVER (ORDER BY LOWER(name), name) AS offset
      FROM pending
    )
    INSERT INTO categories (name, description, sort_order, is_active, updated_at)
    SELECT
      ranked.name,
      '엑셀 문서대장 업로드 시 자동 생성',
      (SELECT COALESCE(MAX(category.sort_order), 0) FROM categories category) + ranked.offset,
      1,
      CURRENT_TIMESTAMP
    FROM ranked
    WHERE NOT EXISTS (
      SELECT 1 FROM categories category
      WHERE LOWER(category.name) = LOWER(ranked.name)
    )
  `);
  return bootstrapToken
    ? statement.bind(bootstrapToken, snapshotId)
    : statement.bind(snapshotId);
}
