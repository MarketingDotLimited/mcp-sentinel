const fs = require('fs');
let content = fs.readFileSync('tests/scripts/merge-coverage.test.js', 'utf8');
content = content.replace(/                create: \(type\) => \(\{\ execute: \(\) => \{ executedReports\.push\(type\); \} \}\)\n                \}\n            \}\n        \}\);/, "                create: (type) => ({ execute: () => { executedReports.push(type); } })\n            }\n        });");
fs.writeFileSync('tests/scripts/merge-coverage.test.js', content);
