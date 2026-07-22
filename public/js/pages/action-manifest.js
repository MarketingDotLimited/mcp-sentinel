import { API } from '../api.js';
import { Toast } from '../toast.js';

(function () {
  let root;
  let currentManifest;

  function codeBlock(value) {
    const pre = document.createElement('pre');
    pre.className = 'code-block';
    pre.textContent = JSON.stringify(value, null, 2);
    return pre;
  }

  function renderTool(tool) {
    const card = document.createElement('article');
    card.className = 'card project-card';
    const title = document.createElement('h2');
    title.textContent = tool.title || tool.name;
    const name = document.createElement('code');
    name.textContent = tool.name;
    const description = document.createElement('p');
    description.textContent = tool.description;
    const annotations = document.createElement('p');
    annotations.textContent = `Read-only: ${tool.annotations.readOnlyHint}; destructive: ${tool.annotations.destructiveHint}; idempotent: ${tool.annotations.idempotentHint}; open world: ${tool.annotations.openWorldHint}`;
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Schemas';
    details.append(summary, codeBlock({ inputSchema: tool.inputSchema, outputSchema: tool.outputSchema }));
    card.append(title, name, description, annotations, details);
    return card;
  }

  async function load() {
    const status = root.querySelector('#manifest-status');
    try {
      const { manifest, refreshChecklist } = await API.get('/admin/action-manifest');
      currentManifest = manifest;
      status.textContent = `Manifest v${manifest.version} · ${manifest.hash}`;
      root.querySelector('#manifest-tools').replaceChildren(...manifest.tools.map(renderTool));
      const checklist = root.querySelector('#manifest-checklist');
      checklist.replaceChildren();
      refreshChecklist.forEach(item => {
        const li = document.createElement('li');
        li.textContent = item;
        checklist.append(li);
      });
    } catch (error) {
      currentManifest = null;
      status.textContent = `Unable to load the action manifest: ${error.message}`;
    }
  }

  async function confirmRefresh(event) {
    event.preventDefault();
    if (!currentManifest) return;
    const form = new FormData(event.currentTarget);
    try {
      await API.post('/admin/action-refresh-status', {
        confirm: true,
        manifestHash: currentManifest.hash,
        enabledTools: ['run_project_tests', 'get_project_test_run', 'cancel_project_test_run'],
        oauthReauthorized: form.get('oauthReauthorized') === 'on',
        newChatTested: form.get('newChatTested') === 'on',
      });
      Toast.success('ChatGPT action refresh evidence recorded.');
    } catch (error) {
      Toast.error(error.message);
    }
  }

  function render(container) {
    root = container;
    root.innerHTML =
      '<div class="page-header"><div><h1>ChatGPT action manifest</h1><p>Compare the exact live tools, schemas, risk annotations, and connector refresh checklist.</p></div><button class="btn btn-ghost" id="refresh-manifest">Refresh</button></div><section class="card"><h2 id="manifest-status">Loading manifest…</h2><ol id="manifest-checklist"></ol><form id="manifest-confirm"><label><input type="checkbox" name="oauthReauthorized" required> OAuth was reauthorized after credential rotation</label><br><label><input type="checkbox" name="newChatTested" required> A new chat completed a small assigned-project test</label><br><button class="btn btn-primary" type="submit">Record completed refresh</button></form></section><div id="manifest-tools" class="workflow-grid" style="margin-top:20px"></div>';
    root.querySelector('#refresh-manifest').onclick = load;
    root.querySelector('#manifest-confirm').onsubmit = confirmRefresh;
    load();
  }

  window.ActionManifestPage = { render, destroy: () => (root = null) };
})();
