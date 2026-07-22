import { API } from './api.js';
import { Toast } from './toast.js';
// ============================================================
//  auth.js - Login/logout, token management, auto-logout
// ============================================================

const Auth = {
  IDLE_TIMEOUT: 30 * 60 * 1000, // 30 minutes
  idleTimer: null,
  lastActivity: Date.now(),

  init() {
    // Reset idle timer on any interaction
    ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach(event => {
      document.addEventListener(event, () => this.resetIdleTimer(), { passive: true });
    });
    this.resetIdleTimer();
  },

  resetIdleTimer() {
    this.lastActivity = Date.now();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (API.isAuthenticated()) {
      this.idleTimer = setTimeout(() => {
        Toast.warning('Session expired due to inactivity.');
        API.logout();
      }, this.IDLE_TIMEOUT);
    }
  },

  async login(apiKey) {
    const data = await API.login(apiKey);
    this.resetIdleTimer();
    return data;
  },

  logout() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    API.logout();
  },

  isLoggedIn() {
    return API.isAuthenticated();
  },
};

export { Auth };
