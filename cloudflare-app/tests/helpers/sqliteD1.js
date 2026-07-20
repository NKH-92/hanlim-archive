export function sqliteD1(database) {
  function statement(sql, args = []) {
    return {
      sql,
      args,
      bind(...nextArgs) { return statement(sql, nextArgs); },
      async first() { return database.prepare(sql).get(...args) ?? null; },
      async all() { return { results: database.prepare(sql).all(...args) }; },
      async run() {
        const result = database.prepare(sql).run(...args);
        return {
          meta: {
            changes: Number(result.changes || 0),
            last_row_id: Number(result.lastInsertRowid || 0)
          }
        };
      }
    };
  }
  return {
    prepare(sql) { return statement(sql); },
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map(({ sql, args }) => {
          if (/\bRETURNING\b/i.test(sql)) {
            const rows = database.prepare(sql).all(...args);
            return {
              results: rows,
              meta: {
                changes: Number(database.prepare("SELECT changes() AS count").get().count || 0),
                last_row_id: Number(database.prepare("SELECT last_insert_rowid() AS id").get().id || 0)
              }
            };
          }
          const result = database.prepare(sql).run(...args);
          return {
            results: [],
            meta: {
              changes: Number(result.changes || 0),
              last_row_id: Number(result.lastInsertRowid || 0)
            }
          };
        });
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }
  };
}
