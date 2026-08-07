import '../test-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as deployment from '../../lib/deployment.js';

test('deployment utilities', async t => {
  await t.test('parseEnvironment', async (t) => {
    await t.test('parses valid environment correctly', () => {
      const input = `
# Comment line
FOO=bar
  BAR= baz 
EMPTY=
WITH_NUM_1=val
      `;
      const result = deployment.parseEnvironment(input);
      assert.deepEqual(result, { FOO: 'bar', BAR: 'baz', EMPTY: '', WITH_NUM_1: 'val' });
    });

    await t.test('throws on missing separator', () => {
      assert.throws(() => deployment.parseEnvironment('INVALID_LINE'), { message: 'Invalid environment entry on line 1' });
    });

    await t.test('throws on invalid key', () => {
      assert.throws(() => deployment.parseEnvironment('1INVALID=value'), { message: 'Invalid environment key on line 1' });
      assert.throws(() => deployment.parseEnvironment('lower=value'), { message: 'Invalid environment key on line 1' });
      assert.throws(() => deployment.parseEnvironment('_INVALID=value'), { message: 'Invalid environment key on line 1' });
      assert.throws(() => deployment.parseEnvironment('A-B=value'), { message: 'Invalid environment key on line 1' });
    });

    await t.test('throws on duplicate key', () => {
      assert.throws(() => deployment.parseEnvironment('FOO=bar\nFOO=baz'), {
        message: "Duplicate environment key 'FOO'",
      });
    });
  });

  await t.test('validateProjectWritePaths', async (t) => {
    await t.test('returns normalized paths', () => {
      const result = deployment.validateProjectWritePaths('/app/project1, /app/project2, /app/project1');
      assert.deepEqual(result, ['/app/project1', '/app/project2']);
    });

    await t.test('throws if empty', () => {
      assert.throws(() => deployment.validateProjectWritePaths(''), { message: 'BROKER_GIT_ALLOWED_REPOS must contain at least one project repository' });
      assert.throws(() => deployment.validateProjectWritePaths(null), { message: 'BROKER_GIT_ALLOWED_REPOS must contain at least one project repository' });
      assert.throws(() => deployment.validateProjectWritePaths(' ,  , '), { message: 'BROKER_GIT_ALLOWED_REPOS must contain at least one project repository' });
    });

    await t.test('throws on non-absolute or not normalized paths or invalid chars', () => {
      assert.throws(() => deployment.validateProjectWritePaths('relative/path'), /must be a normalized absolute path/);
      assert.throws(() => deployment.validateProjectWritePaths('/app/../path'), /must be a normalized absolute path/);
      assert.throws(() => deployment.validateProjectWritePaths('/app/ path'), /must be a normalized absolute path/);
      assert.throws(() => deployment.validateProjectWritePaths('/app/path\n2'), /must be a normalized absolute path/);
      assert.throws(() => deployment.validateProjectWritePaths('/app/path\0'), /must be a normalized absolute path/);
      assert.throws(() => deployment.validateProjectWritePaths('/app/path"'), /must be a normalized absolute path/);
      assert.throws(() => deployment.validateProjectWritePaths("/app/path'"), /must be a normalized absolute path/);
      assert.throws(() => deployment.validateProjectWritePaths('/app/path\\'), /must be a normalized absolute path/);
    });

    await t.test('throws on broad paths', () => {
      assert.throws(() => deployment.validateProjectWritePaths('/'), /is too broad/);
      assert.throws(() => deployment.validateProjectWritePaths('/etc'), /is too broad/);
      assert.throws(() => deployment.validateProjectWritePaths('/usr'), /is too broad/);
      assert.throws(() => deployment.validateProjectWritePaths('/var'), /is too broad/);
      assert.throws(() => deployment.validateProjectWritePaths('/var/www'), /is too broad/);
      assert.throws(() => deployment.validateProjectWritePaths('/srv'), /is too broad/);
      assert.throws(() => deployment.validateProjectWritePaths('/opt'), /is too broad/);
      assert.throws(() => deployment.validateProjectWritePaths('/root'), /is too broad/);
      assert.throws(() => deployment.validateProjectWritePaths('/home'), /is too broad/);
    });
  });

  await t.test('validateReleaseManifest', async t => {
    const validManifest = {
      artifact: 'app.tar.gz',
      commit: 'a'.repeat(40),
      sha256: 'b'.repeat(64),
      version: '1.2.3',
    };

    await t.test('returns expected string for valid manifest', () => {
      const result = deployment.validateReleaseManifest(validManifest, 'app.tar.gz', 'b'.repeat(64));
      assert.equal(result, `1.2.3-${'a'.repeat(12)}`);
    });

    await t.test('throws on invalid manifest types', () => {
      assert.throws(
        () => deployment.validateReleaseManifest(null, 'app.tar.gz', 'b'.repeat(64)),
        /Invalid release manifest/
      );
      assert.throws(
        () => deployment.validateReleaseManifest([], 'app.tar.gz', 'b'.repeat(64)),
        /Invalid release manifest/
      );
      assert.throws(
        () => deployment.validateReleaseManifest('string', 'app.tar.gz', 'b'.repeat(64)),
        /Invalid release manifest/
      );
    });

    await t.test('throws on unknown fields', () => {
      assert.throws(
        () => deployment.validateReleaseManifest({ ...validManifest, extra: 1 }, 'app.tar.gz', 'b'.repeat(64)),
        /Release manifest contains unknown fields/
      );
      assert.throws(
        () => deployment.validateReleaseManifest({ artifact: 'app.tar.gz' }, 'app.tar.gz', 'b'.repeat(64)),
        /Release manifest contains unknown fields/
      );
    });

    await t.test('throws on invalid version', () => {
      assert.throws(
        () => deployment.validateReleaseManifest({ ...validManifest, version: '1.2' }, 'app.tar.gz', 'b'.repeat(64)),
        /Invalid release version/
      );
    });

    await t.test('throws on invalid commit', () => {
      assert.throws(
        () => deployment.validateReleaseManifest({ ...validManifest, commit: 'short' }, 'app.tar.gz', 'b'.repeat(64)),
        /Invalid release commit/
      );
    });

    await t.test('throws on invalid sha256 or hash mismatch', () => {
      assert.throws(
        () => deployment.validateReleaseManifest({ ...validManifest, sha256: 'short' }, 'app.tar.gz', 'b'.repeat(64)),
        /Release artifact hash does not match/
      );
      assert.throws(
        () => deployment.validateReleaseManifest(validManifest, 'app.tar.gz', 'c'.repeat(64)),
        /Release artifact hash does not match/
      );
    });

    await t.test('throws on artifact name mismatch', () => {
      assert.throws(
        () => deployment.validateReleaseManifest(validManifest, 'other.tar.gz', 'b'.repeat(64)),
        /Release artifact name does not match/
      );
    });
  });

  await t.test('validateSigningFingerprint', async t => {
    await t.test('validates valid fingerprint', () => {
      const expected = 'A'.repeat(40);
      const result = deployment.validateSigningFingerprint('a'.repeat(40), expected);
      assert.equal(result, expected);

      const expected64 = 'A'.repeat(64);
      const result64 = deployment.validateSigningFingerprint('a'.repeat(64), expected64);
      assert.equal(result64, expected64);
    });

    await t.test('throws if expected is invalid format', () => {
      assert.throws(
        () => deployment.validateSigningFingerprint('A'.repeat(40), 'invalid'),
        /Trusted release signing fingerprint must contain 40 or 64 hexadecimal characters/
      );
      assert.throws(
        () => deployment.validateSigningFingerprint('A'.repeat(40), 'A'.repeat(41)),
        /Trusted release signing fingerprint must contain 40 or 64 hexadecimal characters/
      );
    });

    await t.test('throws on untrusted key', () => {
      assert.throws(
        () => deployment.validateSigningFingerprint('B'.repeat(40), 'A'.repeat(40)),
        /Release signature was made by an untrusted key/
      );
    });
  });

  await t.test('parseValidSignatureFingerprint', async t => {
    await t.test('parses signing fingerprint without primary', () => {
      const output = `[GNUPG:] VALIDSIG ${'A'.repeat(40)} 2020-01-01`;
      const result = deployment.parseValidSignatureFingerprint(output);
      assert.equal(result, 'A'.repeat(40));
    });

    await t.test('parses primary fingerprint if valid', () => {
      const output = `[GNUPG:] VALIDSIG ${'A'.repeat(40)} 2020-01-01 ${'B'.repeat(40)}`;
      const result = deployment.parseValidSignatureFingerprint(output);
      assert.equal(result, 'B'.repeat(40));
    });

    await t.test('throws on missing valid signature', () => {
      assert.throws(
        () => deployment.parseValidSignatureFingerprint(''),
        /No valid release signature status was returned/
      );
    });

    await t.test('throws on invalid signing fingerprint', () => {
      assert.throws(
        () => deployment.parseValidSignatureFingerprint('[GNUPG:] VALIDSIG INVALID'),
        /Release signature status contains an invalid signing fingerprint/
      );
    });
  });

  await t.test('validateArchiveEntries', async t => {
    await t.test('validates correct entries', () => {
      const result = deployment.validateArchiveEntries(['mcp-sentinel-1.0.0/file.txt'], '1.0.0');
      assert.equal(result, 'mcp-sentinel-1.0.0/');
    });

    await t.test('throws if empty', () => {
      assert.throws(() => deployment.validateArchiveEntries([], '1.0.0'), /Release archive is empty/);
    });

    await t.test('throws if too many entries', () => {
      const entries = Array(deployment.MAX_RELEASE_ENTRIES + 1).fill('mcp-sentinel-1.0.0/file');
      assert.throws(
        () => deployment.validateArchiveEntries(entries, '1.0.0'),
        /Release archive contains too many entries/
      );
    });

    await t.test('throws on unsafe entry', () => {
      assert.throws(
        () => deployment.validateArchiveEntries(['other-prefix/file'], '1.0.0'),
        /Unsafe release archive entry/
      );
      assert.throws(
        () => deployment.validateArchiveEntries(['/mcp-sentinel-1.0.0/file'], '1.0.0'),
        /Unsafe release archive entry/
      );
      assert.throws(
        () => deployment.validateArchiveEntries(['mcp-sentinel-1.0.0/\0'], '1.0.0'),
        /Unsafe release archive entry/
      );
    });

    await t.test('throws on path traversal', () => {
      assert.throws(
        () => deployment.validateArchiveEntries(['mcp-sentinel-1.0.0/../file'], '1.0.0'),
        /Release archive entry escapes its version root/
      );
    });
  });

  await t.test('validateArchiveListing', async t => {
    await t.test('validates correct listing', () => {
      const result = deployment.validateArchiveListing([
        '-rw-r--r-- user/group 100 2020-01-01 mcp-sentinel-1.0.0/file.txt',
        'drwxr-xr-x user/group 0 2020-01-01 mcp-sentinel-1.0.0/',
      ]);
      assert.deepEqual(result, { entries: 2, expandedBytes: 100 });
    });

    await t.test('throws if empty or not array', () => {
      assert.throws(() => deployment.validateArchiveListing([]), /Release archive listing is empty/);
      assert.throws(() => deployment.validateArchiveListing(null), /Release archive listing is empty/);
    });

    await t.test('throws if too many entries', () => {
      const entries = Array(deployment.MAX_RELEASE_ENTRIES + 1).fill('-rw-r--r-- user/group 100 2020-01-01 file');
      assert.throws(() => deployment.validateArchiveListing(entries), /Release archive contains too many entries/);
    });

    await t.test('throws on unsupported entry format', () => {
      assert.throws(
        () => deployment.validateArchiveListing(['invalid format']),
        /Release archive contains an unsupported entry or listing format/
      );
    });

    await t.test('throws on invalid file size', () => {
      assert.throws(
        () => deployment.validateArchiveListing(['-rw-r--r-- user/group -100 2020-01-01 file']),
        /Release archive contains an unsupported entry/
      );
      assert.throws(
        () => deployment.validateArchiveListing(['-rw-r--r-- user/group 9007199254740992 2020-01-01 file']),
        /Release archive contains an invalid file size/
      );
    });

    await t.test('throws on expanded bytes limit', () => {
      const entries = Array(2).fill(
        `-rw-r--r-- user/group ${Math.floor(deployment.MAX_RELEASE_EXPANDED_BYTES / 1.5)} 2020-01-01 file`
      );
      assert.throws(
        () => deployment.validateArchiveListing(entries),
        /Release archive expands beyond the permitted size/
      );
    });
  });
});
