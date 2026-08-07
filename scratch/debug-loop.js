import fs from 'fs';
import { fileURLToPath } from 'url';
const SCRIPT_PATH = fileURLToPath(new URL('../scripts/production-preflight.js', import.meta.url));

async function run() {
    const { setupBase } = await import('../tests/scripts/production-preflight.test.js');
    console.log(setupBase);
}
run();
