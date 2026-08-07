import "../test-env.js";
import test, { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';

const fsMkdir = mock.fn();
const fsReadFile = mock.fn();
const fsWriteFile = mock.fn();

mock.module('fs/promises', {
  namedExports: {
    mkdir: fsMkdir,
    readFile: fsReadFile,
    writeFile: fsWriteFile,
  },
});

const forgeCreatePrivateKey = mock.fn();
const forgeReadCertificateInfo = mock.fn();
const forgeCreateCsr = mock.fn();
const acmeAuto = mock.fn();

mock.module('acme-client', {
  defaultExport: {
    Client: class Client {
      constructor(opts) {
        this.opts = opts;
        this.auto = acmeAuto;
      }
    },
    forge: {
      createPrivateKey: forgeCreatePrivateKey,
      readCertificateInfo: forgeReadCertificateInfo,
      createCsr: forgeCreateCsr,
    },
    directory: {
      letsencrypt: {
        production: 'test-url',
      },
    },
  },
});

const { AcmeManager } = await import("../../lib/acme.js");

describe('AcmeManager', () => {
  beforeEach(() => {
    fsMkdir.mock.resetCalls();
    fsReadFile.mock.resetCalls();
    fsWriteFile.mock.resetCalls();
    forgeCreatePrivateKey.mock.resetCalls();
    forgeReadCertificateInfo.mock.resetCalls();
    forgeCreateCsr.mock.resetCalls();
    acmeAuto.mock.resetCalls();
  });

  it('constructor initializes correctly', () => {
    const manager = new AcmeManager('example.com', 'admin@example.com');
    assert.equal(manager.domain, 'example.com');
    assert.equal(manager.email, 'admin@example.com');
    assert.ok(manager.acmeDir.endsWith(path.join('certs', 'acme')));
    assert.equal(manager.challenges.size, 0);
  });

  it('init reads account.key if exists', async () => {
    fsMkdir.mock.mockImplementation(async () => {});
    fsReadFile.mock.mockImplementation(async () => 'existing-key');

    const manager = new AcmeManager('example.com', 'admin@example.com');
    await manager.init();

    assert.equal(fsReadFile.mock.calls.length, 1);
    assert.equal(fsWriteFile.mock.calls.length, 0);
    assert.equal(manager.client.opts.accountKey, 'existing-key');
  });

  it('init creates account.key if does not exist', async () => {
    fsMkdir.mock.mockImplementation(async () => {});
    fsReadFile.mock.mockImplementation(async () => {
      throw new Error('ENOENT');
    });
    forgeCreatePrivateKey.mock.mockImplementation(async () => 'new-key');
    fsWriteFile.mock.mockImplementation(async () => {});

    const manager = new AcmeManager('example.com', 'admin@example.com');
    await manager.init();

    assert.equal(fsReadFile.mock.calls.length, 1);
    assert.equal(forgeCreatePrivateKey.mock.calls.length, 1);
    assert.equal(fsWriteFile.mock.calls.length, 1);
    assert.equal(fsWriteFile.mock.calls[0].arguments[1], 'new-key');
    assert.equal(manager.client.opts.accountKey, 'new-key');
  });

  it('checkAndRenew returns cert if valid for > 30 days', async () => {
    const manager = new AcmeManager('example.com', 'admin@example.com');
    fsReadFile.mock.mockImplementation(async filePath => {
      if (filePath.endsWith('server.crt')) return 'cert-data';
      if (filePath.endsWith('server.key')) return 'key-data';
      return null;
    });
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 40);

    forgeReadCertificateInfo.mock.mockImplementation(async () => {
      return { notAfter: futureDate };
    });

    const result = await manager.checkAndRenew();
    assert.deepEqual(result, { cert: 'cert-data', key: 'key-data' });
  });

  it('checkAndRenew provisions if cert valid for <= 30 days', async () => {
    const manager = new AcmeManager('example.com', 'admin@example.com');
    await manager.init();

    fsReadFile.mock.mockImplementation(async filePath => {
      if (filePath.endsWith('account.key')) return 'account-key';
      if (filePath.endsWith('server.crt')) return 'cert-data';
      if (filePath.endsWith('server.key')) return 'key-data';
      return null;
    });
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 20);

    forgeReadCertificateInfo.mock.mockImplementation(async () => {
      return { notAfter: futureDate };
    });

    forgeCreateCsr.mock.mockImplementation(async () => ['cert-key', 'cert-csr']);
    acmeAuto.mock.mockImplementation(async () => 'new-cert');
    fsWriteFile.mock.mockImplementation(async () => {});

    const result = await manager.checkAndRenew();
    assert.deepEqual(result, { cert: 'new-cert', key: 'cert-key' });
  });

  it('checkAndRenew provisions if no valid cert found', async () => {
    const manager = new AcmeManager('example.com', 'admin@example.com');
    await manager.init();

    fsReadFile.mock.mockImplementation(async filePath => {
      if (filePath.endsWith('account.key')) return 'account-key';
      throw new Error('ENOENT');
    });
    forgeCreateCsr.mock.mockImplementation(async () => ['cert-key', 'cert-csr']);
    acmeAuto.mock.mockImplementation(async opts => {
      // test challengeCreateFn and challengeRemoveFn
      await opts.challengeCreateFn({ identifier: { value: 'test' } }, { type: 'http-01', token: 'token1' }, 'keyAuth');
      assert.equal(manager.challenges.get('token1'), 'keyAuth');
      assert.equal(manager.getChallengeResponse('token1'), 'keyAuth');

      // non-http-01 should be ignored
      await opts.challengeCreateFn({ identifier: { value: 'test' } }, { type: 'dns-01', token: 'token2' }, 'keyAuth2');
      assert.equal(manager.challenges.has('token2'), false);

      await opts.challengeRemoveFn({ identifier: { value: 'test' } }, { type: 'http-01', token: 'token1' }, 'keyAuth');
      assert.equal(manager.challenges.has('token1'), false);

      // non-http-01 should be ignored
      await opts.challengeRemoveFn({ identifier: { value: 'test' } }, { type: 'dns-01', token: 'token2' }, 'keyAuth2');

      return 'new-cert';
    });
    fsWriteFile.mock.mockImplementation(async () => {});

    const result = await manager.checkAndRenew();
    assert.deepEqual(result, { cert: 'new-cert', key: 'cert-key' });
  });
});
