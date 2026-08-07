import fs from 'fs';
let code = fs.readFileSync('tests/scripts/production-preflight.test.js', 'utf8');

code = code.replace(
  /"INSERT INTO oauth_mappings VALUES \('u4', '\{\\"role\\":\\"user\\",\\"clients\\":\{\\"c1\\":\{\\"role\\":\\"user\\",\\"projectIds\\":\[\\"unknown\\"\]\}\}\}'\);"/,
  `"INSERT INTO oauth_mappings VALUES ('u4', '{\\"role\\":\\"user\\",\\"clients\\":{\\"c1\\":{\\"role\\":\\"user\\",\\"projectIds\\":[\\"11111111-1111-4111-8111-111111111111\\",\\"unknown\\"]}}}');"`
);

fs.writeFileSync('tests/scripts/production-preflight.test.js', code);
