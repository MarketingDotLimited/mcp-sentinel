(function() {
  let rootContainer = null;

  async function loadKeys() {
    try {
      const response = await window.API.get('/admin/keys');
      const keys = Array.isArray(response) ? response : (response.keys || response.data || []);
      renderTable(keys);
    } catch (err) {
      if (window.Toast) window.Toast.error('Failed to load API keys: ' + err.message);
    }
  }

  function renderTable(keys) {
    const tableBody = rootContainer.querySelector('#keys-tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    
    if (keys.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.style.textAlign = 'center';
      td.textContent = 'No API keys found';
      tr.appendChild(td);
      tableBody.appendChild(tr);
      return;
    }

    keys.forEach(keyItem => {
      const tr = document.createElement('tr');
      
      const tdLabel = document.createElement('td');
      tdLabel.textContent = keyItem.label || 'N/A';
      
      const tdUser = document.createElement('td');
      tdUser.textContent = keyItem.userId || 'Unknown';
      
      const tdRole = document.createElement('td');
      const roleBadge = document.createElement('span');
      roleBadge.className = 'badge ' + (keyItem.role === 'admin' ? 'badge-admin' : 'badge-user');
      roleBadge.textContent = keyItem.role || 'user';
      tdRole.appendChild(roleBadge);
      
      const tdScopes = document.createElement('td');
      const scopes = Array.isArray(keyItem.scopes) ? keyItem.scopes : (keyItem.scopes ? keyItem.scopes.split(',') : []);
      scopes.forEach(scope => {
        const pill = document.createElement('span');
        pill.className = 'badge';
        pill.style.marginRight = '4px';
        pill.textContent = scope.trim();
        tdScopes.appendChild(pill);
      });
      if (scopes.length === 0) tdScopes.textContent = 'None';
      
      const tdCreated = document.createElement('td');
      tdCreated.textContent = new Date(keyItem.createdAt || Date.now()).toLocaleString();
      
      const tdActions = document.createElement('td');
      const btnRevoke = document.createElement('button');
      btnRevoke.className = 'btn btn-danger btn-sm';
      btnRevoke.textContent = 'Revoke';
      btnRevoke.onclick = () => showRevokeModal(keyItem);
      tdActions.appendChild(btnRevoke);
      
      tr.appendChild(tdLabel);
      tr.appendChild(tdUser);
      tr.appendChild(tdRole);
      tr.appendChild(tdScopes);
      tr.appendChild(tdCreated);
      tr.appendChild(tdActions);
      
      tableBody.appendChild(tr);
    });
  }

  function showRevokeModal(keyItem) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal-title">Revoke API Key</h3>
        <p>Are you sure you want to revoke the key labeled "<span id="revoke-label"></span>"?</p>
        <div class="modal-actions" style="margin-top: 20px; text-align: right;">
          <button class="btn btn-ghost" id="btn-cancel">Cancel</button>
          <button class="btn btn-danger" id="btn-confirm">Revoke</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#revoke-label').textContent = keyItem.label || 'N/A';

    overlay.querySelector('#btn-cancel').onclick = () => {
      document.body.removeChild(overlay);
    };
    overlay.querySelector('#btn-confirm').onclick = async () => {
      document.body.removeChild(overlay);
      try {
        await window.API.post('/admin/keys/revoke', { key: keyItem.key });
        if (window.Toast) window.Toast.success('API key revoked');
        loadKeys();
      } catch (err) {
        if (window.Toast) window.Toast.error('Failed to revoke key: ' + err.message);
      }
    };
  }

  function generateRandomKey() {
    return 'mcp_' + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function showGenerateModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal-title">Generate API Key</h3>
        <div class="input-group" style="margin-bottom: 10px;">
          <label>Key</label>
          <div style="display: flex; gap: 10px;">
            <input type="text" id="gen-key" class="input-field" style="flex: 1;" readonly>
            <button id="btn-regen" class="btn btn-ghost">Regenerate</button>
          </div>
        </div>
        <div class="input-group" style="margin-bottom: 10px;">
          <label>User ID</label>
          <input type="text" id="gen-user" class="input-field">
        </div>
        <div class="input-group" style="margin-bottom: 10px;">
          <label>Role</label>
          <select id="gen-role" class="input-field">
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div class="input-group" style="margin-bottom: 10px;">
          <label>Label</label>
          <input type="text" id="gen-label" class="input-field">
        </div>
        <div class="input-group" style="margin-bottom: 10px;">
          <label>Scopes</label>
          <input type="text" id="gen-scopes" class="input-field" placeholder="* for all, or tool names">
        </div>
        <div class="input-group" style="margin-bottom: 20px;">
          <label>Allowed IPs</label>
          <input type="text" id="gen-ips" class="input-field" placeholder="empty = all">
        </div>
        <div class="modal-actions" style="text-align: right;">
          <button class="btn btn-ghost" id="btn-cancel">Cancel</button>
          <button class="btn btn-primary" id="btn-submit">Generate</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const inputKey = overlay.querySelector('#gen-key');
    inputKey.value = generateRandomKey();

    overlay.querySelector('#btn-regen').onclick = () => {
      inputKey.value = generateRandomKey();
    };

    overlay.querySelector('#btn-cancel').onclick = () => {
      document.body.removeChild(overlay);
    };

    overlay.querySelector('#btn-submit').onclick = async () => {
      const key = inputKey.value;
      const userId = overlay.querySelector('#gen-user').value.trim();
      const role = overlay.querySelector('#gen-role').value;
      const label = overlay.querySelector('#gen-label').value.trim();
      const scopesStr = overlay.querySelector('#gen-scopes').value.trim();
      const ipsStr = overlay.querySelector('#gen-ips').value.trim();

      const scopes = scopesStr ? scopesStr.split(',').map(s => s.trim()).filter(Boolean) : [];
      const allowedIPs = ipsStr ? ipsStr.split(',').map(s => s.trim()).filter(Boolean) : [];

      document.body.removeChild(overlay);

      try {
        await window.API.post('/admin/keys', { key, userId, role, label, scopes, allowedIPs });
        if (window.Toast) window.Toast.success('API key generated successfully');
        loadKeys();
      } catch (err) {
        if (window.Toast) window.Toast.error('Failed to generate key: ' + err.message);
      }
    };
  }

  function render(container) {
    rootContainer = container;
    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2>API Keys</h2>
        <div>
          <button id="btn-refresh" class="btn btn-ghost" style="margin-right: 10px;">↻ Refresh</button>
          <button id="btn-generate" class="btn btn-primary">Generate Key</button>
        </div>
      </div>
      <div class="card">
        <table class="data-table" style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr>
              <th>Label</th>
              <th>User</th>
              <th>Role</th>
              <th>Scopes</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="keys-tbody">
            <tr><td colspan="6" style="text-align: center;">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    `;

    container.querySelector('#btn-refresh').addEventListener('click', loadKeys);
    container.querySelector('#btn-generate').addEventListener('click', showGenerateModal);

    loadKeys();
  }

  function destroy() {
    rootContainer = null;
  }

  window.KeysPage = { render, destroy };
})();
