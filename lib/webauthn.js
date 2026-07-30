import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import crypto from 'crypto';
import { getAdminState, setAdminState } from './admin-state.js';

const challenges = new Map();
const MAX_CHALLENGE_MS = 5 * 60 * 1000;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromBase64url(value) {
  return new Uint8Array(Buffer.from(String(value), 'base64url'));
}

function configured() {
  const rpID = String(
    process.env.WEBAUTHN_RP_ID || new URL(process.env.PUBLIC_URL || 'https://localhost').hostname
  ).trim();
  const origin = String(process.env.WEBAUTHN_ORIGIN || process.env.PUBLIC_URL || '').replace(/\/$/, '');
  if (!/^[a-z0-9.-]+$/i.test(rpID) || !origin.startsWith('https://'))
    throw new Error('WebAuthn requires WEBAUTHN_RP_ID and an HTTPS WEBAUTHN_ORIGIN/PUBLIC_URL');
  return { rpID, origin };
}

function assertUser(userId) {
  if (typeof userId !== 'string' || !/^[A-Za-z0-9_.@:-]{1,128}$/.test(userId)) throw new Error('Invalid WebAuthn user');
  return userId;
}

function storedCredentials() {
  const value = getAdminState('webauthn.credentials');
  return Array.isArray(value) ? value : [];
}

function saveCredentials(credentials) {
  return setAdminState('webauthn.credentials', credentials.slice(-1000));
}

function storeChallenge(kind, userId, challenge) {
  const id = crypto.randomUUID();
  challenges.set(id, { kind, userId, challenge, expiresAt: Date.now() + MAX_CHALLENGE_MS });
  return id;
}

function consumeChallenge(id, kind, userId) {
  const entry = challenges.get(String(id));
  challenges.delete(String(id));
  if (!entry || entry.kind !== kind || entry.userId !== userId || entry.expiresAt < Date.now())
    throw new Error('WebAuthn challenge is missing, expired, or bound to another identity');
  return entry;
}

export async function registrationOptions({ userId, userName = userId } = {}) {
  const target = assertUser(userId);
  const { rpID } = configured();
  const credentials = storedCredentials().filter(item => item.userId === target);
  const options = await generateRegistrationOptions({
    rpName: process.env.WEBAUTHN_RP_NAME || 'MCP Sentinel',
    rpID,
    userID: new TextEncoder().encode(target),
    userName: String(userName).slice(0, 128),
    userDisplayName: String(userName).slice(0, 128),
    attestationType: 'none',
    excludeCredentials: credentials.map(item => ({ id: item.id, transports: item.transports })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  return { challengeId: storeChallenge('registration', target, options.challenge), options };
}

export async function finishRegistration({ userId, challengeId, response } = {}) {
  const target = assertUser(userId);
  const { rpID, origin } = configured();
  const challenge = consumeChallenge(challengeId, 'registration', target);
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!result.verified || !result.registrationInfo?.credential)
    throw new Error('WebAuthn registration was not verified');
  const credential = result.registrationInfo.credential;
  const credentials = storedCredentials().filter(item => item.id !== credential.id);
  credentials.push({
    userId: target,
    id: credential.id,
    publicKey: base64url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports || [],
    registeredAt: new Date().toISOString(),
  });
  saveCredentials(credentials);
  return { verified: true, credentialId: credential.id, userId: target };
}

export async function authenticationOptions({ userId } = {}) {
  const target = assertUser(userId);
  const { rpID } = configured();
  const credentials = storedCredentials().filter(item => item.userId === target);
  if (!credentials.length) throw new Error('No WebAuthn credential is registered for this identity');
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: credentials.map(item => ({ id: item.id, transports: item.transports })),
    userVerification: 'required',
  });
  return { challengeId: storeChallenge('authentication', target, options.challenge), options };
}

export async function finishAuthentication({ userId, challengeId, response } = {}) {
  const target = assertUser(userId);
  const { rpID, origin } = configured();
  const challenge = consumeChallenge(challengeId, 'authentication', target);
  const credentials = storedCredentials();
  const credentialId = response?.id || response?.rawId;
  const stored = credentials.find(item => item.userId === target && item.id === credentialId);
  if (!stored) throw new Error('WebAuthn credential is not registered for this identity');
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: stored.id,
      publicKey: fromBase64url(stored.publicKey),
      counter: stored.counter,
      transports: stored.transports,
    },
    requireUserVerification: true,
  });
  if (!result.verified) throw new Error('WebAuthn authentication was not verified');
  stored.counter = result.authenticationInfo.newCounter;
  stored.lastUsedAt = new Date().toISOString();
  saveCredentials(credentials);
  return { verified: true, userId: target, credentialId: stored.id, counter: stored.counter };
}

export function listCredentials(userId) {
  const target = assertUser(userId);
  return storedCredentials()
    .filter(item => item.userId === target)
    .map(({ id, userId: owner, transports, registeredAt, lastUsedAt }) => ({
      id,
      userId: owner,
      transports,
      registeredAt,
      lastUsedAt,
    }));
}

export function resetWebAuthnForTests() {
  challenges.clear();
}
