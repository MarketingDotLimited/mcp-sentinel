import { mock } from 'node:test';
import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../scripts/deploy-release.js', import.meta.url));

const fsMock = { readFileSync: mock.fn() };
mock.module('fs', { defaultExport: fsMock });

process.argv = ['node', SCRIPT_PATH, 'unknown'];
console.log("RUNNING 1");
try { await import(SCRIPT_PATH + '?t=1'); } catch (e) { console.error("ERR", e); }

console.log("RUNNING 2");
try { await import(SCRIPT_PATH + '?t=2'); } catch (e) { console.error("ERR", e); }
