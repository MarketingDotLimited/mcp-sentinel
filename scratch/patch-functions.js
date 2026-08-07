const fs = require('fs');
let code = fs.readFileSync('scripts/production-preflight.js', 'utf8');

// Replace requireUrl entirely
code = code.replace(
  /function requireUrl[\s\S]*?return url;\n\}/,
  `function requireUrl(value, name, expectedProtocol = 'https:') {
  if (!URL.canParse(value)) throw new Error(\`\${name} must be an absolute URL\`);
  const url = new URL(value);
  if (url.protocol !== expectedProtocol || url.username || url.password)
    throw new Error(\`\${name} must use \${expectedProtocol}\`);
  return url;
}`
);

// Replace the OAuth mapping loop entirely
code = code.replace(
  /for \(const mapping of mappingRows\) \{[\s\S]*?\}\n    const adminKeys = database/,
  `for (const mapping of mappingRows) {
      if (mapping.role !== 'admin' && mapping.scopes?.includes('*'))
        throw new Error(\`Non-admin OAuth mapping '\${mapping.username}' has wildcard scope\`);
      for (const projectId of mapping.projectIds || [])
        if (!projectIds.has(projectId))
          throw new Error(\`OAuth mapping '\${mapping.username}' references unknown project '\${projectId}'\`);
      for (const [clientId, client] of Object.entries(mapping.clients || {})) {
        if (client.role !== 'admin' && client.scopes?.includes('*'))
          throw new Error(\`Non-admin OAuth client override '\${mapping.username}/\${clientId}' has wildcard scope\`);
        
        const clientProjectIds = client.projectIds || [];
        for (let i = 0; i < clientProjectIds.length; i++) {
          if (!projectIds.has(clientProjectIds[i])) {
            throw new Error(\`OAuth client override '\${mapping.username}/\${clientId}' references an unknown project\`);
          }
        }
      }
    }
    const adminKeys = database`
);

fs.writeFileSync('scripts/production-preflight.js', code);
