import { mock } from 'node:test';
try { mock.method(process.stdout, 'write', () => {}); console.log('OK'); } catch (e) { console.error('ERR:', e); }
