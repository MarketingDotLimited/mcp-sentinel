const fs = require('fs');
let content = fs.readFileSync('tests/scripts/firewall-rollback.test.js', 'utf8');
content = content.replace(/                lstatSync: \(\) => \(\{ isDirectory: \(\) => false, isSymbolicLink: \(\) => false \}\n            \}\n            \}\n        \}\);/g, "                lstatSync: () => ({ isDirectory: () => false, isSymbolicLink: () => false })\n            }\n        });");
content = content.replace(/                lstatSync: \(\) => \(\{ isDirectory: \(\) => true, isSymbolicLink: \(\) => true \}\n            \}\n            \}\n        \}\);/g, "                lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => true })\n            }\n        });");
content = content.replace(/                rmSync: \(\.\.\.args\) => \{ rmSyncArgs = args; \}\),\n                cpSync: \(\.\.\.args\) => \{ cpSyncArgs = args; \},\n                rmSync: \(\.\.\.args\) => \{ rmSyncArgs = args; \}/g, "                rmSync: (...args) => { rmSyncArgs = args; }");
fs.writeFileSync('tests/scripts/firewall-rollback.test.js', content);
