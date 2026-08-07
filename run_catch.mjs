import { test } from 'node:test';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
process.on('uncaughtException', e => {
  console.error('UNCAUGHT:', e);
  process.exit(1);
});
process.on('unhandledRejection', e => {
  console.error('UNHANDLED:', e);
  process.exit(1);
});
run({ files: ['tests/unit/app.test.js'] })
  .compose(new spec())
  .pipe(process.stdout);
