// ============================================================
//  toast.js - Toast notification system
// ============================================================

const Toast = {
  container: null,

  init() {
    if (this.container) return;
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    document.body.appendChild(this.container);
  },

  show(message, type = 'info', duration = 4000) {
    this.init();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
      success: '\u2705',
      error: '\u274c',
      info: '\u2139\ufe0f',
      warning: '\u26a0\ufe0f',
    };

    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-message"></span>
      <button class="toast-close" aria-label="Close">\u00d7</button>
    `;
    toast.querySelector('.toast-message').textContent = message;
    toast.querySelector('.toast-close').addEventListener('click', () => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    });

    this.container.appendChild(toast);

    if (duration > 0) {
      setTimeout(() => {
        if (toast.parentNode) {
          toast.classList.add('toast-exit');
          setTimeout(() => toast.remove(), 300);
        }
      }, duration);
    }
  },

  success(msg) {
    this.show(msg, 'success');
  },
  error(msg) {
    this.show(msg, 'error', 6000);
  },
  info(msg) {
    this.show(msg, 'info');
  },
  warning(msg) {
    this.show(msg, 'warning', 5000);
  },
};

export { Toast };
