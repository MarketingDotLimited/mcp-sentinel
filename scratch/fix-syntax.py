with open('tests/scripts/deploy-release.test.js', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb *a.tar.gz" in line:
        lines[i] = "            if (file.includes('.sha256')) return 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb *a.tar.gz\\n';\n"
        if "if (file.includes('.json'))" in lines[i+1]:
            pass

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.writelines(lines)
