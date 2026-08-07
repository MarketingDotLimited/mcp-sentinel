import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

text = text.replace("throw new Error('BOOM INSIDE TEST');\n", "")
text = text.replace("console.log('USAGE TEST RAN');\n", "")
text = text.replace("originalFs.appendFileSync('scratch/err.txt', String(err.stack));", "")
text = text.replace("originalFs.appendFileSync('scratch/err.txt', 'EXIT MISMATCH: expected ' + expectedCode + ' got ' + actualCode + '\\n'); ", "")
text = text.replace("process.exitCode = 0;\nprocess.exitCode = 0;", "process.exitCode = 0;")
text = text.replace("process.exitCode = 0;\n", "process.exitCode = 0;\n", 1)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
