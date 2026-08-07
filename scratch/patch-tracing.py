import re

with open('scripts/deploy-release.js', 'r') as f:
    text = f.read()

text = text.replace("export function runCommand(argv) { console.log('RUNNING:', argv);", "export function runCommand(argv) { console.error('TRACING_START', argv);")
text = text.replace("function stageRelease(artifactArgument) {", "function stageRelease(artifactArgument) {\nconsole.error('TRACING: stageRelease start');")
text = text.replace("fs.mkdirSync(releasesRoot, { recursive: true, mode: 0o755 });", "fs.mkdirSync(releasesRoot, { recursive: true, mode: 0o755 });\nconsole.error('TRACING: mkdirSync done');")
text = text.replace("const temporary = safeStageDirectory(fs.mkdtempSync(path.join(releasesRoot, '.stage-')));", "console.error('TRACING: mkdtempSync start');\nconst temporary = safeStageDirectory(fs.mkdtempSync(path.join(releasesRoot, '.stage-')));\nconsole.error('TRACING: mkdtempSync done');")
text = text.replace("const fileBuffer = fs.readFileSync(sourceArtifact);", "console.error('TRACING: readFileSync start');\nconst fileBuffer = fs.readFileSync(sourceArtifact);\nconsole.error('TRACING: readFileSync done');")
text = text.replace("const computedChecksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');", "console.error('TRACING: createHash start');\nconst computedChecksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');\nconsole.error('TRACING: createHash done');")
text = text.replace("const payload = fs.readFileSync(path.join(temporary, 'manifest.json'));", "console.error('TRACING: read payload start');\nconst payload = fs.readFileSync(path.join(temporary, 'manifest.json'));\nconsole.error('TRACING: read payload done');")
text = text.replace("fs.rmSync(temporary, { recursive: true, force: true });", "console.error('TRACING: rmSync temporary');\nfs.rmSync(temporary, { recursive: true, force: true });\nconsole.error('TRACING: stageRelease complete');")

with open('scripts/deploy-release.js', 'w') as f:
    f.write(text)
