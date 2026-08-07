const fs = require('fs');
let lines = fs.readFileSync('scripts/production-preflight.js', 'utf8').split('\n');
lines[221] = '        if ((client.projectIds || []).some(id => !projectIds.has(id))) throw new Error(`OAuth client override \\'${mapping.username}/${clientId}\\' references an unknown project`);';
lines[222] = '';
fs.writeFileSync('scripts/production-preflight.js', lines.join('\n'));
