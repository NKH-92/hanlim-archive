# Verification Plan

## Environment assumptions

- Linux sandbox; every working source and evidence copy was created under `/mnt/data/workdir`.
- `IMPROVEMENT_PLAN.md` is the acceptance-criteria source of truth.
- `feature-branch-code.patch` is the authoritative feature-diff evidence; local verification documents/logs and current GitHub PR/CI metadata are corroborating process evidence.
- The supplied patch is UTF-16LE and contains one malformed unified-diff hunk boundary. It was normalized for inspection, split by `diff --git` file sections, and material files were cross-checked against the current feature branch through GitHub.
- Production deployment, remote D1 migration, live feature-gate changes, production backup/restore drills, and production UAT require human operations and are not scored as code FAILs when preparation artifacts exist.
- No visible todo/checklist tool was available; this file is the durable plan and completion record.

## Checklist

- [x] Inventory all supplied evidence and confirm scope boundaries.
- [x] Extract the acceptance criteria for PR-00 through PR-08, section 34, section 35, and section 29.
- [x] Index changed files and material implementation/test/documentation evidence from the patch.
- [x] Score every criterion PASS, PARTIAL, or FAIL using strict evidence rules.
- [x] Reconcile scores against local gates, post-verify fixes, the sample audit artifact, and current PR CI.
- [x] Write the criterion-by-criterion report with counts, gaps, and confidence notes.
- [x] Validate report completeness, arithmetic, evidence references, and artifact contents.
- [x] Package and verify the single `/mnt/data/result.zip` artifact.

## Detailed stage instructions used

1. Preserve the prior verification denominator: 39 explicit PR completion criteria, 40 section 34 rows, 25 section 35 rows, and 15 section 29 gates, for 119 total rows.
2. Inspect relevant patch hunks directly rather than relying only on summary documents.
3. Use PASS only where implementation and credible evidence exist; use PARTIAL for implemented-but-incomplete criteria or documented production-ops-only steps; reserve FAIL for clearly absent/contradictory required code, tests, or preparation.
4. Separate agent-fixable code/test gaps, process/documentation gaps, and production-operations-only work.
5. Cross-check all group totals and the grand total mechanically before packaging.

## Implementation record

- Deliverables at zip root: `PLAN.md` and `VERIFICATION_REPORT.md`.
- Evidence was copied to `/mnt/data/workdir/evidence`; the original patch was retained and a UTF-8 normalized inspection copy was generated.
- The patch was indexed into 55 per-file sections under `/mnt/data/workdir/patch_sections` for direct review.
- Current PR metadata was checked for PR #13 at head `468aa19422826ecdce02a7dcf4e8522e3152cd83`; the required GitHub Actions job was confirmed successful.
- The final matrix contains 119 unique IDs and scores 107 PASS / 12 PARTIAL / 0 FAIL.
- Production access or execution is not claimed.

## Verification commands executed

```sh
# Evidence integrity and source inspection
sha256sum /mnt/data/workdir/evidence/{IMPROVEMENT_PLAN.md,feature-branch-code.patch,LOCAL_VERIFICATION.md,GATE_EVIDENCE.md,FIXES_AFTER_VERIFY.md,local-sample-audit.json,verify-run.log}
python3 <plan-section extraction and patch-section indexing scripts>
rg -n "SNAPSHOT_|document_snapshot|1,000|ExcelJS|git status" /mnt/data/workdir/evidence /mnt/data/workdir/patch_sections
sed -n '<review ranges>' /mnt/data/workdir/patch_sections/*.patch

# Report generation and mechanical validation
python3 /mnt/data/workdir/tools/generate_report.py
python3 /mnt/data/workdir/tools/validate_report.py
# Result: REPORT_VALIDATION: PASS; 119 rows; PASS=107, PARTIAL=12, FAIL=0

grep -nE '[[:blank:]]+$' /mnt/data/workdir/PLAN.md /mnt/data/workdir/VERIFICATION_REPORT.md
# Result: no trailing-whitespace findings

# Final packaging and checks
rm -f /mnt/data/*.zip
cd /mnt/data/workdir && zip -X -j /mnt/data/result.zip PLAN.md VERIFICATION_REPORT.md
unzip -l /mnt/data/result.zip
unzip -Z1 /mnt/data/result.zip | sort
find /mnt/data -maxdepth 1 -name "*.zip" -print
```

Current GitHub PR/CI metadata was queried through the GitHub connector in addition to the shell checks above.

## Packaging criteria

- Remove every existing `/mnt/data/*.zip` before creating the final archive.
- Create exactly one top-level archive: `/mnt/data/result.zip`.
- Include `PLAN.md` and `VERIFICATION_REPORT.md` at archive root.
- Include no evidence copies, tools, dependency directories, VCS metadata, caches, build outputs, or generated application assets.
- Confirm the archive member list is exactly the two required Markdown files.
- Confirm `find /mnt/data -maxdepth 1 -name "*.zip" -print` emits exactly `/mnt/data/result.zip` before final response.
