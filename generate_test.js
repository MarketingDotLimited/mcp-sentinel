const fs = require('fs');

let old = fs.readFileSync('tests/scripts/deploy-release.test.js', 'utf8');

// I'll just write a whole new deploy-release.test.js using `mock.module`!
