with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

# fix process.getuid inside the test file to mock properly
text = text.replace("process.getuid = () => 1000;", "const old = process.getuid; process.getuid = () => 1000;")
text = text.replace("process.getuid = () => 0;", "process.getuid = old;")

# fix stage-happy exiting with 1 (because it's lacking something)
# Wait! In setupStageHappy, fsMock.lstatSync returns an object that lacks isDirectory!
# Because in stageRelease, it does lstatSync(tempDir).isDirectory() ? No, lstatSync(currentLink) maybe?
text = text.replace(
    "fsMock.lstatSync.mock.mockImplementation(() => ({ isFile: () => true, isSymbolicLink: () => false, size: 1024, mode: 0o600, uid: 0, gid: 0 }));",
    "fsMock.lstatSync.mock.mockImplementation(() => ({ isFile: () => true, isDirectory: () => true, isSymbolicLink: () => false, size: 1024, mode: 0o600, uid: 0, gid: 0 }));"
)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
