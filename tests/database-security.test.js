import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { boundedRows, classifyQuery } from '../tools/db.js';

describe('database query boundary', () => {
  it('classifies read and write statements without accepting comments or multiple statements', () => {
    assert.equal(classifyQuery('SELECT id FROM users').readOnly, true);
    assert.equal(classifyQuery('UPDATE users SET active = ? WHERE id = ?').readOnly, false);
    assert.throws(() => classifyQuery('-- hidden\nDELETE FROM users'), /uncommented/);
    assert.throws(() => classifyQuery('SELECT 1; DELETE FROM users'), /one uncommented/);
    assert.throws(() => classifyQuery("SELECT LOAD_FILE('/etc/passwd')"), /forbidden/);
  });

  it('enforces row and serialized-byte limits', () => {
    assert.deepEqual(boundedRows([{ id: 1 }, { id: 2 }], 1, 1000), {
      rows: [{ id: 1 }],
      bytes: 11,
      truncated: true,
    });
    const bytes = boundedRows([{ value: 'x'.repeat(100) }], 10, 20);
    assert.deepEqual(bytes.rows, []);
    assert.equal(bytes.truncated, true);
  });
});
