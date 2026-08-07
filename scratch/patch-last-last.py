import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

# Make rollback metadata have previousLegacyActive: true
text = text.replace(
    "rollbackId: '8ae3fe0f-0ada-4823-83bb-6475190e5f44', services: {}, paths: [], units: {} }",
    "rollbackId: '8ae3fe0f-0ada-4823-83bb-6475190e5f44', services: {}, paths: [], units: {}, previousLegacyActive: true }"
)

# In activate-happy, make curl fail once then succeed
text = text.replace(
    "if (cmd === 'systemctl') return '0\\n';\n            return '';",
    "if (cmd === 'systemctl') return '0\\n';\n            if (cmd === 'curl') {\n                if (!this.curlCalled) {\n                    this.curlCalled = true;\n                    throw new Error('fail');\n                }\n            }\n            return '';"
)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
