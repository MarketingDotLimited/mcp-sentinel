const fs = require('fs');
let code = fs.readFileSync('tests/scripts/run-mutation-test.test.js', 'utf8');

code = code.replace(/get namedExports\(\) \{ return this\.defaultExport; \}, defaultExport:/g, 'namedExports:');
code = code.replace(/namedExports: (\{[\s\S]*?\})/g, 'namedExports: $1, defaultExport: $1');

fs.writeFileSync('tests/scripts/run-mutation-test.test.js', code);
