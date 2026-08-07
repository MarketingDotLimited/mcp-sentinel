import fs from 'node:fs';
import path from 'node:path';

const coverageSummaryPath = path.resolve('coverage/merged/coverage-summary.json');
if (!fs.existsSync(coverageSummaryPath)) {
  console.error('Coverage summary not found!');
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf8'));
let failed = false;

for (const [file, metrics] of Object.entries(summary)) {
  if (file === 'total') continue;
  
  const { lines, statements, functions, branches } = metrics;
  if (lines.pct < 100 || statements.pct < 100 || functions.pct < 100 || branches.pct < 100) {
    console.error(`Coverage failed for ${file}`);
    console.error(`Lines: ${lines.pct}%, Statements: ${statements.pct}%, Functions: ${functions.pct}%, Branches: ${branches.pct}%`);
    failed = true;
  }
}

if (failed) {
  console.error('Coverage threshold of 100% not met.');
  process.exit(1);
}

console.log('Coverage verification passed.');
