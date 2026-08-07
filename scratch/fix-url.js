import fs from 'fs';
let code = fs.readFileSync('scripts/production-preflight.js', 'utf8');

const newRequireUrl = `function requireUrl(value, name, expectedProtocol = 'https:') {
  if (!URL.canParse(value)) throw new Error(\`\${name} must be an absolute URL\`);
  const url = new URL(value);
  if (url.protocol !== expectedProtocol || url.username || url.password)
    throw new Error(\`\${name} must use \${expectedProtocol}\`);
  return url;
}`;

code = code.replace(/function requireUrl\([\s\S]*?return url;\n\}/, newRequireUrl);
fs.writeFileSync('scripts/production-preflight.js', code);
