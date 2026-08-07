import re
with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()
text = text.replace('{"MCP_SENTINEL_SECRET": "abc"}', '{"MCP_SENTINEL_SECRET": "a".repeat(64)}')
with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
