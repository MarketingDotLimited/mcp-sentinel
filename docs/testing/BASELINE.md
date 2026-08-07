# MCP Sentinel — Testing Baseline

**Date**: 2026-08-07
**Starting commit**: `ff2e4140548eaab51b7fa5a5de395d61f0874afd`
**Branch**: `main`
**New branch**: `test/exhaustive-coverage-and-product-validation`

## Starting Coverage Metrics

| Metric     | Value  | Target |
| ---------- | ------ | ------ |
| Statements | 98.04% | 100%   |
| Branches   | 94.93% | 100%   |
| Functions  | 97.65% | 100%   |
| Lines      | 98.04% | 100%   |

### Coverage by Directory

| Directory    | Statements       | Branches | Functions | Lines  |
| ------------ | ---------------- | -------- | --------- | ------ |
| Root files   | 97.17%           | 93.44%   | 94.62%    | 97.17% |
| `lib/`       | 98.82%           | 94.57%   | 99.18%    | 98.82% |
| `routes/`    | 100%             | 100%     | 100%      | 100%   |
| `tools/`     | 100%             | 100%     | 100%      | 100%   |
| `public/js/` | **NOT MEASURED** | —        | —         | —      |
| `scripts/`   | **EXCLUDED**     | —        | —         | —      |

### Lowest Coverage Files

| File        | Statements | Branches | Notes                  |
| ----------- | ---------- | -------- | ---------------------- |
| `broker.js` | 85.62%     | 84.08%   | Lowest in project      |
| `server.js` | ~97%       | ~93%     | 415 c8 ignore comments |

## Starting Test Infrastructure

- **Test runner**: Node.js built-in (`node:test`)
- **Coverage tool**: c8 v12
- **Existing test files**: 66 files in `tests/`
- **Skipped tests**: 5 (in `broker-missing.test.js`)
- **c8 ignore comments**: 466 total (415 in `server.js`)
- **Coverage configs**: 2 conflicting (`.c8rc` and `.c8rc.json`)

## Configuration Issues Found

1. **Conflicting c8 configs**: `.c8rc` includes `server.js`, `broker.js`, etc. but `.c8rc.json` excludes them
2. **Coverage thresholds below 100%**: Lines/Statements at 97%, Branches at 92%
3. **`public/js/` excluded**: 21 browser JS files not measured for coverage
4. **`scripts/` excluded**: 11 production scripts not measured
5. **Massive c8 ignore usage**: 466 comments hiding untested code

## Missing Test Types

- [ ] Property-based tests
- [ ] Fuzz tests
- [ ] Mutation tests
- [ ] Performance tests
- [ ] Security tests
- [ ] Accessibility tests
- [ ] Chaos/reliability tests
- [ ] Compatibility tests
- [ ] Browser-side JS coverage

## Modules Without Dedicated Tests

| Module                           | Lines | Status        |
| -------------------------------- | ----- | ------------- |
| `lib/authelia-client.js`         | 11    | Indirect only |
| `lib/deployment.js`              | 106   | Indirect only |
| `lib/remote-operation-policy.js` | 21    | Indirect only |
| `lib/tool-result-schemas.js`     | 176   | Indirect only |
| `tools/docker.js`                | 211   | Indirect only |
| `tools/users.js`                 | 104   | Indirect only |
