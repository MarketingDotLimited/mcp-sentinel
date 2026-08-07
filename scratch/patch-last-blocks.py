import re

with open('scripts/deploy-release.js', 'r') as f:
    text = f.read()

# Replace the block entirely
text = re.sub(
    r"if \(process\.argv\[1\] && path\.resolve\(process\.argv\[1\]\) === fileURLToPath\(import\.meta\.url\)\) \{\n\s+try \{\n\s+const \[action, argument\] = process\.argv\.slice\(2\);\n\s+if \(action === 'prepare'\) prepareHost\(\);\n\s+else if \(action === 'stage'\) stageRelease\(argument\);\n\s+else if \(action === 'activate'\) activateRelease\(argument\);\n\s+else if \(action === 'rollback'\) rollback\(argument\);\n\s+else usage\(\);\n\s+\} catch \(error\) \{\n\s+process\.stderr\.write\(`Deployment refused: \$\{error\.message\}\\n`\);\n\s+process\.exitCode = 1;\n\s+\}\n\}",
    r"if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {\n  runCommand(process.argv);\n}",
    text
)

with open('scripts/deploy-release.js', 'w') as f:
    f.write(text)
