import re

with open('scripts/deploy-release.js', 'r') as f:
    text = f.read()

text = text.replace(
    "export function runCommand(argv) {",
    "export function runCommand(argv) { console.log('RUNNING:', argv);"
)
text = text.replace(
    "  } catch (error) {",
    "  } catch (error) { console.log('CAUGHT:', error.stack);"
)
text = text.replace(
    "  if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {",
    "  console.log('END OF RUNCOMMAND, exitCode is', process.exitCode);\n  if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {"
)
# wait, END OF RUNCOMMAND should be inside runCommand!
text = text.replace(
    "    process.exitCode = 1;\n  }\n}",
    "    process.exitCode = 1;\n  }\n  console.log('END OF RUNCOMMAND, exitCode is', process.exitCode);\n}"
)

with open('scripts/deploy-release.js', 'w') as f:
    f.write(text)
