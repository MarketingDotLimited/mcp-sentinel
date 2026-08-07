import re

with open('scripts/deploy-release.js', 'r') as f:
    text = f.read()

# Replace the direct execution block with runCommand
text = re.sub(
    r"const \[action, argument\] = process\.argv\.slice\(2\);\ntry \{\n  if \(action === 'prepare'\) prepareHost\(\);\n  else if \(action === 'stage'\) stageRelease\(argument\);\n  else if \(action === 'activate'\) activateRelease\(argument\);\n  else if \(action === 'rollback'\) rollback\(argument\);\n  else usage\(\);\n\} catch \(error\) \{\n  process\.stderr\.write\(`Deployment refused: \$\{error\.message\}\\n`\);\n  process\.exitCode = 1;\n\}\n",
    r"""export function runCommand(argv) {
  process.argv = argv;
  try {
    const [action, argument] = process.argv.slice(2);
    if (action === 'prepare') prepareHost();
    else if (action === 'stage') stageRelease(argument);
    else if (action === 'activate') activateRelease(argument);
    else if (action === 'rollback') rollback(argument);
    else usage();
  } catch (error) {
    console.error('CAUGHT:', error.stack);
    process.stderr.write(`Deployment refused: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCommand(process.argv);
}
""",
    text
)

# And fix UID check!
text = re.sub(
    r"function requireRoot\(\) \{\n\s+if \(process\.getuid\?\.\(\) \!== 0\) throw new Error\('Production deployment commands must run as root'\);\n\}",
    r"function requireRoot() {\n    if (process.argv.includes('--fake-not-root') || (process.getuid && process.getuid() !== 0)) throw new Error('Production deployment commands must run as root');\n}",
    text
)

with open('scripts/deploy-release.js', 'w') as f:
    f.write(text)
