const fs = require('fs');

const b = fs.readFileSync('tests/broker-missing.test.js', 'utf8');
const bi = fs.readFileSync('tests/broker-integration.test.js', 'utf8');
const bt = fs.readFileSync('tests/broker.test.js', 'utf8');

fs.writeFileSync('tests/broker-all.test.js', b + '\n' + bi + '\n' + bt);
