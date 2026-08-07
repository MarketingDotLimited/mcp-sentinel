const fs = require('fs');
let code = fs.readFileSync('scripts/production-preflight.js', 'utf8');

code = code.replace(/  \} catch \{\n    throw new Error\(\`\$\{name\} must be an absolute URL\`\);\n  \}/, 
"  } catch (e) {\n    throw new Error(`${name} must be an absolute URL`);\n  }");

code = code.replace(/        for \(const projectId of client.projectIds \|\| \[\]\)\n          if \(\!projectIds.has\(projectId\)\)\n            throw new Error\(\`OAuth client override '\$\{mapping.username\}\/\$\{clientId\}' references an unknown project\`\);/,
"        const clientProjIds = client.projectIds || [];\n        for (let i = 0; i < clientProjIds.length; i++) {\n          const projectId = clientProjIds[i];\n          if (!projectIds.has(projectId))\n            throw new Error(`OAuth client override '${mapping.username}/${clientId}' references an unknown project`);\n        }");

fs.writeFileSync('scripts/production-preflight.js', code);
