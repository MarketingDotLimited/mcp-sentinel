#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

const SUMMARY_FILE = path.join(process.cwd(), 'coverage', 'coverage-summary.json');

async function reportGaps() {
  try {
    const raw = await fs.readFile(SUMMARY_FILE, 'utf8');
    const data = JSON.parse(raw);

    const lowestFiles = [];

    for (const [file, metrics] of Object.entries(data)) {
      if (file === 'total') continue;
      const relPath = path.relative(process.cwd(), file);
      const linePct = metrics.lines ? metrics.lines.pct : 100;
      const branchPct = metrics.branches ? metrics.branches.pct : 100;

      if (linePct < 100 || branchPct < 100) {
        lowestFiles.push({
          file: relPath,
          linesPct: linePct,
          branchesPct: branchPct,
          uncoveredLines: metrics.lines ? metrics.lines.skipped : 0,
        });
      }
    }

    lowestFiles.sort((a, b) => a.linesPct - b.linesPct);

    console.log(`=== Coverage Gap Diagnostic Report ===`);
    console.log(`Files below 100% threshold: ${lowestFiles.length}`);

    if (lowestFiles.length > 0) {
      console.log(JSON.stringify(lowestFiles.slice(0, 20), null, 2));
    } else {
      console.log('🎉 100% per-file coverage achieved across all files!');
    }

    const gapReportPath = path.join(process.cwd(), 'reports', 'testing', 'coverage-gaps.json');
    await fs.mkdir(path.dirname(gapReportPath), { recursive: true });
    await fs.writeFile(gapReportPath, JSON.stringify(lowestFiles, null, 2));
  } catch (err) {
    console.warn('Could not read coverage-summary.json:', err.message);
  }
}

reportGaps();
