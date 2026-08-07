import child_process from 'child_process';
import { mock } from 'node:test';

mock.method(child_process, 'execFileSync', () => 'MOCKED');

import { execFileSync } from 'child_process';
console.log(execFileSync('ls'));
