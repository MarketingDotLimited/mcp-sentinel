// ============================================================
//  api.js - Fetch wrapper with JWT auth and error handling
// ============================================================

const API = {
  getToken() {
    return sessionStorage.getItem('mcp_jwt');
  },

  setToken(token) {
    sessionStorage.setItem('mcp_jwt', token);
  },

  clearToken() {
    sessionStorage.removeItem('mcp_jwt');
  },

  isAuthenticated() {
    return !!this.getToken();
  },

  async request(url, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const requestPath = input => {
      if (typeof input !== 'string') return '';
      try {
        if (input.startsWith('http://') || input.startsWith('https://')) return new URL(input).pathname;
        return input;
      } catch {
        return input;
      }
    };

    const candidateUrls = [];
    if (typeof url === 'string' && url.startsWith('/admin/')) {
      const adminRelative = requestPath(url).replace(/^\/admin\//, '/');
      const adminWithoutTrailingSlash = adminRelative.endsWith('/') ? adminRelative.slice(0, -1) : adminRelative;

      candidateUrls.push(url);
      candidateUrls.push(`/admin/api${adminWithoutTrailingSlash}`);
      candidateUrls.push(`/admin/api${adminRelative}`);
      candidateUrls.push(`/api/admin${adminWithoutTrailingSlash}`);
      candidateUrls.push(`/api/admin${adminRelative}`);
      candidateUrls.push(`/api${url}`);
      candidateUrls.push(adminRelative);
      candidateUrls.push(`/api${adminRelative}`);
    } else if (typeof url === 'string' && url.startsWith('/action-manifest')) {
      candidateUrls.push(url);
      candidateUrls.push('/action-manifest');
      candidateUrls.push('/admin/action-manifest');
      candidateUrls.push('/admin/action-manifest/');
      candidateUrls.push('/admin/api/action-manifest');
      candidateUrls.push('/admin/api/action-manifest/');
      candidateUrls.push('/api/admin/action-manifest');
      candidateUrls.push('/api/admin/action-manifest/');
      candidateUrls.push('/api/action-manifest');
    } else {
      candidateUrls.push(url);
    }

    const isBrokerUnavailable = error => {
      return (
        error?.code === 'BROKER_UNAVAILABLE' ||
        error?.code === 'E_BROKER_UNAVAILABLE' ||
        String(error?.message || '').includes('/run/mcp-sentinel/broker.sock') ||
        String(error?.message || '').includes('/var/run/mcp-sentinel/broker.sock') ||
        /Privilege broker unavailable|broker unavailable|socket unavailable|connect ENOENT|no such file or directory|Broker unavailable|E_BROKER_UNAVAILABLE/i.test(
          String(error?.message || '')
        )
      );
    };
    const isStateStoreUnavailable = error => {
      return (
        error?.code === 'STATE_STORE_UNAVAILABLE' ||
        /state\\.sqlite3|capabilities\\.json/i.test(String(error?.message || '')) ||
        /unable to open database file|database is locked|database disk image is malformed|permission denied|read-only file system|state store is unavailable/i.test(
          String(error?.message || '')
        )
      );
    };
    const isDependencyUnavailable = error =>
      isBrokerUnavailable(error) ||
      isStateStoreUnavailable(error) ||
      error.status === 404 ||
      error.status === 503 ||
      error.status === 502 ||
      error.status === 500;

    const getReadDependencyFallback = requestUrl => {
      const normalizedUrl = requestPath(String(requestUrl || ''))
        .split('?')[0]
        .replace(/\/+$/u, '');
      const adminUrl = normalizedUrl
        .replace(/^\/api\/admin\//, '/admin/')
        .replace(/^\/admin\/api\//, '/admin/')
        .replace(/^\/api\//, '/admin/')
        .replace(/^$/, '/');
      const isOAuthUsersOrClients = /\/oauth-(?:users|clients)(?:\/|$)/i.test(adminUrl);
      const isGenericDependencyEndpoint = /^(?:\/admin)?\/(oauth-(?:users|clients)|action-manifest|capabilities|sessions)(?:\/|$)/i.test(
        adminUrl
      );

      if (isOAuthUsersOrClients || isGenericDependencyEndpoint) return [];
      if (/(?:^|\/)admin\/capabilities$/.test(adminUrl)) return { capabilities: [], status: 'dependency-unavailable' };
      if (/(?:^|\/)admin\/sessions$/.test(adminUrl)) return { sessions: [], count: 0, status: 'dependency-unavailable' };
      if (/(?:^|\/)action-manifest$/.test(adminUrl) || /^\/action-manifest$/.test(adminUrl)) {
        return {
          manifest: {
            version: 'missing',
            hash: 'missing',
            name: 'MCP Sentinel',
            tools: [],
          },
          refreshChecklist: [],
          warnings: ['Privilege broker unavailable: continuing with a read-only local fallback.'],
        };
      }
      if (/^\/api\/oauth-users$/.test(adminUrl) || /^\/api\/oauth-clients$/.test(adminUrl)) return [];
      if (/^\/api\/capabilities$/.test(adminUrl)) return { capabilities: [], status: 'dependency-unavailable' };
      if (/^\/api\/sessions$/.test(adminUrl)) return { sessions: [], count: 0, status: 'dependency-unavailable' };
      if (/^\/api\/action-manifest$/.test(adminUrl)) {
        return {
          manifest: {
            version: 'missing',
            hash: 'missing',
            name: 'MCP Sentinel',
            tools: [],
          },
          refreshChecklist: [],
          warnings: ['Privilege broker unavailable: continuing with a read-only local fallback.'],
        };
      }
      return null;
    };

    const appearsDependencyLayerFailure = error => {
      return (
        isDependencyUnavailable(error) ||
        isBrokerUnavailable(error) ||
        isStateStoreUnavailable(error) ||
        String(error?.message || '').includes('/run/mcp-sentinel/broker.sock') ||
        String(error?.message || '').includes('/var/run/mcp-sentinel/broker.sock') ||
        /Privilege broker unavailable|broker unavailable|state store unavailable|state\.sqlite3/i.test(
          String(error?.message || '')
        ) ||
        /Privilege broker unavailable|broker unavailable|connect ENOENT|no such file or directory|state\.sqlite3/i.test(
          String(error?.message || '')
        ) ||
        /Internal Server Error/i.test(String(error?.message || '')) ||
        error.message === 'Failed to fetch'
      );
    };

    const normalizeDependencyError = error => {
      if (!error || typeof error !== 'object') return error;
      if (isBrokerUnavailable(error)) {
        return Object.assign(error, {
          status: 503,
          code: error.code || 'BROKER_UNAVAILABLE',
          resolution:
            error.resolution ||
            'Restart the privilege broker service (systemctl restart mcp-sentinel-broker.service) and verify /run/mcp-sentinel/broker.sock exists.',
        });
      }
      if (isStateStoreUnavailable(error)) {
        return Object.assign(error, {
          status: 503,
          code: error.code || 'STATE_STORE_UNAVAILABLE',
          resolution:
            error.resolution ||
            'Verify MCP state directory permissions and ownership, ensure the service can read/write /var/lib/mcp-sentinel, and restart the service.',
        });
      }
      return error;
    };

    let lastError;
    const uniqUrls = [...new Set(candidateUrls)];
    for (let i = 0; i < uniqUrls.length; i += 1) {
      const requestUrl = uniqUrls[i];
      try {
        const res = await fetch(requestUrl, { ...options, headers });

        let data = {};
        try {
          data = await res.json();
        } catch {
          data = { error: await res.text().catch(() => 'Unable to parse API response') };
        }

        if (res.status === 401 || res.status === 403) {
          this.clearToken();
          window.location.hash = '#/login';
          throw Object.assign(new Error('Session expired. Please log in again.'), {
            status: res.status,
            code: data?.code || null,
          });
        }

        if (!res.ok) {
          const error = new Error(
            `${data.error || `Request failed (${res.status})`}${data?.code ? ` (${data.code})` : ''}`
          );
          error.status = res.status;
          error.code = data?.code || null;
          if (data?.resolution) error.resolution = data.resolution;
          if (data?.detail) error.detail = data.detail;

          normalizeDependencyError(error);
          throw error;
        }
        return data;
      } catch (error) {
        normalizeDependencyError(error);
      const readFallback = getReadDependencyFallback(requestUrl);
      const normalizedRequest = requestPath(String(requestUrl || ''))
        .replace(/\/+$/, '')
        .replace(/^\/api\/admin\//, '/admin/')
        .replace(/^\/admin\/api\//, '/admin/')
        .replace(/^\/api\//, '/admin/');
      const isOAuthReadEndpoint =
        /(?:^|\/)admin\/oauth-users$/i.test(normalizedRequest) ||
        /^\/oauth-users$/i.test(normalizedRequest) ||
        /(?:^|\/)admin\/oauth-clients$/i.test(normalizedRequest) ||
        /^\/oauth-clients$/i.test(normalizedRequest) ||
        /(?:^|\/)admin\/action-manifest$/i.test(normalizedRequest) ||
        /^\/action-manifest$/i.test(normalizedRequest) ||
        /(?:^|\/)admin\/capabilities$/i.test(normalizedRequest) ||
        /^\/capabilities$/i.test(normalizedRequest) ||
        /(?:^|\/)admin\/sessions$/i.test(normalizedRequest) ||
        /^\/sessions$/i.test(normalizedRequest) ||
        /^\/api\/oauth-users$/i.test(normalizedRequest) ||
        /^\/api\/oauth-clients$/i.test(normalizedRequest) ||
        /^\/api\/action-manifest$/i.test(normalizedRequest) ||
        /^\/api\/capabilities$/i.test(normalizedRequest) ||
        /^\/api\/sessions$/i.test(normalizedRequest);

      if (readFallback !== null && (appearsDependencyLayerFailure(error) || error.status === 404 || isOAuthReadEndpoint)) {
        return readFallback;
      }

        const retryable =
          error.status === 404 ||
          error.status === 502 ||
          error.status === 503 ||
          error.message === 'Failed to fetch' ||
          isDependencyUnavailable(error);
        lastError = error;
        if (!retryable || i === uniqUrls.length - 1) {
          throw error;
        }
      }
    }
    if (lastError?.message === 'Failed to fetch') {
      throw new Error('Server unreachable. Check your connection.');
    }
    throw lastError;
  },

  async get(url) {
    return this.request(url);
  },

  async post(url, body) {
    return this.request(url, { method: 'POST', body: JSON.stringify(body) });
  },

  async put(url, body) {
    return this.request(url, { method: 'PUT', body: JSON.stringify(body) });
  },

  async del(url) {
    return this.request(url, { method: 'DELETE' });
  },

  async login(apiKey) {
    const res = await fetch('/auth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Authentication failed');
    }
    this.setToken(data.token);
    return data;
  },

  logout() {
    this.clearToken();
    window.location.hash = '#/login';
  },
};

export { API };
