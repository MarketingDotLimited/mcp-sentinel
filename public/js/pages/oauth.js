import { API } from "../api.js";
import { Toast } from "../toast.js";
import { Router } from "../router.js";
window.OAuthPage = (function () {
  let container = null;
  let refreshInterval = null;
  let currentTab = 'users';
  let knownClientIds = new Set();

  // Store modals to clean them up
  let activeModals = [];

  function render(root) {
    container = root;
    container.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = `
            .oauth-tabs { display: flex; border-bottom: 1px solid rgba(99,102,241,0.15); margin-bottom: 24px; gap: 0; }
            .oauth-tab { padding: 12px 24px; background: none; border: none; color: #94a3b8; font-size: 14px; font-weight: 500; cursor: pointer; border-bottom: 2px solid transparent; transition: 0.2s; }
            .oauth-tab.active { color: #6366f1; border-bottom-color: #6366f1; }
            .oauth-tab:hover:not(.active) { color: #f1f5f9; }
            .scopes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; margin-top: 8px; }
            .health-info-row { display: flex; justify-content: space-between; padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); }
            .health-info-row a { color: #6366f1; text-decoration: none; }
            .health-info-row a:hover { text-decoration: underline; }
            .status-dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 8px; }
            .status-green { background-color: #22c55e; box-shadow: 0 0 8px rgba(34,197,94,0.4); }
            .status-red { background-color: #ef4444; box-shadow: 0 0 8px rgba(239,68,68,0.4); }
            .preset-group { display: flex; gap: 8px; margin-bottom: 16px; }
            .checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #e2e8f0; cursor: pointer; }
        `;
    container.appendChild(style);

    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'oauth-tabs';

    const tabs = [
      { id: 'users', label: 'Users' },
      { id: 'clients', label: 'AI Clients' },
      { id: 'health', label: 'Service Health' },
    ];

    tabs.forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'oauth-tab' + (currentTab === t.id ? ' active' : '');
      btn.textContent = t.label;
      btn.dataset.tab = t.id;
      btn.onclick = () => switchTab(t.id);
      tabsContainer.appendChild(btn);
    });

    container.appendChild(tabsContainer);

    const contentContainer = document.createElement('div');
    contentContainer.id = 'oauth-content';
    container.appendChild(contentContainer);

    loadTabContent();

    refreshInterval = setInterval(() => {
      if (currentTab === 'health') {
        fetchHealth();
      }
    }, 15000);
  }

  function switchTab(tabId) {
    currentTab = tabId;
    const tabs = container.querySelectorAll('.oauth-tab');
    tabs.forEach(t => {
      if (t.dataset.tab === tabId) t.classList.add('active');
      else t.classList.remove('active');
    });
    loadTabContent();
  }

  function loadTabContent() {
    const content = document.getElementById('oauth-content');
    if (!content) return;
    content.innerHTML = '';

    if (currentTab === 'users') {
      renderUsersTab(content);
    } else if (currentTab === 'clients') {
      renderClientsTab(content);
    } else if (currentTab === 'health') {
      renderHealthTab(content);
    }
  }

  function createModal(titleText) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal';

    const title = document.createElement('h3');
    title.className = 'modal-title';
    title.textContent = titleText;
    modal.appendChild(title);

    const body = document.createElement('div');
    body.className = 'modal-body';
    modal.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    modal.appendChild(actions);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    activeModals.push(overlay);

    const close = () => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      activeModals = activeModals.filter(m => m !== overlay);
    };

    return { overlay, body, actions, close };
  }

  // --- USERS TAB ---
  async function renderUsersTab(content) {
    const header = document.createElement('div');
    header.className = 'page-header';

    const titleArea = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.textContent = 'OAuth Users';
    const p = document.createElement('p');
    p.textContent = 'Manage Authelia identity provider users';
    p.style.color = '#94a3b8';
    p.style.fontSize = '14px';
    titleArea.appendChild(h2);
    titleArea.appendChild(p);
    header.appendChild(titleArea);

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary';
    addBtn.textContent = 'Add User';
    addBtn.onclick = () => showUserModal(null);
    header.appendChild(addBtn);

    content.appendChild(header);

    const card = document.createElement('div');
    card.className = 'card';

    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `
            <thead>
                <tr>
                    <th>Username</th>
                    <th>Email</th>
                    <th>Linux User</th>
                    <th>Groups</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
    card.appendChild(table);
    content.appendChild(card);

    fetchUsers();
  }

  async function fetchUsers() {
    const tbody = document.querySelector('#oauth-content .data-table tbody');
    if (!tbody) return;

    try {
      const res = await API.get('/admin/oauth-users');
      tbody.innerHTML = '';

      if (res.error) throw new Error(res.error);
      const users = Array.isArray(res) ? res : res.data || [];
      users.forEach(user => {
        const tr = document.createElement('tr');

        const tdUsername = document.createElement('td');
        tdUsername.textContent = user.username;

        const tdEmail = document.createElement('td');
        tdEmail.textContent = user.email || '';

        const tdLinux = document.createElement('td');
        if (user.linuxUser) {
          const b = document.createElement('span');
          b.className = 'badge badge-admin';
          b.textContent = user.linuxUser;
          tdLinux.appendChild(b);
        }

        const tdGroups = document.createElement('td');
        if (user.groups && user.groups.length) {
          user.groups.forEach(g => {
            const b = document.createElement('span');
            b.className = 'badge ' + (g === 'admins' ? 'badge-admin' : 'badge-user');
            b.textContent = g;
            b.style.marginRight = '4px';
            tdGroups.appendChild(b);
          });
        }

        const tdActions = document.createElement('td');

        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-ghost btn-sm';
        editBtn.textContent = 'Edit';
        editBtn.style.marginRight = '8px';
        editBtn.onclick = () => showUserModal(user);

        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-ghost btn-sm';
        delBtn.textContent = 'Delete';
        delBtn.style.color = '#ef4444';
        delBtn.onclick = () => confirmDeleteUser(user.username);

        tdActions.appendChild(editBtn);
        tdActions.appendChild(delBtn);

        tr.appendChild(tdUsername);
        tr.appendChild(tdEmail);
        tr.appendChild(tdLinux);
        tr.appendChild(tdGroups);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
      });
    } catch (err) {
      window.Toast && Toast.error('Failed to load users: ' + err.message);
    }
  }

  async function showUserModal(user) {
    const isEdit = !!user;
    const modal = createModal(isEdit ? 'Edit User' : 'Add User');

    const scopesList = [
      'read_file',
      'write_file',
      'delete_file',
      'list_directory',
      'get_system_info',
      'get_processes',
      'kill_process',
      'manage_service',
      'manage_firewall',
      'execute_query',
      'git_operation',
      'run_code',
    ];

    let osUsers = [];
    try {
      const res = await API.get('/admin/os-users');
      const data = Array.isArray(res) ? res : res.users || res.data || [];
      osUsers = data.filter(u => u.shell && !u.shell.includes('false') && !u.shell.includes('nologin'));
    } catch (e) {
      console.error(e);
    }

    modal.body.innerHTML = `
            <div class="input-group">
                <label for="modal-username">Username</label>
                <input type="text" class="input-field" id="modal-username" autocomplete="username" required ${isEdit ? 'disabled' : ''}>
            </div>
            <div class="input-group">
                <label for="modal-password">Password ${isEdit ? '(Leave blank to keep unchanged)' : ''}</label>
                <input type="password" class="input-field" id="modal-password" autocomplete="new-password" ${isEdit ? '' : 'required'}>
            </div>
            <div class="input-group">
                <label for="modal-email">Email</label>
                <input type="email" class="input-field" id="modal-email" autocomplete="email" required>
            </div>
            <div class="input-group">
                <label>Linux User</label>
                <select class="input-field" id="modal-linux-user">
                    <option value="">-- None --</option>
                </select>
            </div>
            <div class="input-group">
                <label>Groups</label>
                <div style="display: flex; gap: 16px; margin-top: 8px;">
                    <label class="checkbox-label"><input type="checkbox" id="modal-group-admins" value="admins"> admins</label>
                    <label class="checkbox-label"><input type="checkbox" id="modal-group-users" value="users" checked> users</label>
                </div>
            </div>
            <div class="input-group">
                <label>MCP Scopes</label>
                <div style="margin-top: 8px;">
                    <label class="checkbox-label"><input type="checkbox" id="modal-scopes-all"> <b>Select All</b></label>
                </div>
                <div class="scopes-grid" id="modal-scopes-grid"></div>
            </div>
        `;

    const selLinux = modal.body.querySelector('#modal-linux-user');
    osUsers.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.username;
      opt.textContent = u.username;
      selLinux.appendChild(opt);
    });

    const scopesGrid = modal.body.querySelector('#modal-scopes-grid');
    scopesList.forEach(scope => {
      const lbl = document.createElement('label');
      lbl.className = 'checkbox-label';
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'scope-chk';
      chk.value = scope;
      lbl.appendChild(chk);
      lbl.appendChild(document.createTextNode(' ' + scope));
      scopesGrid.appendChild(lbl);
    });

    const chkAll = modal.body.querySelector('#modal-scopes-all');
    chkAll.onchange = e => {
      const boxes = modal.body.querySelectorAll('.scope-chk');
      boxes.forEach(b => (b.checked = e.target.checked));
    };

    if (isEdit) {
      modal.body.querySelector('#modal-username').value = user.username;
      modal.body.querySelector('#modal-email').value = user.email || '';
      if (user.linuxUser) selLinux.value = user.linuxUser;
      modal.body.querySelector('#modal-group-admins').checked = (user.groups || []).includes('admins');
      modal.body.querySelector('#modal-group-users').checked = (user.groups || []).includes('users');

      if (user.scopes) {
        const boxes = modal.body.querySelectorAll('.scope-chk');
        boxes.forEach(b => (b.checked = user.scopes.includes(b.value)));
      }
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = modal.close;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = 'Save';
    saveBtn.onclick = async () => {
      const usernameInput = modal.body.querySelector('#modal-username');
      const passwordInput = modal.body.querySelector('#modal-password');
      const emailInput = modal.body.querySelector('#modal-email');

      // The API requires all three values when creating a user. Validate
      // before making the request so the admin receives a useful message
      // instead of a generic HTTP 400 in the console.
      if (!isEdit && (!usernameInput.value.trim() || !passwordInput.value || !emailInput.value.trim())) {
        Toast.error('Username, password, and email are required.');
        (!usernameInput.value.trim() ? usernameInput : !passwordInput.value ? passwordInput : emailInput).focus();
        return;
      }
      if (emailInput.value.trim() && !emailInput.checkValidity()) {
        Toast.error('Enter a valid email address.');
        emailInput.focus();
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      const data = {
        username: usernameInput.value.trim(),
        password: passwordInput.value,
        email: emailInput.value.trim(),
        linuxUser: selLinux.value,
        groups: [],
        scopes: [],
      };

      if (modal.body.querySelector('#modal-group-admins').checked) data.groups.push('admins');
      if (modal.body.querySelector('#modal-group-users').checked) data.groups.push('users');

      modal.body.querySelectorAll('.scope-chk:checked').forEach(b => data.scopes.push(b.value));

      try {
        if (isEdit) {
          if (!data.password) delete data.password;
          await API.put('/admin/oauth-users/' + data.username, data);
          Toast.success('User updated');
        } else {
          if (!data.username || !data.password) throw new Error('Username and password are required');
          await API.post('/admin/oauth-users', data);
          Toast.success('User added');
        }
        modal.close();
        fetchUsers();
      } catch (err) {
        Toast.error(err.message);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    };

    modal.actions.appendChild(cancelBtn);
    modal.actions.appendChild(saveBtn);
  }

  function confirmDeleteUser(username) {
    const modal = createModal('Delete User');
    modal.body.innerHTML = '<p>Are you sure you want to delete user <b id="del-username"></b>?</p>';
    modal.body.querySelector('#del-username').textContent = username;

    const cancel = document.createElement('button');
    cancel.className = 'btn btn-ghost';
    cancel.textContent = 'Cancel';
    cancel.onclick = modal.close;

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'Delete';
    delBtn.onclick = async () => {
      try {
        await API.del('/admin/oauth-users/' + username);
        Toast.success('User deleted');
        modal.close();
        fetchUsers();
      } catch (err) {
        Toast.error(err.message);
      }
    };

    modal.actions.appendChild(cancel);
    modal.actions.appendChild(delBtn);
  }

  // --- CLIENTS TAB ---
  function renderClientsTab(content) {
    const header = document.createElement('div');
    header.className = 'page-header';

    const titleArea = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.textContent = 'AI Clients';
    const p = document.createElement('p');
    p.textContent = 'Manage OAuth/OIDC client applications';
    p.style.color = '#94a3b8';
    p.style.fontSize = '14px';
    titleArea.appendChild(h2);
    titleArea.appendChild(p);
    header.appendChild(titleArea);

    const headerActions = document.createElement('div');
    headerActions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    const setupBtn = document.createElement('button');
    setupBtn.className = 'btn btn-ghost';
    setupBtn.textContent = 'ChatGPT setup values';
    setupBtn.onclick = showChatGPTSetup;
    headerActions.appendChild(setupBtn);

    const diagnosticBtn = document.createElement('button');
    diagnosticBtn.className = 'btn btn-ghost';
    diagnosticBtn.textContent = 'Test live OAuth';
    diagnosticBtn.onclick = startOAuthDiagnostic;
    headerActions.appendChild(diagnosticBtn);

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary';
    addBtn.textContent = 'Create OAuth Client';
    addBtn.onclick = showClientModal;
    headerActions.appendChild(addBtn);
    header.appendChild(headerActions);

    content.appendChild(header);

    const card = document.createElement('div');
    card.className = 'card';

    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `
            <thead>
                <tr>
                    <th>Client ID</th>
                    <th>Client Name</th>
                    <th>Redirect URIs</th>
                    <th>Scopes</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
    card.appendChild(table);
    content.appendChild(card);

    fetchClients();
  }

  async function fetchClients() {
    const tbody = document.querySelector('#oauth-content .data-table tbody');
    if (!tbody) return;

    try {
      const res = await API.get('/admin/oauth-clients');
      tbody.innerHTML = '';

      if (res.error) throw new Error(res.error);
      const clients = Array.isArray(res) ? res : res.data || [];
      knownClientIds = new Set(clients.map(client => client.client_id || client.clientId).filter(Boolean));
      clients.forEach(client => {
        const clientId = client.client_id || client.clientId;
        const clientName = client.client_name || client.clientName || clientId;
        const redirectUris = client.redirect_uris || client.redirectUris || [];
        const tr = document.createElement('tr');

        const tdId = document.createElement('td');
        tdId.textContent = clientId;

        const tdName = document.createElement('td');
        tdName.textContent = clientName;

        const tdUris = document.createElement('td');
        const urisStr = redirectUris.join(', ');
        tdUris.textContent = urisStr.length > 50 ? urisStr.substring(0, 47) + '...' : urisStr;
        tdUris.title = urisStr;

        const tdScopes = document.createElement('td');
        if (client.scopes) {
          client.scopes.forEach(s => {
            const b = document.createElement('span');
            b.className = 'badge badge-user';
            b.textContent = s;
            b.style.marginRight = '4px';
            tdScopes.appendChild(b);
          });
        }

        const tdActions = document.createElement('td');
        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-ghost btn-sm';
        delBtn.textContent = 'Delete';
        delBtn.style.color = '#ef4444';
        delBtn.onclick = () => confirmDeleteClient(clientId);
        tdActions.appendChild(delBtn);

        tr.appendChild(tdId);
        tr.appendChild(tdName);
        tr.appendChild(tdUris);
        tr.appendChild(tdScopes);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
      });
    } catch (err) {
      window.Toast && Toast.error('Failed to load clients: ' + err.message);
    }
  }

  function copySetupValue(value, button) {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        const label = button.textContent;
        button.textContent = 'Copied';
        setTimeout(() => {
          button.textContent = label;
        }, 1500);
      })
      .catch(() => Toast.error('Could not copy this value.'));
  }

  function showClientCredentials(client) {
    const modal = createModal('OAuth Client Created');
    const values = [
      ['MCP Server URL', `${window.location.origin}/mcp`],
      ['OAuth Client ID', client.client_id],
      ['OAuth Client Secret', client.client_secret],
      ['Token endpoint auth method', client.token_endpoint_auth_method],
      ['Scopes', client.scopes.join(' ')],
    ];
    const intro = document.createElement('p');
    intro.className = 'modal-description';
    intro.textContent =
      'Copy these values into ChatGPT Advanced OAuth settings. The client secret is shown only now and cannot be recovered later.';
    modal.body.appendChild(intro);
    values.forEach(([label, value]) => {
      const group = document.createElement('div');
      group.className = 'input-group';
      const heading = document.createElement('label');
      heading.textContent = label;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center';
      const field = document.createElement('input');
      field.className = 'input-field';
      field.value = value;
      field.readOnly = true;
      const copy = document.createElement('button');
      copy.className = 'btn btn-ghost btn-sm';
      copy.textContent = 'Copy';
      copy.onclick = () => copySetupValue(value, copy);
      row.append(field, copy);
      group.append(heading, row);
      modal.body.appendChild(group);
    });
    const done = document.createElement('button');
    done.className = 'btn btn-primary';
    done.textContent = 'I saved the secret';
    done.onclick = modal.close;
    modal.actions.appendChild(done);
  }

  async function showChatGPTSetup() {
    try {
      const health = await API.get('/admin/oauth-health');
      const issuer = health?.url;
      if (!issuer) throw new Error('Authelia issuer is not configured.');
      const resource = window.location.origin;
      const modal = createModal('ChatGPT Setup Values');
      const intro = document.createElement('p');
      intro.className = 'modal-description';
      intro.textContent =
        'In ChatGPT, copy its callback URL first. Then create an OAuth client below and copy its ID and one-time secret. The other values are ready to paste here.';
      modal.body.appendChild(intro);
      const values = [
        ['MCP Server URL', `${resource}/mcp`],
        ['Registration method', 'User-Defined OAuth Client'],
        ['Token endpoint auth method', 'client_secret_basic'],
        ['Default scopes', 'offline_access'],
        ['Base scopes', 'openid profile email'],
        ['Auth URL', `${issuer}/api/oidc/authorization`],
        ['Token URL', `${issuer}/api/oidc/token`],
        ['Authorization server base', issuer],
        ['Resource', resource],
        ['OIDC configuration URL', `${issuer}/.well-known/openid-configuration`],
        ['OIDC userinfo endpoint', `${issuer}/api/oidc/userinfo`],
        ['OIDC scopes supported', 'openid profile email offline_access'],
      ];
      values.forEach(([label, value]) => {
        const group = document.createElement('div');
        group.className = 'input-group';
        const heading = document.createElement('label');
        heading.textContent = label;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:center';
        const field = document.createElement('input');
        field.className = 'input-field';
        field.value = value;
        field.readOnly = true;
        const copy = document.createElement('button');
        copy.className = 'btn btn-ghost btn-sm';
        copy.textContent = 'Copy';
        copy.onclick = () => copySetupValue(value, copy);
        row.append(field, copy);
        group.append(heading, row);
        modal.body.appendChild(group);
      });
      const callback = document.createElement('p');
      callback.className = 'connect-warning';
      callback.textContent =
        'ChatGPT callback URL: copy this from ChatGPT and paste it into Create OAuth Client. It is unique to each connector and cannot be generated here.';
      modal.body.appendChild(callback);
      const done = document.createElement('button');
      done.className = 'btn btn-primary';
      done.textContent = 'Done';
      done.onclick = modal.close;
      modal.actions.appendChild(done);
    } catch (error) {
      Toast.error(`Unable to load ChatGPT setup values: ${error.message}`);
    }
  }

  async function startOAuthDiagnostic() {
    try {
      const result = await API.post('/admin/oauth-diagnostic/start', {});
      if (!result?.authorizationUrl) throw new Error(result?.error || 'Could not start the diagnostic.');
      const modal = createModal('Live OAuth Diagnostic');
      const text = document.createElement('p');
      text.className = 'modal-description';
      text.textContent =
        'Continue to Authelia sign-in. The server will then exchange the code and run a real authenticated MCP initialize request. Tokens and secrets are never shown.';
      const open = document.createElement('a');
      open.className = 'btn btn-primary';
      open.href = result.authorizationUrl;
      open.target = '_blank';
      open.rel = 'noopener';
      open.textContent = 'Continue to sign in';
      modal.body.append(text, open);
      const close = document.createElement('button');
      close.className = 'btn btn-ghost';
      close.textContent = 'Close';
      close.onclick = modal.close;
      modal.actions.appendChild(close);
    } catch (error) {
      Toast.error(`Unable to start live OAuth test: ${error.message}`);
    }
  }

  function showClientModal() {
    const modal = createModal('Create OAuth Client');

    modal.body.innerHTML = `
            <p class="modal-description">Create a separate confidential OAuth client for each ChatGPT connector. Paste the callback URL that ChatGPT generates below. Add multiple URLs only when they belong to the same trusted integration.</p>
            <div class="input-group">
                <label for="client-name">Integration name</label>
                <input type="text" class="input-field" id="client-name" placeholder="Rabeeb Server Access" required>
            </div>
            <div class="input-group">
                <label for="client-id">Client ID (optional)</label>
                <input type="text" class="input-field" id="client-id" placeholder="Generated automatically when blank" autocomplete="off">
            </div>
            <div class="input-group">
                <label for="client-redirect-uris">ChatGPT callback URL(s)</label>
                <textarea class="input-field" id="client-redirect-uris" rows="4" placeholder="https://chatgpt.com/connector/oauth/..." required></textarea>
                <small class="text-muted">One URL per line or comma-separated. Copy each callback from ChatGPT; do not guess it.</small>
            </div>
        `;

    const cId = modal.body.querySelector('#client-id');
    const cName = modal.body.querySelector('#client-name');
    const cUris = modal.body.querySelector('#client-redirect-uris');

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = modal.close;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = 'Create and generate secret';
    saveBtn.onclick = async () => {
      const data = {
        clientId: cId.value.trim(),
        clientName: cName.value.trim(),
        redirectUris: cUris.value
          .split(/[\n,]/)
          .map(value => value.trim())
          .filter(Boolean),
      };

      try {
        if (!data.clientName || !data.redirectUris.length)
          throw new Error('Integration name and at least one callback URL are required.');
        if (data.clientId && knownClientIds.has(data.clientId))
          throw new Error(`Client '${data.clientId}' already exists. Choose a different Client ID.`);
        saveBtn.disabled = true;
        const client = await API.post('/admin/oauth-clients', data);
        Toast.success('OAuth client created. Save the secret now.');
        modal.close();
        fetchClients();
        showClientCredentials(client);
      } catch (err) {
        Toast.error(err.message);
      } finally {
        saveBtn.disabled = false;
      }
    };

    modal.actions.appendChild(cancelBtn);
    modal.actions.appendChild(saveBtn);
  }

  function confirmDeleteClient(clientId) {
    const modal = createModal('Delete Client');
    modal.body.innerHTML = '<p>Are you sure you want to delete client <b id="del-client"></b>?</p>';
    modal.body.querySelector('#del-client').textContent = clientId;

    const cancel = document.createElement('button');
    cancel.className = 'btn btn-ghost';
    cancel.textContent = 'Cancel';
    cancel.onclick = modal.close;

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'Delete';
    delBtn.onclick = async () => {
      try {
        await API.del('/admin/oauth-clients/' + clientId);
        Toast.success('Client deleted');
        modal.close();
        fetchClients();
      } catch (err) {
        Toast.error(err.message);
      }
    };

    modal.actions.appendChild(cancel);
    modal.actions.appendChild(delBtn);
  }

  // --- HEALTH TAB ---
  function renderHealthTab(content) {
    const header = document.createElement('div');
    header.className = 'page-header';

    const titleArea = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.textContent = 'Service Health';
    titleArea.appendChild(h2);
    header.appendChild(titleArea);

    const restartBtn = document.createElement('button');
    restartBtn.className = 'btn btn-danger';
    restartBtn.textContent = 'Restart Authelia';
    restartBtn.onclick = confirmRestart;
    header.appendChild(restartBtn);

    content.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'content-grid';
    grid.id = 'health-grid';
    grid.style.marginBottom = '24px';
    content.appendChild(grid);

    const detailsCard = document.createElement('div');
    detailsCard.className = 'card';
    detailsCard.id = 'health-details';
    content.appendChild(detailsCard);

    fetchHealth();
  }

  async function fetchHealth() {
    if (currentTab !== 'health') return;

    try {
      const res = await API.get('/admin/oauth-health');
      if (res.error) throw new Error(res.error);

      // The endpoint returns the health object directly. Keep the
      // fallback for compatibility with any future wrapped response.
      const data = res?.data ?? res ?? {};

      const grid = document.getElementById('health-grid');
      const details = document.getElementById('health-details');
      if (!grid || !details) return;

      const statusColor = data.status === 'active' ? 'status-green' : 'status-red';

      grid.innerHTML = `
                <div class="stat-card">
                    <h3 class="card-title">Authelia Status</h3>
                    <div class="card-value" style="display: flex; align-items: center;">
                        <span class="status-dot ${statusColor}"></span>
                        <span>${data.status || 'unknown'}</span>
                    </div>
                </div>
                <div class="stat-card">
                    <h3 class="card-title">Total Users</h3>
                    <div class="card-value">${data.totalUsers || 0}</div>
                </div>
                <div class="stat-card">
                    <h3 class="card-title">Total Clients</h3>
                    <div class="card-value">${data.totalClients || 0}</div>
                </div>
            `;

      details.innerHTML = '';

      const createRow = (label, value, isLink = false) => {
        const row = document.createElement('div');
        row.className = 'health-info-row';

        const lbl = document.createElement('strong');
        lbl.textContent = label;
        row.appendChild(lbl);

        if (isLink && value) {
          const a = document.createElement('a');
          a.href = value;
          a.target = '_blank';
          a.textContent = value;
          row.appendChild(a);
        } else {
          const span = document.createElement('span');
          span.textContent = value || 'N/A';
          row.appendChild(span);
        }

        return row;
      };

      details.appendChild(createRow('Authelia URL', data.url, true));
      details.appendChild(createRow('OIDC Discovery URL', data.discoveryUrl, true));
      details.appendChild(createRow('JWKS URL', data.jwksUrl, true));
      details.appendChild(createRow('Uptime', data.uptime));
    } catch (err) {
      console.error('Failed to fetch health:', err);
    }
  }

  function confirmRestart() {
    const modal = createModal('Restart Authelia');
    modal.body.innerHTML =
      '<p>Are you sure you want to restart the Authelia service? This will temporarily interrupt OAuth logins.</p>';

    const cancel = document.createElement('button');
    cancel.className = 'btn btn-ghost';
    cancel.textContent = 'Cancel';
    cancel.onclick = modal.close;

    const btn = document.createElement('button');
    btn.className = 'btn btn-danger';
    btn.textContent = 'Restart';
    btn.onclick = async () => {
      try {
        await API.post('/admin/oauth-restart');
        Toast.success('Restart initiated');
        modal.close();
        setTimeout(fetchHealth, 2000);
      } catch (err) {
        Toast.error(err.message);
      }
    };

    modal.actions.appendChild(cancel);
    modal.actions.appendChild(btn);
  }

  function destroy() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
    activeModals.forEach(m => {
      if (m.parentNode) m.parentNode.removeChild(m);
    });
    activeModals = [];
    if (container) {
      container.innerHTML = '';
      container = null;
    }
  }

  return { render, destroy };
})();
