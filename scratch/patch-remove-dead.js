const fs = require('fs');
let lines = fs.readFileSync('scripts/production-preflight.js', 'utf8').split('\n');

// URL parsing - replace lines 72-76
lines[72] = '  if (!URL.canParse(value)) throw new Error(`${name} must be an absolute URL`);';
lines[73] = '  const url = new URL(value);';
lines[74] = '';
lines[75] = '';
lines[76] = '';

fs.writeFileSync('scripts/production-preflight.js', lines.join('\n'));
