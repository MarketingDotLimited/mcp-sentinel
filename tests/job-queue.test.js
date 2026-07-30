import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { JobQueue } from '../lib/job-queue.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-job-queue-'));
after(() => fs.rm(directory, { recursive: true, force: true }));

describe('durable job queue', () => {
  it('deduplicates idempotent requests and recovers expired leases', () => {
    const queue = new JobQueue(path.join(directory, 'jobs.sqlite3'));
    const first = queue.enqueue({
      type: 'project_test',
      owner: 'alice',
      payload: { projectId: 'p1' },
      idempotencyKey: 'request-1',
    });
    const duplicate = queue.enqueue({
      type: 'project_test',
      owner: 'alice',
      payload: { projectId: 'different' },
      idempotencyKey: 'request-1',
    });
    assert.equal(duplicate.id, first.id);
    const claimed = queue.claim({ workerId: 'worker-a', leaseMs: 1000 });
    assert.equal(claimed.state, 'running');
    assert.equal(queue.claim({ workerId: 'worker-b', leaseMs: 1000 }), null);
    queue.complete(first.id, { state: 'passed', exitCode: 0 });
    assert.equal(queue.get(first.id).result.exitCode, 0);
  });

  it('bounds payloads, attempts, and cancellation', () => {
    const queue = new JobQueue(path.join(directory, 'bounded.sqlite3'), { maxPayloadBytes: 32 });
    assert.throws(
      () => queue.enqueue({ type: 'project_test', owner: 'alice', payload: { data: 'x'.repeat(100) } }),
      /payload/
    );
    const job = queue.enqueue({ type: 'backup', owner: 'alice' });
    assert.equal(queue.cancel(job.id).state, 'cancelled');
    assert.throws(() => queue.complete(job.id, {}), /missing|active/);
  });
});
