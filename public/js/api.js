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

      if (res.status === 401 || res.status === 403) {
        this.clearToken();
        window.location.hash = '#/login';
        throw new Error('Session expired. Please log in again.');
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
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

window.API = API;
