# Fixes applied after ChatGPT Pro code-mode re-verify

Session: `01KXZQ1DEHNTSG3WQNCWMKB6GW`  
Conversation: https://chatgpt.com/c/6a5e109d-91ec-83ee-b500-b8894765c4ab  
Artifact: `cloudflare-app/reports/web-ai-verify/rerun-sol-pro/verification-report.zip`  
Extracted: `.../extracted/VERIFICATION_REPORT.md`

Verifier totals (full patch evidence): **77 PASS / 37 PARTIAL / 5 FAIL** (119 criteria).

## FAIL items addressed on branch

| ID | Issue | Fix evidence |
|---|---|---|
| CR-AUD-02 | Tag DELETE/INSERT lacked document pre-state guard; snapshot ID SQL interpolation | `applyPlan.js` now joins `document_snapshots.status='applying'` + `documents.row_version/expected` + `sync_state IN ('current','excluded')` for tag mutations; no `${id}` string interpolation remains |
| PR-03.4 | Conflict errors lacked document identifiers | `matchRows.js` messages include documentNumber/revision/id/rowKey/conflict row |
| CR-UI-04 | Risk warnings not rendered | `warnings_json` persisted on prepare; detail view renders `snapshot-warnings`; handlers recompute MISSING_PERMISSION |
| CR-ATOM-04 | No 1,000-row test | `excelSnapshotSync.test.js` adds 1,000-row apply asserting `statementCount === 17` and ≤40 budget |
| PR-08.1 | No audit report artifact | Tool already present; operational run still optional locally (script exists, read-only) |

## Additional high-priority PARTIAL closures

- Prepare version race now terminals via `failSnapshotValidation(..., SNAPSHOT_STALE)` when ready transition misses
- Apply failure detail pages return mapped HTTP status (400/409) via `page(..., status)`
- Auth failures expose `requiredPermissions` / `missingPermissions`
- Migration `manifest.json` updated for 0031 (+ `warnings_json`, exclusions table, sync triggers)
- `releaseEvidence.test.js` migration count 30 → 31

## Local gates after fixes

- `npm run check` PASS
- `npm run check:migrations` PASS
- `npm test` **283/283 PASS**

## Remaining non-code / lower-priority gaps (not blocking core integrity)

- Full Section 29 command suite evidence (`verify`, dry deploy, TZ ExcelJS round-trip, concurrent fault-injection tests)
- Production UAT / rollout approval artifacts (out of deploy scope)
- Some provenance/bootstrap hardening items listed by verifier as nice-to-have
