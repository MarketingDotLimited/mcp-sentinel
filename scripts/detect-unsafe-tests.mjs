#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

const TESTS_DIR = path.join(process.cwd(), 'tests');

async function getTestFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getTestFiles(fullPath)));
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function auditTests() {
  const files = await getTestFiles(TESTS_DIR);
  const findings = [];

  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    const relPath = path.relative(process.cwd(), file);
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      const lineNum = idx + 1;

      // Check for process.exit outside script mocks
      if (line.includes('process.exit(') && !content.includes('#!/usr/bin/env node')) {
        findings.push({
          file: relPath,
          line: lineNum,
          rule: 'NO_PROCESS_EXIT_IN_TEST_RUNNER',
          severity: 'HIGH',
          snippet: line.trim(),
          reason: 'Test runners must terminate naturally; forcing process.exit hides open handles.',
        });
      }

      // Check for .skip / .only
      if (/\b(it|test|describe)\.skip\b/.test(line) || /skip:\s*true/.test(line)) {
        findings.push({
          file: relPath,
          line: lineNum,
          rule: 'NO_SKIPPED_TESTS',
          severity: 'HIGH',
          snippet: line.trim(),
          reason: 'All tests must be active and passing.',
        });
      }

      if (/\b(it|test|describe)\.only\b/.test(line)) {
        findings.push({
          file: relPath,
          line: lineNum,
          rule: 'NO_ONLY_TESTS',
          severity: 'HIGH',
          snippet: line.trim(),
          reason: 'Focused .only tests are not permitted in committed code.',
        });
      }

      // Check for swallowed errors without assertion (excluding setup/teardown fs cleanup)
      if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line) || /catch\s*\{\s*\}/.test(line)) {
        const isFsCleanup =
          /(mkdir|unlink|rm|chmod|close|symlink|write|unlinkSync|rmSync|chmodSync|mkdirSync|symlinkSync|writeFileSync)/.test(
            line
          ) ||
          (idx > 0 &&
            /(mkdir|unlink|rm|chmod|close|symlink|write|unlinkSync|rmSync|chmodSync|mkdirSync|symlinkSync|writeFileSync)/.test(
              lines[idx - 1]
            ));
        if (!isFsCleanup) {
          findings.push({
            file: relPath,
            line: lineNum,
            rule: 'NO_EMPTY_CATCH',
            severity: 'HIGH',
            snippet: line.trim(),
            reason: 'Swallowing errors without exact assertions masks contract failures.',
          });
        }
      }
    });
  }

  console.log(`Audited ${files.length} test files. Found ${findings.length} findings.`);
  if (findings.length > 0) {
    console.log(JSON.stringify(findings, null, 2));
  }

  const reportPath = path.join(process.cwd(), 'reports', 'testing', 'test-integrity-findings.json');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(findings, null, 2));

  if (findings.some(f => f.severity === 'HIGH')) {
    console.error('❌ Test integrity audit failed!');
    process.exit(1);
  }
}

auditTests().catch(err => {
  console.error(err);
  process.exit(1);
});
