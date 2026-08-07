import re
with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()
text = re.sub(r'\{ "MCP_SENTINEL_SECRET": "abc" \}', r'{ "MCP_SENTINEL_SECRET": "a".repeat(64) }', text)
# And let's print exitCode in run() regardless of failure!
text = text.replace(
    "const actualCode = process.exitCode; console.log(\"IMMEDIATE EXIT CODE:\", actualCode);",
    "const actualCode = process.exitCode; console.error(`>>> TEST ${action} ${arg} FINISHED WITH ${actualCode} <<<`);"
)
with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
