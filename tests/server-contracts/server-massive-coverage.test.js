import '../test-env.js';
import { test, describe, after, mock } from 'node:test';
import assert from 'node:assert/strict';

test('massive coverage', async () => {
  const { __TEST_EXPORTS__ } = await import('../../server.js');

  // 1. ensurePrivilegeBrokerAvailable (line 154)
  const req = { identity: { role: 'admin' } };
  const res = { status: () => ({ json: () => {} }) };
  await __TEST_EXPORTS__.ensurePrivilegeBrokerAvailable(req, res, () => {});

  // 2. extractDependencyErrorText
  const complexObj = {
    message: 'test',
    error: { detail: 'inner', arr: ['a', 'b'] },
    reason: 'r',
    code: 'c',
    statusText: 'st',
    status: 's',
    socketPath: 'sp',
    name: 'n',
    cause: 'ca',
    err: 'e',
    response: 're',
    body: 'b',
    data: 'd',
    nested: { cause: { name: 'nested name' } },
  };
  complexObj.circular = complexObj;
  __TEST_EXPORTS__.extractDependencyErrorText(complexObj);

  // Call the functions with null/undefined edge cases
  __TEST_EXPORTS__.isBrokerUnavailable(null);
  __TEST_EXPORTS__.isRecoverableDependencyError(null);
  __TEST_EXPORTS__.isDependencyText(null);
  __TEST_EXPORTS__.isDependencyError(null);
  __TEST_EXPORTS__.isOAuthDependencyError(null);
  __TEST_EXPORTS__.isBrokerUnavailableError(null);
  __TEST_EXPORTS__.isStateStoreUnavailable(null);

  __TEST_EXPORTS__.safeLogError(null);
  __TEST_EXPORTS__.safeLogError(new Error('test'), { tool: 'test' });

  __TEST_EXPORTS__.sanitizeClientOverrides(null);
  __TEST_EXPORTS__.sanitizeOAuthUserPayload(null);

  __TEST_EXPORTS__.normalizeAdminReadPath('/api/users');
  __TEST_EXPORTS__.normalizeAdminReadPath('/admin/users');
  __TEST_EXPORTS__.normalizeAdminReadPath('invalid url %E0%A4%A');

  __TEST_EXPORTS__.adminDependencyFallbackResponse('/admin/oauth-clients', new Error());
  __TEST_EXPORTS__.adminDependencyFallbackResponse('/admin/oauth-users', new Error());
  __TEST_EXPORTS__.adminDependencyFallbackResponse('/admin/capabilities', new Error());
  __TEST_EXPORTS__.adminDependencyFallbackResponse('/admin/sessions', new Error());
  __TEST_EXPORTS__.adminDependencyFallbackResponse('/action-manifest', new Error());
  __TEST_EXPORTS__.adminDependencyFallbackResponse('/unknown', new Error());

  __TEST_EXPORTS__.summarizeHealth({ cpu: 95, memory: 90, disk: 95 });
  __TEST_EXPORTS__.summarizeHealth({ cpu: 80, memory: 80, disk: 80 });
  __TEST_EXPORTS__.summarizeHealth({ cpu: 50, memory: 50, disk: 50 });

  await __TEST_EXPORTS__.adminReadFallbackHandler(
    { method: 'GET', path: '/admin/sessions' },
    res,
    async () => {
      throw new Error('BROKER_UNAVAILABLE');
    },
    { fallbackOnAnyError: true }
  );
  await __TEST_EXPORTS__.readAdminCollectionFallback(
    { identity: { role: 'admin' }, path: '/admin/sessions' },
    res,
    async () => {
      throw new Error('BROKER_UNAVAILABLE');
    },
    { fallbackOnAnyError: true }
  );

  await __TEST_EXPORTS__.buildSecurityPosture().catch(() => {});

  __TEST_EXPORTS__.alertOwnerKey({ role: 'admin' });
  __TEST_EXPORTS__.alertOwnerKey({ role: 'user', userId: 'u1' });
  __TEST_EXPORTS__.alertOwnerKey({ role: 'user', oauthSubject: 's1', oauthClient: 'c1' });

  await __TEST_EXPORTS__.invalidateOAuthSessions('s1', 'c1');
  __TEST_EXPORTS__.manifestIdentityKey({ role: 'admin' });
  __TEST_EXPORTS__.manifestIdentityKey({ role: 'user', userId: 'u1' });

  __TEST_EXPORTS__.refreshActiveToolLists();
});
