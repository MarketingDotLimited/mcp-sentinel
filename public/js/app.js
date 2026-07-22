// ============================================================
//  app.js - Application initialization & login page
// ============================================================

// Login page renderer
const LoginPage = {
  render(container) {
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'login-container';

    const card = document.createElement('div');
    card.className = 'login-card';

    // Brand
    const brand = document.createElement('div');
    brand.className = 'login-brand';
    brand.innerHTML = `
      <svg width="56" height="56" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="8" fill="url(#loginGrad)"/>
        <path d="M16 6L26 12V20L16 26L6 20V12L16 6Z" stroke="white" stroke-width="1.5" fill="none"/>
        <circle cx="16" cy="16" r="4" fill="white" opacity="0.9"/>
        <defs>
          <linearGradient id="loginGrad" x1="0" y1="0" x2="32" y2="32">
            <stop stop-color="#6366f1"/>
            <stop offset="1" stop-color="#06b6d4"/>
          </linearGradient>
        </defs>
      </svg>
    `;

    const title = document.createElement('h1');
    title.className = 'login-title';
    title.textContent = 'MCP Sentinel';

    const subtitle = document.createElement('p');
    subtitle.className = 'login-subtitle';
    subtitle.textContent = 'Secure Server Administration';

    // Form
    const form = document.createElement('form');
    form.className = 'login-form';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('.btn-primary');
      const input = form.querySelector('.input-field');
      const key = input.value.trim();
      if (!key) {
        Toast.error('Please enter your API key.');
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Authenticating...';
      try {
        await Auth.login(key);
        Toast.success('Welcome back, Administrator.');
        window.location.hash = '#/dashboard';
      } catch (err) {
        Toast.error(err.message);
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    });

    const inputGroup = document.createElement('div');
    inputGroup.className = 'input-group';

    const label = document.createElement('label');
    label.className = 'input-label';
    label.textContent = 'Admin API Key';

    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'input-field';
    input.placeholder = 'Enter your API key...';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.required = true;

    inputGroup.appendChild(label);
    inputGroup.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'submit';
    btn.className = 'btn btn-primary btn-full';
    btn.textContent = 'Sign In';

    form.appendChild(inputGroup);
    form.appendChild(btn);

    const footer = document.createElement('p');
    footer.className = 'login-footer';
    footer.textContent = 'Your API key is never stored. A short-lived JWT is used for the session.';

    card.appendChild(brand);
    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(form);
    card.appendChild(footer);
    wrapper.appendChild(card);
    container.appendChild(wrapper);

    // Focus input
    setTimeout(() => input.focus(), 100);
  },
  destroy() {},
};

// ── Initialize Application ──────────────────────────────────

(function initApp() {
  // Init auth module
  Auth.init();

  // Register routes
  Router.register('/login', LoginPage);
  Router.register('/dashboard', window.DashboardPage);
  Router.register('/workflows', window.WorkflowsPage);
  Router.register('/approvals', window.ApprovalsPage);
  Router.register('/projects', window.ProjectsPage);
  Router.register('/automations', window.AutomationsPage);
  Router.register('/operations', window.OperationsPage);
  Router.register('/connect', window.ConnectPage);
  Router.register('/teams', window.TeamsPage);
  Router.register('/security', window.SecurityPage);
  Router.register('/logs', window.LogsPage);
  Router.register('/sessions', window.SessionsPage);
  Router.register('/keys', window.KeysPage);
  Router.register('/oauth', window.OAuthPage);
  Router.register('/rollbacks', window.RollbacksPage);

  // Logout button
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      Auth.logout();
      Toast.info('Logged out successfully.');
    });
  }

  // Mobile toggle
  const mobileToggle = document.getElementById('mobile-toggle');
  const sidebar = document.getElementById('sidebar');
  if (mobileToggle && sidebar) {
    mobileToggle.addEventListener('click', () => {
      sidebar.classList.toggle('sidebar-open');
    });
    // Close sidebar when a nav link is clicked on mobile
    sidebar.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
          sidebar.classList.remove('sidebar-open');
        }
      });
    });
  }

  // Initialize router
  Router.init();
})();
