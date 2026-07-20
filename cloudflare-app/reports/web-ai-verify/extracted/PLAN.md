# Verification Work Plan

## Environment assumptions

- Linux sandbox.
- All working files are staged under `/mnt/data/workdir`.
- The requested implementation branch is expected to be verified from the supplied attachments and, when reachable, the remote GitHub repository.
- This task is verification only. No product source, migration, configuration, or test implementation will be changed.
- The final archive will contain only the human-authored verification documents.

## Top-level checklist

- [x] Inventory the supplied plan, evidence files, and context archive.
- [x] Extract section 35 acceptance criteria 1–25 verbatim.
- [x] Check whether the implementation source/branch is available for independent review.
- [x] Correlate each criterion with supplied file paths, test evidence, and observed gaps.
- [x] Write `VERIFICATION_REPORT.md` with PASS / FAIL / PARTIAL for all 25 criteria.
- [x] Validate report completeness, internal consistency, and evidence boundaries.
- [x] Package only `PLAN.md` and `VERIFICATION_REPORT.md` as `/mnt/data/result.zip` and verify the archive contract.

## Detailed stage instructions

1. Preserve uploaded inputs under `/mnt/data/workdir/input` while preparing the report under `/mnt/data/workdir/output`.
2. Treat implementation-summary statements as claims unless corroborated by source, a readable test transcript, or an independently rerunnable check.
3. Do not convert missing evidence into a PASS. Record unavailable source, unreadable test names, missing command transcripts, and missing operational evidence as explicit gaps.
4. For compound acceptance criteria, require evidence for every conjunct before assigning PASS.
5. Keep the final report usable as a release gate: include an executive verdict, the 25-item matrix, evidence limitations, and prioritized remaining actions.

## Implementation notes

- No implementation work is in scope.
- The uploaded `gpt-dev-agent-context(45).zip` contains operating guidance and a manifest only; it is not a source-code archive.
- The remote repository is reachable through the GitHub connector, but the named `improve/excel-snapshot-integrity` branch is not present remotely and cannot be compared with the base commit.
- The supplied test transcript exposes aggregate counts (`282 pass / 0 fail`) but does not preserve readable individual test names or the invoked command/environment.

## Verification commands executed

- `unzip -l /mnt/data/gpt-dev-agent-context(45).zip`
- `sha256sum` over all supplied evidence files
- `iconv -f UTF-16LE -t UTF-8` for `diff-stat.txt` and `untracked.txt`
- Extraction of improvement-plan section 35 with Python
- Remote GitHub repository/branch/compare checks through the installed connector
- Remote inspection of the base `cloudflare-app/package.json` verification scripts
- `grep`/scripted checks that the report contains criteria 1–25 and only allowed status labels
- `zipinfo -1 /mnt/data/result.zip`
- `find /mnt/data -maxdepth 1 -name "*.zip" -print`

Results recorded before packaging:

- Acceptance headings found: 25, numbered 1 through 25 with no gaps.
- Status count: PASS 0, PARTIAL 23, FAIL 2.
- Output directory contains only `PLAN.md` and `VERIFICATION_REPORT.md`.
- Source-level tests and local `npm` commands were not rerun because the supplied archive contains no repository source and the named implementation branch is not available remotely. This limitation is reported rather than treated as success.

## Packaging rules

- Delete every pre-existing `/mnt/data/*.zip` immediately before final packaging.
- Create exactly one archive with `container.exec`: `/mnt/data/result.zip`.
- Archive root must contain `PLAN.md` and `VERIFICATION_REPORT.md`.
- Exclude repositories, dependencies, caches, generated builds, coverage, VCS metadata, and uploaded evidence files.
- Rebuild the archive if the top-level zip count is not exactly one, the path is not `/mnt/data/result.zip`, or the plan/report files are missing.
