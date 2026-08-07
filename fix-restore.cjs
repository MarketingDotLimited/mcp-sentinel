const fs = require('fs');
let code = fs.readFileSync('tests/scripts/restore-state.test.js', 'utf8');

code = code.replace(/                rm: async \(file\) => \{ removedTempFile = file; \}\);\n                \},\n                writeFile: async \(\) => \{\},\n                rm: async \(file\) => \{ removedTempFile = file; \}/g, "                rm: async (file) => { removedTempFile = file; }");

fs.writeFileSync('tests/scripts/restore-state.test.js', code);
