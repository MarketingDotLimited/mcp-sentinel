const fs = require('fs');
let code = fs.readFileSync('scripts/production-preflight.js', 'utf8');

code = code.replace(/        for \(const projectId of client.projectIds \|\| \[\]\)\n          if \(\!projectIds.has\(projectId\)\) throw new Error\(\`OAuth client override '\$\{mapping.username\}\/\$\{clientId\}' references an unknown project\`\);/, 
\`        if ((client.projectIds || []).some(projectId => !projectIds.has(projectId))) throw new Error(\\\`OAuth client override '\${mapping.username}/\${clientId}' references an unknown project\\\`);\`);
fs.writeFileSync('scripts/production-preflight.js', code);
