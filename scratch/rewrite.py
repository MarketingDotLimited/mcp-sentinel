import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

# Remove mock.module('fs', ...)
text = re.sub(r"const fsMock = \{.*?\n.*?mock\.module\('fs', \{ defaultExport: fsMock, namedExports: \{ constants: fsMock\.constants \} \}\);\n", "", text, flags=re.DOTALL)
# Remove mock.module('child_process', ...)
text = re.sub(r"const childMock = \{.*?\n.*?mock\.module\('child_process', \{ namedExports: childMock \}\);\n", "", text, flags=re.DOTALL)
# Remove mock.module('../../lib/deployment.js', ...)
text = re.sub(r"const libMock = \{.*?\n.*?mock\.module\('\.\./\.\./lib/deployment\.js', \{ namedExports: libMock \}\);\n", "", text, flags=re.DOTALL)

# Add imports if missing
if "import child_process" not in text:
    text = text.replace("import fs from 'fs';", "import fs from 'fs';\nimport child_process from 'child_process';\nimport * as lib from '../../lib/deployment.js';")

# We will define fsMock, childMock, libMock as just objects that hold our mock functions,
# but instead we will use mock.method() in a before() block or directly in the setup.
setup = """
    const fsMock = {
        mkdirSync: mock.method(fs, 'mkdirSync', () => {}),
        chownSync: mock.method(fs, 'chownSync', () => {}),
        chmodSync: mock.method(fs, 'chmodSync', () => {}),
        lstatSync: mock.method(fs, 'lstatSync', () => ({ uid: 999, gid: 999 })),
        readFileSync: mock.method(fs, 'readFileSync', () => ''),
        writeFileSync: mock.method(fs, 'writeFileSync', () => {}),
        existsSync: mock.method(fs, 'existsSync', () => false),
        copyFileSync: mock.method(fs, 'copyFileSync', () => {}),
        rmSync: mock.method(fs, 'rmSync', () => {}),
        mkdtempSync: mock.method(fs, 'mkdtempSync', () => '/tmp/mcp-release-1234'),
        readdirSync: mock.method(fs, 'readdirSync', () => []),
        unlinkSync: mock.method(fs, 'unlinkSync', () => {}),
        symlinkSync: mock.method(fs, 'symlinkSync', () => {}),
        renameSync: mock.method(fs, 'renameSync', () => {}),
        realpathSync: mock.method(fs, 'realpathSync', (p) => p),
    };
    const childMock = {
        execFileSync: mock.method(child_process, 'execFileSync', () => '0\\n')
    };
    const libMock = {
        parseEnvironment: mock.method(lib, 'parseEnvironment', () => ({})),
        parseValidSignatureFingerprint: mock.method(lib, 'parseValidSignatureFingerprint', () => 'abcdef1234567890'),
        validateArchiveEntries: mock.method(lib, 'validateArchiveEntries', () => []),
        validateArchiveListing: mock.method(lib, 'validateArchiveListing', () => {}),
        validateReleaseManifest: mock.method(lib, 'validateReleaseManifest', () => {}),
        validateProjectWritePaths: mock.method(lib, 'validateProjectWritePaths', () => {}),
        validateSigningFingerprint: mock.method(lib, 'validateSigningFingerprint', () => {}),
    };
"""

text = text.replace("test('deploy-release.js suite', async (t) => {\n", "test('deploy-release.js suite', async (t) => {\n" + setup)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
