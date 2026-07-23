import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const APP_ROOT = fileURLToPath(new URL("../", import.meta.url));

export async function generateReleaseEvidence({ outDir = path.join(APP_ROOT, "release-evidence"), env = process.env } = {}) {
  const manifestPath = path.join(APP_ROOT, "migrations", "manifest.json");
  const manifestBytes = await readFile(manifestPath);
  const migrationManifest = JSON.parse(manifestBytes.toString("utf8"));
  const searchManifestBytes = await readFile(path.join(APP_ROOT, "search-migrations", "manifest.json"));
  const searchMigrationManifest = JSON.parse(searchManifestBytes.toString("utf8"));
  const evidence = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sourceRevision: env.GITHUB_SHA || env.SOURCE_REVISION || "local",
    sourceRef: env.GITHUB_REF || env.SOURCE_REF || "local",
    runId: env.GITHUB_RUN_ID || "local",
    node: process.version,
    migrationCount: Object.keys(migrationManifest.checksums).length,
    migrationManifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    schema: migrationManifest.schema,
    searchMigrationCount: Object.keys(searchMigrationManifest.checksums).length,
    searchMigrationManifestSha256: createHash("sha256").update(searchManifestBytes).digest("hex"),
    searchSchema: searchMigrationManifest.schema
  };

  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outDir, "migration-manifest.json"), `${JSON.stringify(migrationManifest, null, 2)}\n`, "utf8"),
    writeFile(path.join(outDir, "search-migration-manifest.json"), `${JSON.stringify(searchMigrationManifest, null, 2)}\n`, "utf8"),
    writeFile(path.join(outDir, "release-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8")
  ]);
  return Object.freeze(evidence);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const outIndex = process.argv.indexOf("--out");
  const outDir = outIndex >= 0 && process.argv[outIndex + 1]
    ? path.resolve(process.argv[outIndex + 1])
    : path.join(APP_ROOT, "release-evidence");
  const evidence = await generateReleaseEvidence({ outDir });
  console.log(`✓ release evidence 생성: migration ${evidence.migrationCount}개`);
}
