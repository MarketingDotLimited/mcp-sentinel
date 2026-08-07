import re

with open('scripts/deploy-release.js', 'r') as f:
    text = f.read()

cli_code = """
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
    process.stderr.write(`Deployment refused: ${error.message}\\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCommand(process.argv);
}
"""

text = re.sub(r"if \(process\.argv\[1\] && path\.resolve.*?\} catch \(error\) \{.*?\n\s+process\.exitCode = 1;\n\s+\}\n\}", cli_code, text, flags=re.DOTALL)

with open('scripts/deploy-release.js', 'w') as f:
    f.write(text)
