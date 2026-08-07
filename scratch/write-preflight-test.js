import fs from 'fs';
// We'll write the full test file using a helper script to avoid escaping issues
const content = `
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/production-preflight.js', import.meta.url));

test('production-preflight.js', async (t) => {
    // ...
});
`;
// ...
