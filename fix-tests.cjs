const fs = require('fs');
const glob = require('glob');

const files = glob.sync('tests/scripts/*.test.js');
files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    
    // We want to duplicate the namedExports object as defaultExport for fs and fs/promises
    content = content.replace(/(mock\.module\('node:fs(\/promises)?',\s*\{\s*namedExports:\s*)(\{[\s\S]*?\})(\s*\})/g, 
        "$1$3, defaultExport: $3$4");
        
    fs.writeFileSync(file, content);
});
