import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

mock.module('node:fs', {
  namedExports: {
    readFileSync: (path, options) => {
      if (path === '/etc/passwd')
        return 'root:x:0:0:root:/root:/bin/bash\nfakeuser:x:1000:1000::/home/fakeuser:/bin/bash';
      return fs.readFileSync(path, options);
    },
  },
});

const { handleRequest } = await import(`../broker.js?mock=${Date.now()}`);

test('mock fs', async () => {
  assert.ok(handleRequest);
});
