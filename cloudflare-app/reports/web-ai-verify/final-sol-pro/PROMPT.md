# Final code-mode verification — Excel snapshot integrity

You are verifying whether feature branch `improve/excel-snapshot-integrity` (PR https://github.com/NKH-92/hanlim-archive/pull/13) fully satisfies the attached improvement plan for agent-deliverable scope.

## Attached evidence
- IMPROVEMENT_PLAN.md — source of truth acceptance criteria (PR-00–08, §29, §34, §35)
- feature-branch-code.patch — `git diff origin/main...HEAD` excluding reports/
- LOCAL_VERIFICATION.md + GATE_EVIDENCE.md + verify-run.log — local non-prod gates
- FIXES_AFTER_VERIFY.md — prior FAIL closures after re-verify
- local-sample-audit.json — read-only audit artifact from migrated sample DB

## Hard scope notes
- Production deploy / remote D1 migration / live feature-gate changes are OUT OF SCOPE and must not be scored as FAIL if documented as ops-blocked.
- Score code/test/process DoD. Mark production UAT/rollout as PARTIAL only if prep/docs/checklist exist; FAIL only if required prep artifacts are missing.

## Required output artifact
Produce a zip (`result.zip`) containing at minimum:
1. `PLAN.md` or `00_plan.md` — short verification plan
2. `VERIFICATION_REPORT.md` — criterion-by-criterion PASS/PARTIAL/FAIL with file evidence from the patch

In VERIFICATION_REPORT.md include:
- Executive summary / overall verdict
- Counts: PASS / PARTIAL / FAIL for PR-00–08, §34, §35, §29 (and totals)
- Table rows with ID, criterion, status, file evidence, rationale
- Remaining actionable gaps (if any), distinguishing code-fixable vs production-ops-only
- Confidence notes

Be strict and evidence-based. Prefer FAIL over PARTIAL when a required code/test item is clearly missing in the patch. Do not invent production access.
