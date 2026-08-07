import fs from 'fs';
let code = fs.readFileSync('tests/scripts/production-preflight.test.js', 'utf8');

code = code.replace(
  /"INSERT INTO oauth_mappings VALUES \('johndoe', '\{\\"role\\":\\"admin\\",\\"projectIds\\":\[\]\}'\);"/,
  `"INSERT INTO oauth_mappings VALUES ('johndoe', '{\\"role\\":\\"admin\\",\\"projectIds\\":[],\\"clients\\":{\\"c1\\":{\\"role\\":\\"admin\\",\\"projectIds\\":[]}}}');"`
);

fs.writeFileSync('tests/scripts/production-preflight.test.js', code);
