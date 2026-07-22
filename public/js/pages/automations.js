import { API } from '../api.js';
import { Toast } from '../toast.js';
import { Router } from '../router.js';
(function () {
  let root;
  async function load() {
    const list = root.querySelector('#automation-list');
    try {
      const { automations } = await API.get('/admin/automations');
      list.replaceChildren();
      if (!automations.length) {
        list.textContent = 'No automations configured.';
        return;
      }
      automations.forEach(item => {
        const card = document.createElement('article');
        card.className = 'card project-card';
        const title = document.createElement('h2');
        title.textContent = item.name;
        const details = document.createElement('p');
        details.textContent = `Read-only health check · every ${item.intervalMinutes} minutes`;
        const result = document.createElement('p');
        result.textContent = item.lastResult
          ? `Last result: ${item.lastResult.status.replace('-', ' ')}`
          : `First check: ${new Date(item.nextRunAt).toLocaleString()}`;
        card.append(title, details, result);
        list.appendChild(card);
      });
    } catch (error) {
      list.textContent = `Unable to load automations: ${error.message}`;
    }
  }
  function render(container) {
    root = container;
    root.innerHTML =
      '<div class="page-header"><div><h1>Automations</h1><p>Start with safe, read-only checks. Any future change automation will require an explicit policy, approval, and rollback plan.</p></div></div><div class="card"><form id="automation-form" class="project-form"><input class="input-field" name="name" value="Server health check" required><select class="input-field" name="intervalMinutes"><option value="15">Every 15 minutes</option><option value="60" selected>Every hour</option><option value="360">Every 6 hours</option><option value="1440">Every day</option></select><button class="btn btn-primary">Schedule health check</button></form></div><div id="automation-list" class="workflow-grid" style="margin-top:20px">Loading automations…</div>';
    root.querySelector('#automation-form').onsubmit = async event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      values.type = 'health_check';
      values.intervalMinutes = Number(values.intervalMinutes);
      try {
        await API.post('/admin/automations', values);
        Toast.success('Read-only health check scheduled.');
        load();
      } catch (error) {
        Toast.error(error.message);
      }
    };
    load();
  }
  function destroy() {
    root = null;
  }
  window.AutomationsPage = { render, destroy };
})();
