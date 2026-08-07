const fs = require('fs');
let content = fs.readFileSync('tests/scripts/verify-coverage-scope.test.js', 'utf8');
content = content.replace(/                mkdir: async \(\) => \{\}\);\n[\s\S]*?mkdir: async \(\) => \{\}/g, '                mkdir: async () => {}');
fs.writeFileSync('tests/scripts/verify-coverage-scope.test.js', content);
