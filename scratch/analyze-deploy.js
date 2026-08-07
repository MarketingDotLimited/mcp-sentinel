import fs from 'fs';
const content = fs.readFileSync('scripts/deploy-release.js', 'utf8');
const functions = content.match(/function\s+(\w+)/g);
console.log(functions);
