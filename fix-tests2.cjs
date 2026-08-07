const fs = require('fs');
const glob = require('glob');

const files = glob.sync('tests/scripts/*.test.js');
files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    
    // Clean up the bad defaultExport regex replacement
    content = content.replace(/, defaultExport: \{[\s\S]*?\}/g, '');
    
    // Add defaultExport correctly by parsing the AST or just replacing it properly
    // Instead of AST, let's just do a string replacement for `mock.module(`
    
    // A simpler way: we'll match `namedExports: { ... }` but we know `}` is the last thing before `});`
    // Actually, `namedExports: { ... }` is always followed by `\n        }` or `\n    }`
    // Let's replace `namedExports: {` with `get namedExports() { return this.defaultExport; }, defaultExport: {`
    // That way they share the exact same object!
    
    content = content.replace(/namedExports:\s*\{/g, 'get namedExports() { return this.defaultExport; }, defaultExport: {');
    
    fs.writeFileSync(file, content);
});
