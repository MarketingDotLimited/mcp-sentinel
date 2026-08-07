import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../scripts/deploy-release.js', import.meta.url));

async function run() {
  process.argv = ['node', SCRIPT_PATH, 'prepare'];
  try {
    await import(SCRIPT_PATH + '?t=' + Date.now());
  } catch (err) {
    console.error(err);
  }
}
run();
