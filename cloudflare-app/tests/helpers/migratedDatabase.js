import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

export const MIGRATIONS_URL = new URL("../../migrations/", import.meta.url);

export async function migrationFiles() {
  const names = (await readdir(MIGRATIONS_URL)).filter((name) => name.endsWith(".sql")).sort();
  return names.map((name) => ({
    name,
    number: Number(name.slice(0, 4))
  })).sort((left, right) => left.number - right.number || left.name.localeCompare(right.name));
}

export async function createMigratedDatabase(path = ":memory:") {
  const database = new DatabaseSync(path);
  try {
    for (const migration of await migrationFiles()) {
      const sql = await readFile(new URL(migration.name, MIGRATIONS_URL), "utf8");
      try {
        database.exec(sql);
      } catch (error) {
        error.message = `${migration.name}: ${error.message}`;
        throw error;
      }
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
