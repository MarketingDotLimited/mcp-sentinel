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

  async function showGenerateModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    
    // Available scope groups
    const availableScopes = ['*', 'system.*', 'files.*', 'services.*', 'users.*', 'docker.*', 'git.*', 'db.*'];
    
    let scopesHtml = '<div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px;">';
    availableScopes.forEach(scope => {
      scopesHtml += `
        <label style="display: flex; align-items: center; gap: 4px; font-weight: normal; font-size: 13px; cursor: pointer;">
          <input type="checkbox" class="scope-checkbox" value="${scope}" ${scope === '*' ? 'checked' : ''}>
          ${scope}
        </label>
      `;
    });
    scopesHtml += '</div>';

    // Fetch OS users
    let osUsersHtml = '<option value="admin">admin (Full Access)</option>';
    try {
      const users = await window.API.get('/admin/os-users');
      if (Array.isArray(users)) {
        users.forEach(u => {
          if (u.username !== 'admin') {
            osUsersHtml += `<option value="${u.username}">${u.username} (OS User)</option>`;
          }
        });
      }
    } catch (e) {
      console.warn('Failed to load OS users:', e);
    }
    osUsersHtml += '<option value="custom">-- Custom Name --</option>';

    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal-title">Generate API Key</h3>
        
        <div class="input-group" style="margin-bottom: 12px;">
          <label>Generated Key</label>
          <div style="display: flex; gap: 10px;">
            <input type="text" id="gen-key" class="input-field" style="flex: 1; opacity: 0.8; font-family: monospace;" readonly>
            <button id="btn-regen" class="btn btn-ghost" title="Regenerate">↺</button>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="input-group" style="margin-bottom: 12px;">
            <label>User Identifier</label>
            <select id="gen-user" class="input-field">
              ${osUsersHtml}
            </select>
          </div>
          <div class="input-group" style="margin-bottom: 12px;">
            <label>Privilege Role</label>
            <select id="gen-role" class="input-field">
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>

        <div class="input-group" style="margin-bottom: 12px; display: none;" id="custom-user-group">
          <label>Custom User ID</label>
          <input type="text" id="gen-user-custom" class="input-field" placeholder="e.g. specialized-agent">
        </div>

        <div class="input-group" style="margin-bottom: 12px;">
          <label>Label / Description</label>
          <select id="gen-label-select" class="input-field" style="margin-bottom: 8px;">
            <option value="Primary AI Assistant">Primary AI Assistant</option>
            <option value="Code Review Agent">Code Review Agent</option>
            <option value="CI/CD Pipeline">CI/CD Pipeline</option>
            <option value="System Monitor">System Monitor</option>
            <option value="custom">-- Custom Label --</option>
          </select>
          <input type="text" id="gen-label-custom" class="input-field" placeholder="Enter custom label" style="display: none;">
        </div>

        <div class="input-group" style="margin-bottom: 12px;">
          <label>Allowed Scopes</label>
          ${scopesHtml}
        </div>

        <div class="input-group" style="margin-bottom: 24px;">
          <label>Allowed IPs (Optional)</label>
          <input type="text" id="gen-ips" class="input-field" placeholder="Empty = all IPs allowed (e.g. 192.168.1.100)">
        </div>

        <div class="modal-actions" style="text-align: right;">
          <button class="btn btn-ghost" id="btn-cancel">Cancel</button>
          <button class="btn btn-primary" id="btn-submit">Save Key</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const keyField = overlay.querySelector('#gen-key');
    keyField.value = generateRandomKey();

    overlay.querySelector('#btn-regen').onclick = () => {
      keyField.value = generateRandomKey();
    };

    // Toggle custom user input
    const userSelect = overlay.querySelector('#gen-user');
    const customUserGroup = overlay.querySelector('#custom-user-group');
    userSelect.addEventListener('change', () => {
      customUserGroup.style.display = userSelect.value === 'custom' ? 'block' : 'none';
    });

    // Toggle custom label input
    const labelSelect = overlay.querySelector('#gen-label-select');
    const customLabelInput = overlay.querySelector('#gen-label-custom');
    labelSelect.addEventListener('change', () => {
      customLabelInput.style.display = labelSelect.value === 'custom' ? 'block' : 'none';
    });

    // Handle * scope checkbox logic
    const scopeCheckboxes = overlay.querySelectorAll('.scope-checkbox');
    scopeCheckboxes.forEach(cb => {
      cb.addEventListener('change', (e) => {
        if (e.target.value === '*' && e.target.checked) {
          scopeCheckboxes.forEach(other => { if (other.value !== '*') other.checked = false; });
        } else if (e.target.value !== '*' && e.target.checked) {
          overlay.querySelector('.scope-checkbox[value="*"]').checked = false;
        }
      });
    });

    overlay.querySelector('#btn-cancel').onclick = () => {
      document.body.removeChild(overlay);
    };

    overlay.querySelector('#btn-submit').onclick = async () => {
      const key = keyField.value;
      const role = overlay.querySelector('#gen-role').value;
      
      let userId = userSelect.value;
      if (userId === 'custom') userId = overlay.querySelector('#gen-user-custom').value.trim();
      
      let label = labelSelect.value;
      if (label === 'custom') label = customLabelInput.value.trim();

      const ips = overlay.querySelector('#gen-ips').value;
      
      const selectedScopes = Array.from(scopeCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value);

      if (!userId) {
        if (window.Toast) window.Toast.error('User ID is required');
        return;
      }
      if (selectedScopes.length === 0) {
        if (window.Toast) window.Toast.error('At least one scope must be selected');
        return;
      }

      const payload = {
        key,
        userId,
        role,
        label,
        scopes: selectedScopes,
      };
      if (ips) payload.allowedIPs = ips.split(',').map(s => s.trim()).filter(Boolean);

      try {
        await window.API.post('/admin/keys', payload);
        if (window.Toast) window.Toast.success('API key generated successfully!');
        document.body.removeChild(overlay);
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
