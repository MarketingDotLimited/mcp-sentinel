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

    try {
      const res = await fetch(url, { ...options, headers });

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
        const error = new Error(`${data.error || `Request failed (${res.status})`}${data?.code ? ` (${data.code})` : ''}`);
        error.status = res.status;
        error.code = data?.code || null;
        if (data?.resolution) error.resolution = data.resolution;
        if (data?.detail) error.detail = data.detail;
        throw error;
      }
      return data;
    } catch (e) {
      if (e.message === 'Failed to fetch') {
        throw new Error('Server unreachable. Check your connection.');
      }
      throw e;
    }
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
