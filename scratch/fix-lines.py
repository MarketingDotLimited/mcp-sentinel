with open('tests/scripts/deploy-release.test.js', 'r') as f:
    lines = f.readlines()

new_lines = []
skip = False
for i, line in enumerate(lines):
    if "fsMock.readFileSync.mock.mockImplementation((file) => {" in line and "if (file.includes('.sha256'))" in lines[i+1]:
        new_lines.append("        fsMock.readFileSync.mock.mockImplementation((file) => {\n")
        new_lines.append("            if (file.includes('.sha256')) return 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb *a.tar.gz\\n';\n")
        new_lines.append("            if (file.includes('.json')) return JSON.stringify({ version: '1.0.0', commit: 'c'.repeat(40) });\n")
        new_lines.append("            return 'a';\n")
        new_lines.append("        });\n")
        skip = True
    elif skip and "});" in line:
        skip = False
    elif not skip:
        new_lines.append(line)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.writelines(new_lines)
