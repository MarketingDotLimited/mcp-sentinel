export function validateOAuthTokenPolicy({ payload, protectedHeader, issuer, resource, acceptedTypes }) {
  if (!payload || typeof payload !== 'object') throw new Error('OAuth token payload is missing');
  if (payload.iss !== issuer) throw new Error('OAuth token issuer does not match');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('OAuth access token is missing its subject');
  if (!Number.isSafeInteger(payload.exp) || payload.exp * 1000 <= Date.now())
    throw new Error('OAuth access token expiry is missing or invalid');
  if (!Number.isSafeInteger(payload.iat) || payload.iat * 1000 > Date.now() + 60_000)
    throw new Error('OAuth access token issue time is missing or invalid');
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud].filter(Boolean);
  if (audiences.length !== 1 || audiences[0] !== resource)
    throw new Error('OAuth token must use the exact canonical resource audience');
  const tokenType = String(protectedHeader?.typ || '').toLowerCase();
  const allowed = new Set(
    String(acceptedTypes || 'at+jwt,jwt')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
  );
  if (!tokenType || !allowed.has(tokenType)) throw new Error('Unsupported OAuth access token type');
  if (payload.nonce !== undefined) throw new Error('OIDC ID tokens cannot be used as access tokens');
  if (payload.token_use !== undefined && payload.token_use !== 'access')
    throw new Error('OAuth token_use must identify an access token');
  const clientId = payload.client_id || payload.azp;
  if (typeof clientId !== 'string' || !clientId)
    throw new Error('OAuth access token is missing its authorized client ID');
  return { clientId, tokenType, audiences };
}
