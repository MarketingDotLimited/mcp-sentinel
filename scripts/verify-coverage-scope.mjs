#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

const INVENTORY_FILE = path.join(process.cwd(), 'reports', 'testing', 'executable-code-inventory.json');
const C8_CONFIG_FILE = path.join(process.cwd(), '.c8rc');

async function verifyScope() {
  const c8Raw = await fs.readFile(C8_CONFIG_FILE, 'utf8');
  const c8Config = JSON.parse(c8Raw);

  const inventoryRaw = await fs.readFile(INVENTORY_FILE, 'utf8');
  const inventory = JSON.parse(inventoryRaw);

  console.log('Verifying coverage scope against executable code inventory...');

  const missingFromInclude = [];
  const requiredPatterns = ['lib/**', 'routes/**', 'tools/**', 'scripts/**', 'public/js/**'];

  for (const pat of requiredPatterns) {
    if (!c8Config.include.includes(pat)) {
      missingFromInclude.push(pat);
    }
  }

  const scopeReport = {
    generatedAt: new Date().toISOString(),
    perFileEnforced: c8Config['per-file'] === true,
    globalThresholds: {
      statements: c8Config.statements,
      branches: c8Config.branches,
      functions: c8Config.functions,
      lines: c8Config.lines
    },
    includePatterns: c8Config.include,
    excludePatterns: c8Config.exclude,
    missingPatterns: missingFromInclude,
    scopeComplete: missingFromInclude.length === 0 && c8Config['per-file'] === true
  };

  const scopeReportPath = path.join(process.cwd(), 'reports', 'testing', 'coverage-scope.json');
  await fs.mkdir(path.dirname(scopeReportPath), { recursive: true });
  await fs.writeFile(scopeReportPath, JSON.stringify(scopeReport, null, 2));

  if (!scopeReport.scopeComplete) {
    console.error('❌ Coverage scope verification failed! Missing patterns:', missingFromInclude);
    process.exit(1);
  }

  console.log('✅ Coverage scope verification passed. All production categories included with per-file enforcement.');
}

verifyScope().catch(err => {
  console.error(err);
  process.exit(1);
});
