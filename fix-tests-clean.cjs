const fs = require('fs');
const glob = require('glob');

const files = glob.sync('tests/scripts/*.test.js');
files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    
    // Normalize the corrupted mock.module calls back to just namedExports
    content = content.replace(/namedExports:\s*\{[\s\S]*?\}, defaultExport:\s*\{/g, 'namedExports: {');
    
    // Now add defaultExport correctly
    content = content.replace(/mock\.module\('node:(fs|fs\/promises|child_process|crypto)',\s*\{\s*namedExports:\s*(\{[\s\S]*?\})\s*\}\s*\)/g, (match, m1, m2) => {
        // Just duplicate m2
        return `mock.module('node:${m1}', {\n            namedExports: ${m2},\n            defaultExport: ${m2}\n        })`;
    });

    fs.writeFileSync(file, content);
});
