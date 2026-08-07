import fs from 'fs';
let code = fs.readFileSync('tests/scripts/deploy-release.test.js', 'utf8');

code = code.replace(/readFileSync: mock\.fn\(\),/g, "readFileSync: mock.fn((f) => { if (f.includes('tests/scripts') || f.includes('scripts/deploy-release.js')) return import('fs').then(m => m.readFileSync(f, 'utf8')); return '{}'; }),");
// Wait, `import('fs')` is async, readFileSync must be sync!
// We can use the original fs!
