const fs = require('fs');
let code = fs.readFileSync('tests/server-contracts/server-routes.test.js', 'utf8');
code = code.replace(/const validBody = \{\s+id: '123', q: 'test', key: 'dummy-key'[\s\S]+?role: 'admin', confirm: true\n      };\n\n      \/\/ Ensure activeTransports has at least one entry by calling \/mcp directly\n      if \(r\.path === '\/mcp' && r\.method === 'get'\) \{\n         await fuzzHandler\(r\.handler, 'admin', \{\}, \{\}, \{ transport: 'sse' \}\);\n      \} \n        id: '123', q: 'test', key: 'dummy-key'[\s\S]+?role: 'admin'\n      };/, `const validBody = { 
        id: '123', q: 'test', key: 'dummy-key', userId: 'dummy-user', name: 'dummy-name',
        organizationId: 'dummy-org', teamId: 'dummy-team', components: ['api-keys'],
        enabledTools: ['test'], manifestHash: 'test', username: 'test', clientId: 'test',
        oauthReauthorized: true, newChatTested: true, type: 'test', hostname: 'test',
        port: 22, remote: 'test', provider: 'test', confirmationCode: '123',
        description: 'test', ip: '127.0.0.1', password: 'test', role: 'admin', confirm: true
      };

      // Ensure activeTransports has at least one entry by calling /mcp directly
      if (r.path === '/mcp' && r.method === 'get') {
         await fuzzHandler(r.handler, 'admin', {}, {}, { transport: 'sse' });
      }`);
fs.writeFileSync('tests/server-contracts/server-routes.test.js', code);
