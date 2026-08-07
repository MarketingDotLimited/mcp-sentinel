import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

text = text.replace(
    "const { runCommand } = await import(SCRIPT_PATH);",
    "const originalArgv = process.argv;\nprocess.argv = ['node', SCRIPT_PATH, 'prepare'];\nlet runCommand;\ntry {\nrunCommand = (await import(SCRIPT_PATH)).runCommand;\n} catch (e) {}\nprocess.argv = originalArgv;\nif (!runCommand) runCommand = (await import(SCRIPT_PATH)).runCommand;"
)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
