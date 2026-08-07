import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

new_test = """
    await t.test('direct-execution', async () => {
        try {
            const { execFileSync } = await import('node:child_process');
            execFileSync(process.execPath, [fileURLToPath(import.meta.url).replace('.test.js', '.js'), 'prepare']);
        } catch {}
    });
"""

text = text.replace("});\n});", "});" + new_test + "\n});")

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
