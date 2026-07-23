import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEnvironment,
  parseValidSignatureFingerprint,
  validateArchiveEntries,
  validateArchiveListing,
  validateReleaseManifest,
  validateSigningFingerprint,
} from '../lib/deployment.js';

describe('production deployment preflight', () => {
  it('parses a secret-free systemd environment file', () => {
    assert.deepEqual(
      parseEnvironment('NODE_ENV=production\n# comment\nHOST=127.0.0.1\nALLOWED_ORIGINS=https://mcp.example.test\n'),
      {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        ALLOWED_ORIGINS: 'https://mcp.example.test',
      }
    );
  });

  it('rejects malformed and duplicate environment entries', () => {
    assert.throws(() => parseEnvironment('not-valid\n'), /Invalid environment entry/);
    assert.throws(() => parseEnvironment('lowercase=value\n'), /Invalid environment key/);
    assert.throws(() => parseEnvironment('HOST=one\nHOST=two\n'), /Duplicate environment key/);
  });

  it('validates signed release metadata and archive boundaries', () => {
    const hash = 'a'.repeat(64);
    const commit = 'b'.repeat(40);
    assert.equal(
      validateReleaseManifest(
        { version: '2.0.0', commit, artifact: 'mcp-sentinel-2.0.0.tar.gz', sha256: hash },
        'mcp-sentinel-2.0.0.tar.gz',
        hash
      ),
      `2.0.0-${commit.slice(0, 12)}`
    );
    assert.equal(
      validateArchiveEntries(['mcp-sentinel-2.0.0/', 'mcp-sentinel-2.0.0/server.js'], '2.0.0'),
      'mcp-sentinel-2.0.0/'
    );
    assert.throws(() => validateArchiveEntries(['mcp-sentinel-2.0.0/../../etc/shadow'], '2.0.0'), /escapes/);
    assert.deepEqual(
      validateArchiveListing([
        'drwxrwxr-x 0/0               0 2026-07-23 00:00 mcp-sentinel-2.0.0/',
        '-rw-rw-r-- 0/0             128 2026-07-23 00:00 mcp-sentinel-2.0.0/server.js',
      ]),
      { entries: 2, expandedBytes: 128 }
    );
    assert.throws(() => validateArchiveListing(['lrwxrwxrwx 0/0 0 2026-07-23 00:00 unsafe']), /unsupported/);
    assert.throws(
      () =>
        validateReleaseManifest(
          { version: '2.0.0', commit, artifact: 'wrong.tar.gz', sha256: hash },
          'mcp-sentinel-2.0.0.tar.gz',
          hash
        ),
      /name/
    );
  });

  it('accepts only the explicitly trusted signing fingerprint', () => {
    const fingerprint = 'AB'.repeat(20);
    assert.equal(validateSigningFingerprint(fingerprint.toLowerCase(), fingerprint), fingerprint);
    assert.throws(() => validateSigningFingerprint('CD'.repeat(20), fingerprint), /untrusted/);
    assert.throws(() => validateSigningFingerprint(fingerprint, 'not-a-fingerprint'), /40 or 64/);
    const signingSubkey = 'CD'.repeat(20);
    assert.equal(
      parseValidSignatureFingerprint(`[GNUPG:] VALIDSIG ${signingSubkey} 2026-07-23 0 4 0 1 10 00 ${fingerprint}`),
      fingerprint
    );
    assert.equal(parseValidSignatureFingerprint(`[GNUPG:] VALIDSIG ${fingerprint} 2026-07-23`), fingerprint);
    assert.throws(() => parseValidSignatureFingerprint('[GNUPG:] BADSIG'), /No valid/);
  });
});
