import fs from 'fs';
const testFile = 'tests/scripts/deploy-release.test.js';
let code = fs.readFileSync(testFile, 'utf8');

// Fix the secret independence:
code = code.replace(/if \(file.includes\('credentials'\)\) return 'a'\.repeat\(64\); \/\/ mock secret/g, 
    "if (file.includes('credentials')) return 'c' + Buffer.from(file).toString('hex').padEnd(63, '0');");

// Fix different signature:
code = code.replace(/let i = 0;\s*childMock\.execFileSync\.mock\.mockImplementation\(\(cmd\) => \{\s*if \(cmd === 'gpg'\) \{\s*if \(i\+\+ === 0\) return '\[GNUPG:\] VALIDSIG ' \+ 'A'\.repeat\(40\);\s*return '\[GNUPG:\] VALIDSIG ' \+ 'B'\.repeat\(40\);\s*\}\s*return '';\s*\}\);/,
`       let i = 0;
        libMock.parseValidSignatureFingerprint.mock.mockImplementation(() => {
            if (i++ === 0) return 'A'.repeat(40);
            return 'B'.repeat(40);
        });`);

fs.writeFileSync(testFile, code);
