import fs from 'fs';
import path from 'path';

const MAX_CREDENTIAL_BYTES = 64 * 1024;

export function loadCredentialSecret(environmentName, credentialName) {
  const fromEnvironment = process.env[environmentName];
  if (typeof fromEnvironment === 'string' && fromEnvironment.length) return fromEnvironment;

  const directory = process.env.CREDENTIALS_DIRECTORY;
  if (!directory) return '';
  const credentialPath = path.join(directory, credentialName);
  const descriptor = fs.openSync(credentialPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_CREDENTIAL_BYTES)
      throw new Error(`Credential '${credentialName}' must be a bounded regular file`);
    return fs.readFileSync(descriptor, 'utf8').trimEnd();
  } finally {
    fs.closeSync(descriptor);
  }
}
