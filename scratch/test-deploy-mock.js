import fs from 'fs';
import child_process from 'child_process';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../scripts/deploy-release.js', import.meta.url));

async function run() {
  const originalExec = child_process.execFileSync;
  child_process.execFileSync = (cmd, args) => {
    console.log('execFileSync', cmd, args);
    return '0\n';
  };
  
  process.argv = ['node', SCRIPT_PATH, 'prepare'];

  try {
    await import(`${SCRIPT_PATH}?t=${Date.now()}`);
  } catch (e) {
    console.error("ERROR", e);
  }
}
run();
