import acme from 'acme-client';
import fs from 'fs/promises';
import path from 'path';

export class AcmeManager {
  constructor(domain, email) {
    this.domain = domain;
    this.email = email;
    this.acmeDir = path.join(process.cwd(), 'certs', 'acme');
    this.challenges = new Map();
  }

  async init() {
    await fs.mkdir(this.acmeDir, { recursive: true, mode: 0o700 });
    let accountKey;
    try {
      accountKey = await fs.readFile(path.join(this.acmeDir, 'account.key'));
    } catch {
      accountKey = await acme.forge.createPrivateKey();
      await fs.writeFile(path.join(this.acmeDir, 'account.key'), accountKey, { mode: 0o600 });
    }

    this.client = new acme.Client({
      directoryUrl: acme.directory.letsencrypt.production,
      accountKey: accountKey,
    });
  }

  async checkAndRenew() {
    const certPath = path.join(this.acmeDir, 'server.crt');
    const keyPath = path.join(this.acmeDir, 'server.key');

    try {
      const certInfo = await acme.forge.readCertificateInfo(await fs.readFile(certPath));
      const daysRemaining = (certInfo.notAfter.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysRemaining > 30) {
        console.log(`[ACME] Certificate valid for ${Math.round(daysRemaining)} days. No renewal needed.`);
        return { cert: await fs.readFile(certPath), key: await fs.readFile(keyPath) };
      }
    } catch {
      console.log('[ACME] No valid certificate found. Provisioning...');
    }

    // Need to provision/renew
    return this.provision();
  }

  async provision() {
    console.log(`[ACME] Ordering certificate for ${this.domain}...`);

    const [certKey, certCsr] = await acme.forge.createCsr({
      commonName: this.domain,
    });

    const cert = await this.client.auto({
      csr: certCsr,
      email: this.email,
      termsOfServiceAgreed: true,
      challengeCreateFn: async (authz, challenge, keyAuthorization) => {
        if (challenge.type === 'http-01') {
          console.log(`[ACME] Setting up http-01 challenge for ${authz.identifier.value}`);
          this.challenges.set(challenge.token, keyAuthorization);
        }
      },
      challengeRemoveFn: async (authz, challenge, keyAuthorization) => {
        if (challenge.type === 'http-01') {
          this.challenges.delete(challenge.token);
        }
      },
    });

    console.log(`[ACME] Certificate provisioned successfully!`);
    await fs.writeFile(path.join(this.acmeDir, 'server.crt'), cert, { mode: 0o600 });
    await fs.writeFile(path.join(this.acmeDir, 'server.key'), certKey, { mode: 0o600 });

    return { cert, key: certKey };
  }

  getChallengeResponse(token) {
    return this.challenges.get(token);
  }
}
