import { mock } from 'node:test';
mock.method(process, 'getuid', () => 0);
console.log(process.getuid());
mock.method(process, 'getuid', () => 1000);
console.log(process.getuid());
