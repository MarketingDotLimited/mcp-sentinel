import test, { mock } from 'node:test';
mock.module('node:sqlite', {
  namedExports: {
    DatabaseSync: class {
      constructor() { this.prepare = mock.fn(); }
    }
  }
});
import { DatabaseSync } from 'node:sqlite';
test('test', async () => {
  console.log(new DatabaseSync());
});
