import fs from 'fs';
let code = fs.readFileSync('scripts/production-preflight.js', 'utf8');

code = code.replace(
  /for \(const mapping of mappingRows\) \{[\s\S]*?\}\n    const adminKeys = database/,
  `mappingRows.forEach(mapping => {
      if (mapping.role !== 'admin' && mapping.scopes?.includes('*'))
        throw new Error(\`Non-admin OAuth mapping '\${mapping.username}' has wildcard scope\`);
      (mapping.projectIds || []).forEach(projectId => {
        if (!projectIds.has(projectId))
          throw new Error(\`OAuth mapping '\${mapping.username}' references unknown project '\${projectId}'\`);
      });
      Object.entries(mapping.clients || {}).forEach(([clientId, client]) => {
        if (client.role !== 'admin' && client.scopes?.includes('*'))
          throw new Error(\`Non-admin OAuth client override '\${mapping.username}/\${clientId}' has wildcard scope\`);
        (client.projectIds || []).forEach(projectId => {
          if (!projectIds.has(projectId))
            throw new Error(\`OAuth client override '\${mapping.username}/\${clientId}' references an unknown project\`);
        });
      });
    });
    const adminKeys = database`
);

fs.writeFileSync('scripts/production-preflight.js', code);
