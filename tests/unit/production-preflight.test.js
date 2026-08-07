import '../test-env.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEnvironment,
  parseValidSignatureFingerprint,
  validateArchiveEntries,
  validateArchiveListing,
  validateReleaseManifest,
  validateProjectWritePaths,
  validateSigningFingerprint,
} from '../../lib/deployment.js';

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

  it('renders only exact, normalized project write paths for the broker sandbox', () => {
    assert.deepEqual(validateProjectWritePaths('/srv/apps/one,/var/www/vhosts/example.test/httpdocs'), [
      '/srv/apps/one',
      '/var/www/vhosts/example.test/httpdocs',
    ]);
    for (const unsafe of ['/', '/var/www', '/srv', 'relative/path', '/srv/path with space', '/srv/apps/../escape'])
      assert.throws(() => validateProjectWritePaths(unsafe), /too broad|normalized absolute/);

    assert.throws(() => validateProjectWritePaths(), /must contain at least one project repository/);
    assert.throws(() => validateProjectWritePaths(''), /must contain at least one project repository/);
  });

  it('validates signed release metadata and archive boundaries', () => {
    const hash = 'a'.repeat(64);
    const commit = 'b'.repeat(40);

    // manifest validations
    assert.throws(() => validateReleaseManifest(null, 'art', 'hash'), /Invalid release manifest/);
    assert.throws(() => validateReleaseManifest([], 'art', 'hash'), /Invalid release manifest/);
    assert.throws(() => validateReleaseManifest('not obj', 'art', 'hash'), /Invalid release manifest/);
    assert.throws(() => validateReleaseManifest({ version: '1.0.0' }, 'art', 'hash'), /unknown fields/);
    assert.throws(
      () => validateReleaseManifest({ version: 'invalid', commit, sha256: hash, artifact: 'art' }, 'art', hash),
      /Invalid release version/
    );
    assert.throws(
      () =>
        validateReleaseManifest({ version: '2.0.0', commit: 'invalid', sha256: hash, artifact: 'art' }, 'art', hash),
      /Invalid release commit/
    );
    assert.throws(
      () => validateReleaseManifest({ version: '2.0.0', commit, sha256: 'invalid', artifact: 'art' }, 'art', hash),
      /Release artifact hash does not match/
    );
    assert.throws(
      () =>
        validateReleaseManifest({ version: '2.0.0', commit, sha256: hash, artifact: 'art' }, 'art', 'different-hash'),
      /Release artifact hash does not match/
    );

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

    assert.throws(() => validateArchiveListing(), /Release archive listing is empty/);
    assert.throws(() => validateArchiveListing([]), /Release archive listing is empty/);
    assert.throws(() => validateArchiveListing(new Array(20001)), /Release archive contains too many entries/);
    assert.throws(
      () => validateArchiveListing(['-rw-rw-r-- 0/0 9007199254740992 2026-07-23 00:00 file']),
      /Release archive contains an invalid file size/
    );
    assert.throws(
      () => validateArchiveListing(['-rw-rw-r-- 0/0 1073741825 2026-07-23 00:00 file']),
      /Release archive expands beyond the permitted size/
    );

    assert.throws(() => validateArchiveEntries([], '2.0.0'), /Release archive is empty/);
    assert.throws(() => validateArchiveEntries(new Array(20001), '2.0.0'), /Release archive contains too many entries/);
    assert.throws(() => validateArchiveEntries(['invalid'], '2.0.0'), /Unsafe release archive entry/);
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
    assert.throws(() => parseValidSignatureFingerprint(undefined), /No valid/);
    assert.throws(() => parseValidSignatureFingerprint('[GNUPG:] VALIDSIG X'), /invalid signing fingerprint/);
    assert.throws(() => parseValidSignatureFingerprint('[GNUPG:] VALIDSIG  '), /invalid signing fingerprint/);
    assert.throws(
      () => parseValidSignatureFingerprint(`[GNUPG:] VALIDSIG invalid-fingerprint`),
      /invalid signing fingerprint/
    );
    assert.throws(() => validateSigningFingerprint(undefined, fingerprint), /untrusted key/);
    assert.throws(() => validateSigningFingerprint(fingerprint, undefined), /40 or 64/);
  });
});
