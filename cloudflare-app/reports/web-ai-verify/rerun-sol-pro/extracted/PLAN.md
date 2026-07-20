# Verification Plan

## Environment and scope

- Linux sandbox workspace: `/mnt/data/workdir`
- Evidence is limited to the attached `IMPROVEMENT_PLAN(2).md`, `feature-branch.patch`, and `LOCAL_VERIFICATION.md`.
- The patch is treated as the authoritative implementation record. No repository checkout, product rewrite, remote migration, production deploy, or production data change is part of this verification.
- The deliverable is limited to this checklist and `VERIFICATION_REPORT.md`.

## Durable checklist

- [x] 1. Inventory and integrity-check all attached inputs.
- [x] 2. Extract the plan's explicit PR-00 through PR-08 completion criteria and overall completion/gate criteria.
- [x] 3. Build a patch line index using diff-header paths and new-side file line numbers visible in the unified diff.
- [x] 4. Map every counted criterion to implementation and test evidence; score PASS, PARTIAL, or FAIL under the requested rules.
- [x] 5. Reconcile implementation findings with the supplied local verification evidence (`npm run check`, `npm test`).
- [x] 6. Write `VERIFICATION_REPORT.md` with an executive summary, totals, per-criterion evidence, actionable gaps, and confidence notes.
- [x] 7. Validate criterion coverage, unique IDs, evidence formatting, evidence-line existence, status totals, and Markdown completeness.
- [x] 8. Package exactly `/mnt/data/result.zip`, then verify it is the only top-level ZIP and contains exactly the two required files.

## Verification method

The report counts the 39 explicit completion criteria under PR-00 through PR-08, the 40 Section 34 code-review checklist criteria, the 25 Section 35 overall definition-of-done criteria, and the 15 Section 29 command gates. PR test bullet lists are used as supporting evidence rather than counted again. This produces 119 scored criteria without penalizing an unopened GitHub PR, an undeployed production release, or the absence of a repository checkout beyond the authoritative patch.

For modified files, evidence lines are new-side file line numbers that are actually present in patch hunks. For the supplied execution record, citations use `LOCAL_VERIFICATION.md` line numbers. A validation pass confirms 119 unique criterion IDs and totals of 77 PASS, 37 PARTIAL, and 5 FAIL.

## Commands executed

```text
wc -l /mnt/data/IMPROVEMENT_PLAN(2).md /mnt/data/feature-branch.patch /mnt/data/LOCAL_VERIFICATION.md
sha256sum /mnt/data/IMPROVEMENT_PLAN(2).md /mnt/data/feature-branch.patch /mnt/data/LOCAL_VERIFICATION.md
python /mnt/data/workdir/tmp/index_patch.py
python /mnt/data/workdir/tmp/generate_report.py
python (inline): parse all criterion rows; assert 119 unique IDs; reconcile group and status totals
python (inline): verify every criterion citation resolves to a source line actually present in the patch or local verification note
sed/grep: inspect report sections and targeted patch hunks
```

Final packaging and verification executed:

```text
rm -rf /mnt/data/workdir/tmp
rm -f /mnt/data/*.zip
(cd /mnt/data/workdir && zip -q -X /mnt/data/result.zip PLAN.md VERIFICATION_REPORT.md)
unzip -t /mnt/data/result.zip                 # archive test: OK
unzip -Z1 /mnt/data/result.zip               # PLAN.md; VERIFICATION_REPORT.md only
find /mnt/data -maxdepth 1 -name "*.zip" -print
# /mnt/data/result.zip
```

The package was rebuilt after this checklist was marked complete, then all archive and singleton checks were repeated on the final bytes.

## Packaging criteria

- ZIP root contains exactly `PLAN.md` and `VERIFICATION_REPORT.md`.
- No dependency directories, caches, build outputs, repository metadata, helper scripts, indexes, or product code are included.
- Before packaging, all existing `/mnt/data/*.zip` files are deleted.
- ZIP is created with `container.exec` at exactly `/mnt/data/result.zip`.
- Archive integrity and member names are checked with `unzip -t` and `unzip -Z1`.
- Final verification runs `find /mnt/data -maxdepth 1 -name "*.zip" -print`; the sole result must be `/mnt/data/result.zip`.
