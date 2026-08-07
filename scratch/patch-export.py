import re

with open('scripts/deploy-release.js', 'r') as f:
    text = f.read()

# I will wrap the bottom CLI code into a function.
cli_code = """
export function runCommand(argv) {
  process.argv = argv;
  const commandArg = process.argv[2];
  if (!commandArg || !['prepare', 'stage', 'activate', 'rollback'].includes(commandArg)) {
    process.stderr.write('Usage: install.sh prepare | stage <signed-artifact.tar.gz> | activate <release-id> | rollback <rollback-id>\\n');
    process.exitCode = 2;
    return;
  }

  try {
    if (commandArg === 'prepare') prepareHost();
    else if (commandArg === 'stage') stageRelease(process.argv[3]);
    else if (commandArg === 'activate') installService(process.argv[3], false);
    else if (commandArg === 'rollback') installService(process.argv[3], true);
  } catch (error) {
    process.stderr.write(`Deployment refused: ${error.message}\\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCommand(process.argv);
}
"""

text = re.sub(r"const commandArg = process\.argv\[2\];.*$", cli_code, text, flags=re.DOTALL)

with open('scripts/deploy-release.js', 'w') as f:
    f.write(text)

