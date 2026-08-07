import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

# Make validateProjectWritePaths return a path
text = text.replace(
    "validateProjectWritePaths: mock.fn(() => []),",
    "validateProjectWritePaths: mock.fn(() => ['/some/path']),"
)

# Make systemctl show return transient path for killTransientService
text = text.replace(
    "if (cmd === 'systemctl') return '0\\n';",
    "if (cmd === 'systemctl' && args && args.includes('show')) return '/run/systemd/transient/mcp-sentinel-update.service\\n'; if (cmd === 'systemctl') return '0\\n';"
)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
