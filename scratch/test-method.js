import fs from 'fs';
import { mock } from 'node:test';
mock.method(fs, 'mkdirSync', () => { console.log('MOCKED MKDIR'); });

const mod = await import('../scripts/deploy-release.js?t=' + Date.now());
