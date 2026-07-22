// ============================================================
//  router.js - Hash-based SPA routing
// ============================================================

const Router = {
  routes: {},
  currentPage: null,
  mainContent: null,

  init() {
    this.mainContent = document.getElementById('main-content');
    window.addEventListener('hashchange', () => this.navigate());
    this.navigate();
  },

  register(path, handler) {
    this.routes[path] = handler;
  },

  navigate() {
    const hash = window.location.hash || '#/login';
    const path = hash.replace('#', '');

    // Auth guard
    if (path !== '/login' && !Auth.isLoggedIn()) {
      window.location.hash = '#/login';
      return;
    }
    if (path === '/login' && Auth.isLoggedIn()) {
      window.location.hash = '#/dashboard';
      return;
    }

    // Update sidebar active state
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.getAttribute('href') === hash);
    });

    // Show/hide sidebar based on login state
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.style.display = path === '/login' ? 'none' : '';
    }
    if (this.mainContent) {
      this.mainContent.className = path === '/login' ? 'main-content main-content-full' : 'main-content';
    }

    // Cleanup previous page
    if (this.currentPage && this.currentPage.destroy) {
      this.currentPage.destroy();
    }

    const handler = this.routes[path];
    if (handler) {
      this.currentPage = handler;
      if (this.mainContent) {
        this.mainContent.innerHTML = '';
        handler.render(this.mainContent);
      }
    } else {
      // Default: redirect to dashboard
      window.location.hash = '#/dashboard';
    }
  },
};

window.Router = Router;
