import { API } from '../api.js';
import { Toast } from '../toast.js';
import { Router } from '../router.js';
import {
  loadScopeRegistry,
  renderScopeSelector,
  getSelectedScopes,
  applyRoleTemplate,
  ROLE_TEMPLATES,
} from '../scope-registry.js';
(function () {
  let rootContainer = null;

  async function loadKeys() {
    try {
      const response = await API.get('/admin/keys');
      const keys = Array.isArray(response) ? response : response.keys || response.data || [];
      renderTable(keys);
    } catch (err) {
      Toast.error('Failed to load API keys: ' + err.message);
    }
  }

  function renderTable(keys) {
    const tableBody = rootContainer.querySelector('#keys-tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (keys.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
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
      const scopes = Array.isArray(keyItem.scopes) ? keyItem.scopes : keyItem.scopes ? keyItem.scopes.split(',') : [];
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
      const tdApproval = document.createElement('td');
      tdApproval.textContent = keyItem.requireApproval ? 'Required' : 'Not required';

      const tdActions = document.createElement('td');
      const btnEdit = document.createElement('button');
      btnEdit.className = 'btn btn-ghost btn-sm';
      btnEdit.style.marginRight = '8px';
      btnEdit.textContent = 'Edit';
      btnEdit.onclick = () => showEditKeyModal(keyItem);
      tdActions.appendChild(btnEdit);

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
      tr.appendChild(tdApproval);
      tr.appendChild(tdActions);

      tableBody.appendChild(tr);
    });
  }

  async function showEditKeyModal(keyItem) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal-title">Edit API Key</h3>

        <div class="input-group" style="margin-bottom: 12px;">
          <label>Label / Description</label>
          <input type="text" id="edit-label" class="input-field" value="${keyItem.label || ''}">
        </div>

        <div class="input-group" style="margin-bottom: 12px;">
          <label>Privilege Role</label>
          <select id="edit-role" class="input-field">
            <option value="viewer" ${keyItem.role === 'viewer' ? 'selected' : ''}>Viewer (read-only)</option>
            <option value="developer" ${keyItem.role === 'developer' ? 'selected' : ''}>Developer</option>
            <option value="operator" ${keyItem.role === 'operator' ? 'selected' : ''}>Operator</option>
            <option value="auditor" ${keyItem.role === 'auditor' ? 'selected' : ''}>Auditor</option>
            <option value="user" ${keyItem.role === 'user' ? 'selected' : ''}>User</option>
            <option value="admin" ${keyItem.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        </div>

        <div class="input-group" style="margin-bottom: 12px;">
          <label>Allowed Scopes</label>
          <div id="edit-scopes-container"></div>
        </div>

        <div class="input-group" style="margin-bottom: 24px;">
          <label>Allowed IPs (Optional)</label>
          <input type="text" id="edit-ips" class="input-field" value="${(keyItem.allowedIPs || []).join(', ')}" placeholder="Empty = all IPs allowed (e.g. 192.168.1.100)">
        </div>
        <div class="input-group" style="margin-bottom: 24px;">
          <label style="display: flex; gap: 8px; align-items: center;"><input type="checkbox" id="edit-approval" ${keyItem.requireApproval ? 'checked' : ''}> Require approval for risky AI actions</label>
        </div>

        <div class="modal-actions" style="text-align: right;">
          <button class="btn btn-ghost" id="btn-cancel">Cancel</button>
          <button class="btn btn-primary" id="btn-submit">Save Changes</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const scopesContainer = overlay.querySelector('#edit-scopes-container');
    renderScopeSelector(scopesContainer, keyItem.scopes || [], 'hybrid');

    const roleSelect = overlay.querySelector('#edit-role');
    roleSelect.addEventListener('change', e => {
      applyRoleTemplate(scopesContainer, e.target.value);
    });

    overlay.querySelector('#btn-cancel').onclick = () => {
      document.body.removeChild(overlay);
    };

    overlay.querySelector('#btn-submit').onclick = async () => {
      const payload = {
        label: overlay.querySelector('#edit-label').value.trim(),
        role: roleSelect.value,
        requireApproval: overlay.querySelector('#edit-approval').checked,
        scopes: getSelectedScopes(scopesContainer),
      };

      const ips = overlay.querySelector('#edit-ips').value;
      if (ips) {
        payload.allowedIPs = ips
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
      } else {
        payload.allowedIPs = [];
      }

      try {
        await API.put('/admin/keys/' + keyItem.keyId, payload);
        Toast.success('API key updated successfully!');
        document.body.removeChild(overlay);
        loadKeys();
      } catch (err) {
        Toast.error('Failed to update key: ' + err.message);
      }
    };
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
        await API.post('/admin/keys/revoke', { keyId: keyItem.keyId });
        Toast.success('API key revoked');
        loadScopeRegistry().then(() => {
          loadKeys();
        });
      } catch (err) {
        Toast.error('Failed to revoke key: ' + err.message);
      }
    };
  }

  function generateRandomKey() {
    return (
      'mcp_' +
      Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
    );
  }

  async function showGenerateModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    let scopesHtml = '<div id="gen-scopes-container"></div>';
    let osUsersHtml = '<option value="admin">admin (Full Access)</option>';
    try {
      const response = await API.get('/admin/os-users');
      const userList = response.users || [];
      if (Array.isArray(userList)) {
        userList.forEach(u => {
          // Only list users with a valid shell (SSH access)
          if (u.username !== 'admin' && !u.shell.includes('false') && !u.shell.includes('nologin')) {
            osUsersHtml += `<option value="${u.username}">${u.username} (OS User)</option>`;
          }
        });
      }
    } catch (e) {
      console.warn('Failed to load OS users:', e);
    }
    osUsersHtml += '<option value="custom">-- Custom Name --</option>';

    let teamOptions = '<option value="">No team restriction</option>';
    try {
      const response = await API.get('/admin/organizations');
      (response.teams || []).forEach(team => {
        teamOptions += `<option value="${team.id}">${team.name} (${team.role})</option>`;
      });
    } catch (e) {
      console.warn('Failed to load teams:', e);
    }

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
            <label>Team restriction</label>
            <select id="gen-team" class="input-field">${teamOptions}</select>
          </div>
          <div class="input-group" style="margin-bottom: 12px;">
            <label>Privilege Role</label>
            <select id="gen-role" class="input-field">
              <option value="viewer">Viewer (read-only)</option>
              <option value="developer">Developer</option>
              <option value="operator">Operator</option>
              <option value="auditor">Auditor</option>
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

        <div class="input-group" style="margin-bottom: 12px;">
          <label style="display: flex; gap: 8px; align-items: center;"><input type="checkbox" id="gen-template" checked> Use the secure permission template for this role</label>
          <small style="color: var(--text-muted);">Turn this off only when you need a custom list of tools.</small>
        </div>

        <div class="input-group" style="margin-bottom: 24px;">
          <label>Allowed IPs (Optional)</label>
          <input type="text" id="gen-ips" class="input-field" placeholder="Empty = all IPs allowed (e.g. 192.168.1.100)">
        </div>
        <div class="input-group" style="margin-bottom: 24px;">
          <label style="display: flex; gap: 8px; align-items: center;"><input type="checkbox" id="gen-approval" checked> Require approval for risky AI actions</label>
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

    const scopesContainer = overlay.querySelector('#gen-scopes-container');
    renderScopeSelector(scopesContainer, [], 'hybrid');

    const roleSelect = overlay.querySelector('#gen-role');
    const templateCheck = overlay.querySelector('#gen-template');

    function updateScopesFromRole() {
      if (templateCheck.checked && roleSelect.value) {
        applyRoleTemplate(scopesContainer, roleSelect.value);
      }
    }

    roleSelect.addEventListener('change', updateScopesFromRole);
    templateCheck.addEventListener('change', updateScopesFromRole);
    // Initial sync
    setTimeout(updateScopesFromRole, 100);

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

      const selectedScopes = getSelectedScopes(overlay.querySelector('#gen-scopes-container'));

      if (!userId) {
        Toast.error('User ID is required');
        return;
      }
      const useTemplate = overlay.querySelector('#gen-template').checked;
      if (!useTemplate && selectedScopes.length === 0) {
        Toast.error('At least one scope must be selected');
        return;
      }

      const payload = {
        key,
        userId,
        role,
        label,
        requireApproval: overlay.querySelector('#gen-approval').checked,
      };
      if (!useTemplate) payload.scopes = selectedScopes;
      const teamId = overlay.querySelector('#gen-team').value;
      if (teamId) payload.teamId = teamId;
      if (ips)
        payload.allowedIPs = ips
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);

      try {
        await API.post('/admin/keys', payload);
        Toast.success('API key generated successfully!');
        document.body.removeChild(overlay);
        loadKeys();
      } catch (err) {
        Toast.error('Failed to generate key: ' + err.message);
      }
    };
  }

  function render(container) {
    rootContainer = container;
    container.innerHTML = `
      <div class="page-header">
        <div><h1>API Keys</h1>
        <p class="page-subtitle">Issue narrowly scoped keys and require approvals.</p></div>
        <div style="display:flex;gap:8px">
          <button id="btn-refresh" class="btn btn-ghost">↻ Refresh</button>
          <button id="btn-generate" class="btn btn-primary">Generate Key</button>
        </div>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>User</th>
              <th>Role</th>
              <th>Scopes</th>
              <th>Created</th>
              <th>Approvals</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="keys-tbody">
            <tr><td colspan="7" style="text-align: center;">Loading...</td></tr>
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
