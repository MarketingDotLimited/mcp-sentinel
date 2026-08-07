import test from 'node:test';
test('exit code fail', () => {
    process.exitCode = 1;
    process.exitCode = undefined;
});
