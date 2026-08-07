const fs = require('fs');
let code = fs.readFileSync('scratch/rewrite-deploy-test.js', 'utf8');
// wait, scratch/rewrite-deploy-test.js was overwritten with my bad multi-process version!
