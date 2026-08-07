const fs = require('fs');
let code = fs.readFileSync('tests/scripts/production-preflight.test.js', 'utf8');

code = code.replace(/assert.equal\(result.ready, false, "query failed to error: " \+ query\);/, `
            const detail = result.checks.find(c => c.id === 'durable-state').detail;
            console.log("QUERY:", query);
            console.log("DETAIL:", detail);
            assert.equal(result.ready, false, "query failed to error: " + query);
`);

fs.writeFileSync('tests/scripts/production-preflight.test.js', code);
