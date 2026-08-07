import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

describe('verify-coverage.js', () => {
  it('covers the coverage threshold verification script', () => {
    // Generate a fake coverage-summary.json
    const coverageDir = path.resolve('coverage/merged');
    fs.mkdirSync(coverageDir, { recursive: true });
    
    // Test 100% case
    fs.writeFileSync(
      path.join(coverageDir, 'coverage-summary.json'),
      JSON.stringify({
        total: { lines: { pct: 100 }, statements: { pct: 100 }, functions: { pct: 100 }, branches: { pct: 100 } },
        'file.js': { lines: { pct: 100 }, statements: { pct: 100 }, functions: { pct: 100 }, branches: { pct: 100 } }
      })
    );
    
    execSync('node scripts/verify-coverage.js', { stdio: 'ignore' });
    
    // Test < 100% case
    fs.writeFileSync(
      path.join(coverageDir, 'coverage-summary.json'),
      JSON.stringify({
        total: { lines: { pct: 90 }, statements: { pct: 90 }, functions: { pct: 90 }, branches: { pct: 90 } },
        'file.js': { lines: { pct: 90 }, statements: { pct: 90 }, functions: { pct: 90 }, branches: { pct: 90 } }
      })
    );
    
    assert.throws(() => {
      execSync('node scripts/verify-coverage.js', { stdio: 'ignore' });
    });
    
    // Test missing file case
    fs.unlinkSync(path.join(coverageDir, 'coverage-summary.json'));
    assert.throws(() => {
      execSync('node scripts/verify-coverage.js', { stdio: 'ignore' });
    });
  });
});
