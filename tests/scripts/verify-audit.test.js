import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import os from 'os';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/verify-audit.js', import.meta.url));

test('verify-audit.js', async (t) => {
    let stdoutWrites = [];
    const originalEnv = { ...process.env };
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-audit-test-'));
    const logDir = path.join(tempDir, 'logs');
    const checkpointFile = path.join(tempDir, 'checkpoint.json');
    const credDir = path.join(tempDir, 'credentials');

    t.mock.method(process.stdout, 'write', (data) => {
        stdoutWrites.push(data);
    });

    t.beforeEach(() => {
        fs.mkdirSync(logDir, { recursive: true });
        fs.mkdirSync(credDir, { recursive: true });
        
        const keyHex = 'a'.repeat(64);
        fs.writeFileSync(path.join(credDir, 'audit-key'), keyHex);
        
        process.env.AUDIT_LOG_DIR = logDir;
        process.env.AUDIT_CHECKPOINT_FILE = checkpointFile;
        process.env.CREDENTIALS_DIRECTORY = credDir;
        delete process.env.AUDIT_HMAC_KEY;
    });

    t.afterEach(() => {
        process.env = { ...originalEnv };
        stdoutWrites = [];
        mock.reset();
        try { fs.rmSync(logDir, { recursive: true, force: true }); } catch(e) { void e; }
        try { fs.rmSync(credDir, { recursive: true, force: true }); } catch(e) { void e; }
        try { fs.rmSync(checkpointFile, { force: true }); } catch(e) { void e; }
    });

    t.after(() => {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch(e) { void e; }
    });

    function createValidEntry(key, seqNo, prevHash, data) {
        const keyBuffer = Buffer.from(key, 'hex');
        
        function canonicalize(value) {
            if (Array.isArray(value)) return value.map(canonicalize);
            if (value && typeof value === 'object')
                return Object.fromEntries(
                Object.keys(value)
                    .sort()
                    .map(key => [key, canonicalize(value[key])])
                );
            return value;
        }

        const entry = { seqNo, previousHash: prevHash, data };
        const calculated = crypto
            .createHmac('sha256', keyBuffer)
            .update(`${prevHash}\n${JSON.stringify(canonicalize(entry))}`)
            .digest('hex');
            
        return { ...entry, hash: calculated, chainProtection: true };
    }

    await t.test('throws if key invalid', async () => {
        fs.writeFileSync(path.join(credDir, 'audit-key'), 'invalid');
        await assert.rejects(
            () => import(`${SCRIPT_PATH}?t=${Date.now()}`),
            /AUDIT_HMAC_KEY or audit-key credential must contain 64 hex characters/
        );
    });

    await t.test('verifies valid log files (gz and plain)', async () => {
        const key = 'a'.repeat(64);
        const rootHash = crypto.createHmac('sha256', Buffer.from(key, 'hex')).update('mcp-sentinel-audit-v1').digest('hex');
        
        const entry1 = createValidEntry(key, 1, rootHash, 'test1');
        const entry2 = createValidEntry(key, 2, entry1.hash, 'test2');
        
        fs.writeFileSync(path.join(logDir, 'audit-1.log'), JSON.stringify(entry1) + '\n');
        fs.writeFileSync(path.join(logDir, 'audit-2.log.gz'), zlib.gzipSync(JSON.stringify(entry2) + '\n'));
        
        fs.writeFileSync(checkpointFile, JSON.stringify({ seqNo: 2, hash: entry2.hash }));
        
        process.env.AUDIT_VERIFICATION_STATUS_FILE = path.join(tempDir, 'status.json');

        await import(`${SCRIPT_PATH}?t=${Date.now()}`);
        
        const output = JSON.parse(stdoutWrites[0]);
        assert.equal(output.verified, true);
        assert.equal(output.entries, 2);
        assert.equal(output.hash, entry2.hash);
        
        const status = JSON.parse(fs.readFileSync(process.env.AUDIT_VERIFICATION_STATUS_FILE, 'utf8'));
        assert.equal(status.verified, true);
    });

    await t.test('throws on sequence break', async () => {
        const key = 'a'.repeat(64);
        const rootHash = crypto.createHmac('sha256', Buffer.from(key, 'hex')).update('mcp-sentinel-audit-v1').digest('hex');
        
        const entry1 = createValidEntry(key, 2, rootHash, 'test1'); // Wrong sequence
        fs.writeFileSync(path.join(logDir, 'audit-1.log'), JSON.stringify(entry1) + '\n');
        
        await assert.rejects(
            () => import(`${SCRIPT_PATH}?t=${Date.now()}`),
            /Audit sequence break in audit-1.log: expected 1/
        );
    });

    await t.test('throws on previous hash mismatch', async () => {
        const key = 'a'.repeat(64);
        
        const entry1 = createValidEntry(key, 1, 'wrong-hash', 'test1'); 
        fs.writeFileSync(path.join(logDir, 'audit-1.log'), JSON.stringify(entry1) + '\n');
        
        await assert.rejects(
            () => import(`${SCRIPT_PATH}?t=${Date.now()}`),
            /Audit previous-hash mismatch in audit-1.log/
        );
    });

    await t.test('throws on HMAC mismatch', async () => {
        const key = 'a'.repeat(64);
        const rootHash = crypto.createHmac('sha256', Buffer.from(key, 'hex')).update('mcp-sentinel-audit-v1').digest('hex');
        
        const entry1 = createValidEntry(key, 1, rootHash, 'test1');
        entry1.hash = 'wrong-hmac';
        fs.writeFileSync(path.join(logDir, 'audit-1.log'), JSON.stringify(entry1) + '\n');
        
        await assert.rejects(
            () => import(`${SCRIPT_PATH}?t=${Date.now()}`),
            /Audit HMAC mismatch in audit-1.log/
        );
    });

    await t.test('throws on checkpoint mismatch', async () => {
        const key = 'a'.repeat(64);
        const rootHash = crypto.createHmac('sha256', Buffer.from(key, 'hex')).update('mcp-sentinel-audit-v1').digest('hex');
        
        const entry1 = createValidEntry(key, 1, rootHash, 'test1');
        fs.writeFileSync(path.join(logDir, 'audit-1.log'), JSON.stringify(entry1) + '\n');
        
        fs.writeFileSync(checkpointFile, JSON.stringify({ seqNo: 2, hash: 'wrong' }));
        
        await assert.rejects(
            () => import(`${SCRIPT_PATH}?t=${Date.now()}`),
            /Audit checkpoint does not match the verified log tail/
        );
    });
});
