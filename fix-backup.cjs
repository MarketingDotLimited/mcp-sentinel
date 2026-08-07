const fs = require('fs');
let code = fs.readFileSync('tests/scripts/backup-state.test.js', 'utf8');

code = code.replace(/            \},\n                mkdir: mock\.fn\(\),\n                writeFile: mock\.fn\(\),\n                rename: mock\.fn\(\),\n                chmod: mock\.fn\(\),\n                readdir: async \(\) => \[\],\n                rm: mock\.fn\(\)\n            \}/g, '            }');

fs.writeFileSync('tests/scripts/backup-state.test.js', code);
