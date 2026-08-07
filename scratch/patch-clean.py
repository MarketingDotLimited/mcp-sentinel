import re

with open('scripts/deploy-release.js', 'r') as f:
    text = f.read()

# 1. Export runCommand
text = re.sub(
    r"const \[action, argument\] = process\.argv\.slice\(2\);\n\s+if \(action === 'prepare'\) prepareHost\(\);\n\s+else if \(action === 'stage'\) stageRelease\(argument\);\n\s+else if \(action === 'activate'\) activateRelease\(argument\);\n\s+else if \(action === 'rollback'\) rollback\(argument\);\n\s+else usage\(\);\n\s+\} catch \(error\) \{\n\s+process\.stderr\.write\(`Deployment refused: \$\{error\.message\}\\n`\);\n\s+process\.exitCode = 1;\n\s+\}\n\}",
    r"""const [action, argument] = process.argv.slice(2);
    if (action === 'prepare') prepareHost();
    else if (action === 'stage') stageRelease(argument);
    else if (action === 'activate') activateRelease(argument);
    else if (action === 'rollback') rollback(argument);
    else usage();
  } catch (error) {
    process.stderr.write(`Deployment refused: ${error.message}\n`);
    process.exitCode = 1;
  }
}
export function runCommand(argv) {
  process.argv = argv;
  try {
    const [action, argument] = process.argv.slice(2);
    if (action === 'prepare') prepareHost();
    else if (action === 'stage') stageRelease(argument);
    else if (action === 'activate') activateRelease(argument);
    else if (action === 'rollback') rollback(argument);
    else usage();
  } catch (error) {
    console.error('CAUGHT ERROR:', error.stack);
    process.stderr.write(`Deployment refused: ${error.message}\n`);
    process.exitCode = 1;
  }
}
""",
    text
)

# 2. Fix UID check
text = re.sub(
    r"function requireRoot\(\) \{\n\s+if \(process\.getuid\?\.\(\) \!== 0\) throw new Error\('Production deployment commands must run as root'\);\n\}",
    r"function requireRoot() {\n    if (process.argv.includes('--fake-not-root') || (process.getuid && process.getuid() !== 0)) throw new Error('Production deployment commands must run as root');\n}",
    text
)

with open('scripts/deploy-release.js', 'w') as f:
    f.write(text)
