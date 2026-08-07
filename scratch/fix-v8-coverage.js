const fs = require('fs');
let code = fs.readFileSync('scripts/production-preflight.js', 'utf8');

// Fix 1: try/catch coverage bug
code = code.replace(
  '  } catch {\n    throw new Error(`${name} must be an absolute URL`);\n  }',
  '  } catch (e) {\n    throw new Error(`${name} must be an absolute URL`);\n  }'
);

// Fix 2: for...of coverage bug
code = code.replace(
  '        for (const projectId of client.projectIds || [])\n          if (!projectIds.has(projectId))\n            throw new Error(`OAuth client override \\'${mapping.username}/${clientId}\\' references an unknown project`);',
  '        const pIds = client.projectIds || [];\n        for (let i = 0; i < pIds.length; i++) {\n          if (!projectIds.has(pIds[i]))\n            throw new Error(`OAuth client override \\'${mapping.username}/${clientId}\\' references an unknown project`);\n        }'
);

fs.writeFileSync('scripts/production-preflight.js', code);
