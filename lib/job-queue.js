// Durable, bounded job coordination for long-running Sentinel operations.
// This module deliberately stores metadata and opaque task payloads only; it
// never executes commands and therefore cannot become a generic shell path.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;
const TYPE_PATTERN = /^[a-z][a-z0-9_.:-]{0,79}$/;

function jsonSize(value) {
  return Buffer.byteLength(JSON.stringify(value ?? {}), 'utf8');
}

function assertText(value, name, max = 256) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) throw new Error(`${name} is invalid`);
  return value;
}

export class JobQueue {
  constructor(databaseFile, options = {}) {
    this.databaseFile = path.resolve(String(databaseFile || ''));
    if (!this.databaseFile || this.databaseFile === path.parse(this.databaseFile).root)
      throw new Error('A bounded job database path is required');
    this.maxPayloadBytes = options.maxPayloadBytes || DEFAULT_MAX_PAYLOAD_BYTES;
    fs.mkdirSync(path.dirname(this.databaseFile), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(this.databaseFile);
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS sentinel_jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        owner TEXT NOT NULL,
        idempotency_key TEXT,
        state TEXT NOT NULL,
        payload TEXT NOT NULL,
        result TEXT,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        lease_until INTEGER,
        worker_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(owner, idempotency_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS sentinel_jobs_state_idx ON sentinel_jobs(state, created_at);
      CREATE INDEX IF NOT EXISTS sentinel_jobs_lease_idx ON sentinel_jobs(lease_until);
    `);
    fs.chmodSync(this.databaseFile, 0o600);
  }

  enqueue({ type, owner, payload = {}, idempotencyKey = null, maxAttempts = 3 } = {}) {
    assertText(type, 'Job type', 80);
    if (!TYPE_PATTERN.test(type)) throw new Error('Job type contains unsupported characters');
    assertText(owner, 'Job owner', 256);
    if (idempotencyKey !== null) assertText(idempotencyKey, 'Idempotency key', 256);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10)
      throw new Error('maxAttempts is invalid');
    if (jsonSize(payload) > this.maxPayloadBytes) throw new Error('Job payload exceeds the configured limit');
    const now = new Date().toISOString();
    const existing = idempotencyKey
      ? this.database
          .prepare('SELECT * FROM sentinel_jobs WHERE owner = ? AND idempotency_key = ?')
          .get(owner, idempotencyKey)
      : null;
    if (existing) return this.#row(existing);
    const id = crypto.randomUUID();
    this.database
      .prepare(
        `INSERT INTO sentinel_jobs
         (id,type,owner,idempotency_key,state,payload,attempts,max_attempts,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .run(id, type, owner, idempotencyKey, 'queued', JSON.stringify(payload), 0, maxAttempts, now, now);
    return this.get(id);
  }

  claim({ workerId, leaseMs = 60000 } = {}) {
    assertText(workerId, 'Worker ID', 256);
    if (!Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 3600000) throw new Error('leaseMs is invalid');
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const row = this.database
        .prepare(
          `SELECT * FROM sentinel_jobs
           WHERE state = 'queued' OR (state = 'running' AND lease_until IS NOT NULL AND lease_until < ?)
           ORDER BY created_at ASC LIMIT 1`
        )
        .get(now);
      if (!row) {
        this.database.exec('COMMIT');
        return null;
      }
      const attempts = Number(row.attempts) + 1;
      if (attempts > Number(row.max_attempts)) {
        this.database
          .prepare("UPDATE sentinel_jobs SET state='failed', error=?, updated_at=? WHERE id=?")
          .run('Maximum attempts exceeded', nowIso, row.id);
        this.database.exec('COMMIT');
        return null;
      }
      this.database
        .prepare(
          "UPDATE sentinel_jobs SET state='running', attempts=?, worker_id=?, lease_until=?, updated_at=? WHERE id=?"
        )
        .run(attempts, workerId, now + leaseMs, nowIso, row.id);
      this.database.exec('COMMIT');
      return this.get(row.id);
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {}
      throw error;
    }
  }

  complete(id, result = {}) {
    return this.#finish(id, 'completed', result, null);
  }

  fail(id, error, { retry = true } = {}) {
    const row = this.get(id);
    if (!row) throw new Error('Job not found');
    const shouldRetry = retry && row.attempts < row.maxAttempts;
    const state = shouldRetry ? 'queued' : 'failed';
    return this.#finish(id, state, null, String(error?.message || error || 'Job failed'));
  }

  cancel(id, reason = 'Cancelled by requester') {
    return this.#finish(id, 'cancelled', null, String(reason).slice(0, 1000));
  }

  get(id) {
    assertText(id, 'Job ID', 80);
    const row = this.database.prepare('SELECT * FROM sentinel_jobs WHERE id = ?').get(id);
    return row ? this.#row(row) : null;
  }

  list({ owner = null, states = null, limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('limit is invalid');
    const clauses = [];
    const values = [];
    if (owner !== null) {
      assertText(owner, 'Job owner', 256);
      clauses.push('owner = ?');
      values.push(owner);
    }
    if (states !== null) {
      if (
        !Array.isArray(states) ||
        !states.length ||
        !states.every(state => ['queued', 'running', 'completed', 'failed', 'cancelled'].includes(state))
      )
        throw new Error('states is invalid');
      clauses.push(`state IN (${states.map(() => '?').join(',')})`);
      values.push(...states);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.database
      .prepare(`SELECT * FROM sentinel_jobs ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...values, limit)
      .map(row => this.#row(row));
  }

  // Execute only handlers explicitly registered by the embedding service.
  // A worker has no fallback executable and stops cleanly on shutdown.
  startWorker({ workerId, handlers = {}, pollMs = 250, leaseMs = 60000 } = {}) {
    assertText(workerId, 'Worker ID', 256);
    if (!Number.isInteger(pollMs) || pollMs < 25 || pollMs > 60000) throw new Error('pollMs is invalid');
    let stopped = false;
    let timer;
    const run = async () => {
      if (stopped) return;
      const job = this.claim({ workerId, leaseMs });
      if (!job) {
        timer = setTimeout(run, pollMs);
        timer.unref?.();
        return;
      }
      const handler = handlers[job.type];
      if (typeof handler !== 'function') {
        this.fail(job.id, `No registered handler for job type '${job.type}'`, { retry: false });
      } else {
        try {
          this.complete(job.id, await handler(job.payload, job));
        } catch (error) {
          this.fail(job.id, error);
        }
      }
      timer = setImmediate(run);
      timer.unref?.();
    };
    void run();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (timer) clearImmediate(timer);
    };
  }

  #finish(id, state, result, error) {
    if (!['completed', 'failed', 'queued', 'cancelled'].includes(state)) throw new Error('Invalid terminal state');
    if (result !== null && jsonSize(result) > this.maxPayloadBytes)
      throw new Error('Job result exceeds the configured limit');
    const now = new Date().toISOString();
    const outcome = this.database
      .prepare(
        'UPDATE sentinel_jobs SET state=?, result=?, error=?, lease_until=NULL, worker_id=NULL, updated_at=? WHERE id=? AND state IN (?,?)'
      )
      .run(state, result === null ? null : JSON.stringify(result), error, now, id, 'running', 'queued');
    if (!outcome.changes) throw new Error('Job is missing or no longer active');
    return this.get(id);
  }

  #row(row) {
    let payload = {};
    let result;
    try {
      payload = JSON.parse(row.payload);
    } catch {}
    try {
      result = row.result === null ? null : JSON.parse(row.result);
    } catch {
      result = row.result;
    }
    return {
      id: row.id,
      type: row.type,
      owner: row.owner,
      idempotencyKey: row.idempotency_key,
      state: row.state,
      payload,
      result,
      error: row.error,
      attempts: Number(row.attempts),
      maxAttempts: Number(row.max_attempts),
      leaseUntil: row.lease_until === null ? null : Number(row.lease_until),
      workerId: row.worker_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

let defaultQueue;
export function getJobQueue() {
  if (!defaultQueue)
    defaultQueue = new JobQueue(process.env.MCP_JOB_DB || process.env.MCP_STATE_DB || './data/jobs.sqlite3', {
      maxPayloadBytes: Number(process.env.MCP_JOB_MAX_PAYLOAD_BYTES || DEFAULT_MAX_PAYLOAD_BYTES),
    });
  return defaultQueue;
}
