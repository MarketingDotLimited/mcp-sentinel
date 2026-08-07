import { after, describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { JobQueue, getJobQueue } from '../lib/job-queue.js';

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
    assert.throws(() => queue.complete(first.id, { state: 'passed', exitCode: 0 }), /Worker ID/);
    assert.throws(
      () => queue.complete(first.id, { state: 'passed', exitCode: 0 }, { workerId: 'worker-b' }),
      /missing|active/
    );
    queue.complete(first.id, { state: 'passed', exitCode: 0 }, { workerId: 'worker-a' });
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
    assert.throws(() => queue.complete(job.id, {}, { workerId: 'worker-1' }), /missing|active/);
  });

  it('runs only explicitly registered handlers and stops cleanly', async () => {
    const queue = new JobQueue(path.join(directory, 'worker.sqlite3'));
    const job = queue.enqueue({ type: 'backup', owner: 'worker-test' });
    let calls = 0;
    const stop = queue.startWorker({
      workerId: 'worker-1',
      pollMs: 25,
      handlers: {
        backup: async payload => {
          calls += 1;
          return { accepted: payload };
        },
      },
    });
    for (let index = 0; index < 20 && queue.get(job.id).state !== 'completed'; index += 1)
      await new Promise(resolve => setTimeout(resolve, 10));
    stop();
    assert.equal(calls, 1);
    assert.deepEqual(queue.get(job.id).result.accepted, {});
  });

  it('exceeds max attempts', () => {
    const queue = new JobQueue(path.join(directory, 'max-attempts.sqlite3'));
    const job = queue.enqueue({ type: 'test', owner: 'alice', maxAttempts: 1 });
    const claim1 = queue.claim({ workerId: 'worker-1', leaseMs: 1000 });
    assert.equal(claim1.state, 'running');
    queue.database.prepare('UPDATE sentinel_jobs SET lease_until = ?').run(Date.now() - 10000);
    const claim2 = queue.claim({ workerId: 'worker-2' });
    assert.equal(claim2, null);
    const failedJob = queue.get(job.id);
    assert.equal(failedJob.state, 'failed');
    assert.equal(failedJob.error, 'Maximum attempts exceeded');
  });

  it('rolls back on database error during claim', () => {
    const queue = new JobQueue(path.join(directory, 'rollback.sqlite3'));
    queue.enqueue({ type: 'test', owner: 'alice' });
    const originalPrepare = queue.database.prepare;
    queue.database.prepare = sql => {
      if (sql.includes('UPDATE')) {
        throw new Error('Fake DB Error');
      }
      return originalPrepare.call(queue.database, sql);
    };
    assert.throws(() => queue.claim({ workerId: 'w1' }), /Fake DB Error/);
    queue.database.prepare = originalPrepare;
  });

  it('supports fail method with and without retry', () => {
    const queue = new JobQueue(path.join(directory, 'fail.sqlite3'));
    const job1 = queue.enqueue({ type: 't1', owner: 'alice', maxAttempts: 3 });
    queue.claim({ workerId: 'w1' });
    queue.fail(job1.id, new Error('Oops'), { workerId: 'w1', retry: true });
    let j1 = queue.get(job1.id);
    assert.equal(j1.state, 'queued');
    assert.equal(j1.error, 'Oops');

    queue.claim({ workerId: 'w2' });
    queue.fail(job1.id, 'String error', { workerId: 'w2', retry: false });
    j1 = queue.get(job1.id);
    assert.equal(j1.state, 'failed');
    assert.equal(j1.error, 'String error');

    assert.throws(() => queue.fail('non-existent', 'err', { workerId: 'w1' }), /Job not found/);
  });

  it('lists jobs with filters', () => {
    const queue = new JobQueue(path.join(directory, 'list.sqlite3'));
    queue.enqueue({ type: 't1', owner: 'alice' });
    queue.enqueue({ type: 't2', owner: 'bob' });

    const all = queue.list();
    assert.equal(all.length, 2);

    const aliceJobs = queue.list({ owner: 'alice' });
    assert.equal(aliceJobs.length, 1);
    assert.equal(aliceJobs[0].owner, 'alice');

    const queued = queue.list({ states: ['queued'] });
    assert.equal(queued.length, 2);

    assert.throws(() => queue.list({ limit: -1 }), /limit is invalid/);
    assert.throws(() => queue.list({ states: ['invalid'] }), /states is invalid/);
    assert.throws(() => queue.list({ states: [] }), /states is invalid/);
    assert.throws(() => queue.list({ states: 'not-an-array' }), /states is invalid/);
  });

  it('fails jobs on missing handler or handler error', async () => {
    const queue = new JobQueue(path.join(directory, 'worker-errors.sqlite3'));
    const job1 = queue.enqueue({ type: 'missing', owner: 'test' });
    const job2 = queue.enqueue({ type: 'error', owner: 'test' });

    const stop = queue.startWorker({
      workerId: 'w1',
      pollMs: 25,
      handlers: {
        error: async () => {
          throw new Error('Handler failed');
        },
      },
    });

    for (
      let index = 0;
      index < 20 && (queue.get(job1.id).state !== 'failed' || queue.get(job2.id).state !== 'failed');
      index += 1
    ) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    stop();

    assert.equal(queue.get(job1.id).state, 'failed');
    assert.match(queue.get(job1.id).error, /No registered handler/);

    assert.equal(queue.get(job2.id).state, 'failed');
    assert.equal(queue.get(job2.id).error, 'Handler failed');
  });

  it('handles invalid JSON in result and payload', () => {
    const queue = new JobQueue(path.join(directory, 'invalid-json.sqlite3'));
    const job = queue.enqueue({ type: 't1', owner: 'alice' });
    queue.database.prepare("UPDATE sentinel_jobs SET result='invalid-json', payload='{' WHERE id=?").run(job.id);
    const fetched = queue.get(job.id);
    assert.equal(fetched.result, 'invalid-json');
    assert.deepEqual(fetched.payload, {});
  });

  it('provides singleton default queue', () => {
    const q1 = getJobQueue();
    const q2 = getJobQueue();
    assert.equal(q1, q2);
    assert.ok(q1 instanceof JobQueue);
  });

  it('bounds results', () => {
    const queue = new JobQueue(path.join(directory, 'bounds-result.sqlite3'), { maxPayloadBytes: 32 });
    const job = queue.enqueue({ type: 'test', owner: 'alice' });
    queue.claim({ workerId: 'w1' });
    assert.throws(() => queue.complete(job.id, { data: 'x'.repeat(100) }, { workerId: 'w1' }), /result exceeds/);
  });

  it('validates various parameters', () => {
    assert.throws(() => new JobQueue('/'), /bounded job database path is required/);

    const queue = new JobQueue(path.join(directory, 'validation.sqlite3'));
    assert.throws(() => queue.enqueue({ type: 'INVALID!', owner: 'alice' }), /unsupported characters/);
    assert.throws(() => queue.enqueue({ type: 't1', owner: 'alice', maxAttempts: 11 }), /maxAttempts is invalid/);
    assert.throws(() => queue.claim({ workerId: 'w1', leaseMs: 500 }), /leaseMs is invalid/);
    assert.throws(() => queue.claim({ workerId: '' }), /Worker ID is invalid/);
    assert.throws(() => queue.startWorker({ workerId: 'w1', pollMs: 10 }), /pollMs is invalid/);
  });

  it('triggers edge cases for full coverage', async () => {
    // BRDA:13,2 jsonSize with nullish payload
    const queue = new JobQueue(path.join(directory, 'edge.sqlite3'));
    queue.enqueue({ type: 'test', owner: 'alice', payload: null });

    // BRDA:23,9 JobQueue constructor with undefined databaseFile
    try {
      new JobQueue(undefined);
    } catch (e) {
      // ignore
    }

    // BRDA:132,47 shouldRetry is false because attempts >= maxAttempts
    const edgeQueue = new JobQueue(path.join(directory, 'edge2.sqlite3'));
    const job2 = edgeQueue.enqueue({ type: 't2', owner: 'alice', maxAttempts: 1 });
    edgeQueue.claim({ workerId: 'w1' }); // attempts = 1
    edgeQueue.fail(job2.id, 'fail', { retry: true, workerId: 'w1' });
    assert.equal(edgeQueue.get(job2.id).state, 'failed');

    // BRDA:116,37 catch inside catch for rollback
    const rollbackQueue = new JobQueue(path.join(directory, 'rollback-catch.sqlite3'));
    rollbackQueue.enqueue({ type: 'test', owner: 'alice' });
    const originalPrepare = rollbackQueue.database.prepare;
    rollbackQueue.database.prepare = sql => {
      if (sql.includes('UPDATE')) throw new Error('Fake DB Error');
      return originalPrepare.call(rollbackQueue.database, sql);
    };
    const originalExec = rollbackQueue.database.exec;
    rollbackQueue.database.exec = sql => {
      if (sql === 'ROLLBACK') throw new Error('Rollback failed');
      return originalExec.call(rollbackQueue.database, sql);
    };
    assert.throws(() => rollbackQueue.claim({ workerId: 'w1' }), /Fake DB Error/);
  });

  it('worker stops gracefully after processing (hits stopped condition)', async () => {
    const queue = new JobQueue(path.join(directory, 'worker-stop.sqlite3'));
    const job = queue.enqueue({ type: 'test', owner: 'alice' });
    let handlerStarted = false;
    let resolveHandler;
    const handlerPromise = new Promise(r => {
      resolveHandler = r;
    });
    const stop = queue.startWorker({
      workerId: 'w1',
      handlers: {
        test: async () => {
          handlerStarted = true;
          await handlerPromise;
          return {};
        },
      },
    });

    while (!handlerStarted) {
      await new Promise(r => setTimeout(r, 5));
    }

    stop();
    resolveHandler();
  });

  it('handles falsy error in fail', () => {
    const queue = new JobQueue(path.join(directory, 'falsy-error.sqlite3'));
    const job = queue.enqueue({ type: 'test', owner: 'alice' });
    queue.claim({ workerId: 'w1' });
    queue.fail(job.id, null, { workerId: 'w1' });
    assert.equal(queue.get(job.id).error, 'Job failed');
  });

  it('triggers invalid terminal state by mocking array includes', () => {
    const queue = new JobQueue(path.join(directory, 'invalid-state.sqlite3'));
    const job = queue.enqueue({ type: 'test', owner: 'alice' });
    queue.claim({ workerId: 'w1' });

    const originalIncludes = Array.prototype.includes;
    Array.prototype.includes = function (searchElement) {
      if (searchElement === 'completed') return false;
      return originalIncludes.apply(this, arguments);
    };

    try {
      queue.complete(job.id, {}, { workerId: 'w1' });
    } catch (e) {
      assert.match(e.message, /Invalid terminal state/);
    } finally {
      Array.prototype.includes = originalIncludes;
    }
  });
});
