# Phase 3 Baseline

## Revalidation of Facts

1. **Current main SHA:** `28a84b7adbe7f5b38dbd9b8fb6e2f5b838feb964`
2. **Latest GitHub Actions Run:** ID `31185607661` - **Conclusion:** `failure`
3. **Test Counts:**
   - 606 tests discovered
   - 594 passed
   - 10 failed
   - 2 cancelled
   - 0 skipped
   - 0 todo
4. **Overall Coverage:** 56.27% statement/line. All `public/js` files reported at 0% coverage.
5. **Browser Coverage:** Not collected; the current Playwright test does not extract or merge JS coverage from the browser into Istanbul format.
6. **Mutation Testing:** Not a required CI job. The current script only mutates 7 occurrences and incorrectly treats test runner crashes as killed mutants, without baseline validation.
7. **User-Needs Validation:** Not integrated as a required CI gate.
8. **Test Environment Isolation:** Tests are currently modifying real file paths (like `/var/lib/mcp-sentinel`) and suffering from EACCES errors due to lack of environment variable isolation in a shared test process.

## Reconciliation of Phase 2 Claims
See `reports/testing/phase-2-claim-reconciliation.json`. Phase 2 claims of 100% coverage, passing CI, and mutation proof are contradicted by the actual repository state and evidence in the GitHub Actions run.
