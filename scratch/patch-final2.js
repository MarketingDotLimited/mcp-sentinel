const fs = require('fs');
let lines = fs.readFileSync('scripts/production-preflight.js', 'utf8').split('\n');
// URL patch
lines[73] = '  if (!URL.canParse(value)) throw new Error(`${name} must be an absolute URL`);';
lines[74] = '  const url = new URL(value);';
lines[75] = '';
lines[76] = '';
lines[77] = ''; 
// Client project override
lines[224] = '        if ((client.projectIds || []).some(id => !projectIds.has(id))) throw new Error(`OAuth client override \\'${mapping.username}/${clientId}\\' references an unknown project`);';
lines[225] = '';
fs.writeFileSync('scripts/production-preflight.js', lines.join('\n'));
