import test from 'node:test';

test('suite', async (t) => {
    await t.test('test 1', async () => {
        console.log('TEST 1');
        throw new Error('BOOM');
    });
});
