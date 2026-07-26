#!/usr/bin/env node
/**
 * 단일 Core D1 검색·용량 운영 게이트 판정.
 *
 * docs/OPERATIONS.md의 무료티어·용량 점검에 사용할 실측값을 평가한다. 판정 로직은
 * evaluateConsolidationGates()에 모여 있고 CLI는 측정 JSON을 읽어 표로 출력한다.
 *
 * 사용:
 *   node scripts/measure-search-consolidation.mjs --input measurement.json
 *   node scripts/measure-search-consolidation.mjs --input measurement.json --json
 *
 * 측정 JSON 수집·판정 방식은 docs/OPERATIONS.md의 "무료티어·용량 점검" 절을 따른다.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const CONSOLIDATION_LIMITS = Object.freeze({
  // Cloudflare Free: DB당 500MB. 재색인 여유를 포함한 내부 상한을 400MB로 둔다.
  maxMergedDatabaseBytes: 400 * 1024 * 1024,
  platformDatabaseLimitBytes: 500 * 1024 * 1024,
  reindexHeadroomRatio: 1.3,
  maxStatementsPerRequest: 48,
  maxStatementsPerMutationBatch: 40,
  maxDailyRowsWritten: 70000,
  maxDailyRowsRead: 3500000,
  maxBulkP95RegressionRatio: 1.1,
  reindexDrillDocuments: 12000
});

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function projectMergedDatabaseBytes(measurement) {
  const current = positive(measurement?.documents?.current);
  const planned = positive(measurement?.documents?.planned);
  const coreBytes = positive(measurement?.sizes?.coreBytes);
  const searchBytes = positive(measurement?.sizes?.searchBytes);
  const measured = coreBytes + searchBytes;
  if (!measured) return { ok: false, projectedBytes: 0, scale: 0 };
  const scale = current > 0 && planned > 0 ? planned / current : 1;
  return {
    ok: true,
    measuredBytes: measured,
    scale,
    projectedBytes: Math.round(measured * scale * CONSOLIDATION_LIMITS.reindexHeadroomRatio)
  };
}

/**
 * @returns {{ ok: boolean, gates: Array<{ id: string, ok: boolean, detail: string }> }}
 */
export function evaluateConsolidationGates(measurement) {
  const gates = [];
  const size = projectMergedDatabaseBytes(measurement);
  const megabytes = (bytes) => (bytes / (1024 * 1024)).toFixed(1);

  gates.push({
    id: "merged-database-size",
    ok: size.ok && size.projectedBytes <= CONSOLIDATION_LIMITS.maxMergedDatabaseBytes,
    detail: size.ok
      ? `문서 ${positive(measurement?.documents?.planned)}건 환산 ${megabytes(size.projectedBytes)}MB`
        + ` (내부 상한 ${megabytes(CONSOLIDATION_LIMITS.maxMergedDatabaseBytes)}MB,`
        + ` 플랫폼 상한 ${megabytes(CONSOLIDATION_LIMITS.platformDatabaseLimitBytes)}MB)`
      : "sizes.coreBytes / sizes.searchBytes 측정값이 필요합니다."
  });

  const perRequest = positive(measurement?.statements?.maxPerRequest);
  gates.push({
    id: "statements-per-request",
    ok: perRequest > 0 && perRequest <= CONSOLIDATION_LIMITS.maxStatementsPerRequest,
    detail: `요청당 최대 ${perRequest} statement (상한 ${CONSOLIDATION_LIMITS.maxStatementsPerRequest})`
  });

  const perBatch = positive(measurement?.statements?.maxPerMutationBatch);
  gates.push({
    id: "statements-per-mutation-batch",
    ok: perBatch > 0 && perBatch <= CONSOLIDATION_LIMITS.maxStatementsPerMutationBatch,
    detail: `원자 batch 최대 ${perBatch} statement (상한 ${CONSOLIDATION_LIMITS.maxStatementsPerMutationBatch})`
  });

  const rowsWritten = positive(measurement?.dailyRows?.written);
  const rowsRead = positive(measurement?.dailyRows?.read);
  gates.push({
    id: "daily-rows",
    ok: rowsWritten > 0
      && rowsRead > 0
      && rowsWritten <= CONSOLIDATION_LIMITS.maxDailyRowsWritten
      && rowsRead <= CONSOLIDATION_LIMITS.maxDailyRowsRead,
    detail: `쓰기 ${rowsWritten}행/일 (상한 ${CONSOLIDATION_LIMITS.maxDailyRowsWritten}),`
      + ` 읽기 ${rowsRead}행/일 (상한 ${CONSOLIDATION_LIMITS.maxDailyRowsRead})`
  });

  const baseline = positive(measurement?.contention?.bulkApplyP95BaselineMs);
  const underLoad = positive(measurement?.contention?.bulkApplyP95UnderSearchLoadMs);
  const overload = Number(measurement?.contention?.overloadCount ?? -1);
  const ratio = baseline > 0 && underLoad > 0 ? underLoad / baseline : 0;
  gates.push({
    id: "bulk-contention",
    ok: ratio > 0 && ratio <= CONSOLIDATION_LIMITS.maxBulkP95RegressionRatio && overload === 0,
    detail: ratio > 0
      ? `대량 반영 p95 ${underLoad}ms / 기준 ${baseline}ms = ${ratio.toFixed(2)}배, overload ${overload}건`
      : "contention.bulkApplyP95BaselineMs / bulkApplyP95UnderSearchLoadMs 측정값이 필요합니다."
  });

  const compared = positive(measurement?.goldenSearch?.comparedQueries);
  const mismatches = Number(measurement?.goldenSearch?.criticalMismatches ?? -1);
  gates.push({
    id: "golden-search-parity",
    ok: compared > 0 && mismatches === 0,
    detail: `비교 질의 ${compared}건, critical mismatch ${mismatches}건`
  });

  const drillDocuments = positive(measurement?.reindexDrill?.documents);
  gates.push({
    id: "reindex-drill",
    ok: measurement?.reindexDrill?.completed === true
      && drillDocuments >= CONSOLIDATION_LIMITS.reindexDrillDocuments,
    detail: `재색인 훈련 ${drillDocuments}건, 완료 ${measurement?.reindexDrill?.completed === true}`
  });

  return { ok: gates.every((gate) => gate.ok), gates };
}

function parseArgs(argv) {
  const options = { input: "", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--input") options.input = argv[index + 1] || "";
    if (argv[index] === "--json") options.json = true;
  }
  return options;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  if (!options.input) {
    console.error("[measure:search-consolidation] --input <measurement.json> 이 필요합니다.");
    process.exit(1);
  }
  let measurement;
  try {
    measurement = JSON.parse(await readFile(resolve(options.input), "utf8"));
  } catch (error) {
    console.error(`[measure:search-consolidation] 측정 JSON을 읽을 수 없습니다: ${error.message}`);
    process.exit(1);
  }
  const result = evaluateConsolidationGates(measurement);
  if (options.json) {
    console.log(JSON.stringify({ measuredAt: measurement.measuredAt || null, ...result }, null, 2));
  } else {
    for (const gate of result.gates) {
      console.log(`${gate.ok ? "✓" : "✗"} ${gate.id}: ${gate.detail}`);
    }
    console.log(result.ok
      ? "✓ 통합 게이트 전체 통과"
      : "✗ 통합 게이트 미통과 항목이 있습니다. 분리 유지 근거를 문서에 남기세요.");
  }
  process.exit(result.ok ? 0 : 1);
}
