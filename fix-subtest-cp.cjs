const fs = require('fs');
let content = fs.readFileSync('tests/scripts/register-node-project.test.js', 'utf8');
content = content.replace(/        mock\.method\(cp, 'execFileSync', \(\) => '0'\);/g, "        const mockedCp = mock.method(cp, 'execFileSync');\n        mockedCp.mock.mockImplementation(() => '0');");
content = content.replace(/        mock\.method\(cp, 'execFileSync', \(\) => '1000'\);/g, "        mockedCp.mock.mockImplementation(() => '1000');");
fs.writeFileSync('tests/scripts/register-node-project.test.js', content);
