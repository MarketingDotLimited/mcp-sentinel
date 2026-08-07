import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../scripts/production-preflight.js', import.meta.url));

async function run() {
  process.argv = ['node', SCRIPT_PATH];
  try {
    const mod = await import(SCRIPT_PATH + '?t=' + Date.now());
  } catch (err) {
    console.error(err);
  }
}
run();
