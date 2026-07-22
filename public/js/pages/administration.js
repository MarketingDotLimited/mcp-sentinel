import { API } from '../api.js';
import { Toast } from '../toast.js';
import { Router } from '../router.js';
(function () {
  let root;
  const links = [
    ['Security checks', '#/security', 'Review explicit security controls and warnings.'],
    ['Audit logs', '#/logs', 'Review AI actions and denials.'],
    ['API keys', '#/keys', 'Issue narrowly scoped keys and require approvals.'],
    ['Sessions', '#/sessions', 'Review and close active MCP sessions.'],
    ['Configuration rollback', '#/rollbacks', 'Review configuration snapshots and restore when needed.'],
    ['OAuth & Access', '#/oauth', 'Advanced identity-provider administration.'],
  ];
  async function loadCapabilities() {
    const host = root.querySelector('#capability-list');
    try {
      const { capabilities } = await API.get('/admin/capabilities');
      host.replaceChildren();
      capabilities.forEach(capability => {
        const card = document.createElement('article');
        card.className = 'card project-card';
        const title = document.createElement('h2');
        title.textContent = capability.title;
        const detail = document.createElement('p');
        detail.textContent = capability.description;
        const state = document.createElement('p');
        state.textContent = capability.enabled ? 'Enabled' : 'Disabled by default';
        const toggle = document.createElement('button');
        toggle.className = capability.enabled ? 'btn btn-ghost' : 'btn btn-primary';
        toggle.textContent = capability.defaultEnabled ? 'Always enabled' : capability.enabled ? 'Disable' : 'Enable';
        toggle.disabled = capability.defaultEnabled;
        toggle.onclick = async () => {
          try {
            await API.put(`/admin/capabilities/${encodeURIComponent(capability.id)}`, { enabled: !capability.enabled });
            Toast.success(`${capability.title} ${capability.enabled ? 'disabled' : 'enabled'}.`);
            loadCapabilities();
          } catch (error) {
            Toast.error(error.message);
          }
        };
        card.append(title, detail, state, toggle);
        host.append(card);
      });
    } catch (error) {
      host.textContent = `Unable to load capability packs: ${error.message}`;
    }
  }
  function render(container) {
    root = container;
    root.innerHTML =
      '<div class="page-header"><div><h1>Administration</h1><p class="page-subtitle">Keep the default experience small. Enable specialist capabilities only when a trusted administrator needs them.</p></div></div><section class="card"><h2>Capability packs</h2><p>Core Server Care and Developer Work stay enabled. Advanced packs are intentionally off until you explicitly enable them.</p></section><div id="capability-list" class="workflow-grid" style="margin-top:20px">Loading capability packs…</div><h2 class="section-title">Administration tools</h2><div id="admin-links" class="workflow-grid"></div>';
    const linksRoot = root.querySelector('#admin-links');
    links.forEach(([title, href, description]) => {
      const card = document.createElement('a');
      card.href = href;
      card.className = 'card project-card';
      const heading = document.createElement('h2');
      heading.textContent = title;
      const copy = document.createElement('p');
      copy.textContent = description;
      card.append(heading, copy);
      linksRoot.append(card);
    });
    loadCapabilities();
  }
  window.AdministrationPage = {
    render,
    destroy() {
      root = null;
    },
  };
})();
