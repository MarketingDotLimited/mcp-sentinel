import { API } from '../api.js';
import { Toast } from '../toast.js';

(function () {
  let root = null;
  let refreshTimer = null;
  let policies = null;

  const booleanColumns = ['sshAllowed', 'sshEnabled'];

  function asListValue(value) {
    if (Array.isArray(value)) return value.join(', ');
    return value == null ? '' : String(value);
  }

  async function saveTargetPolicy(payload) {
    try {
      if (payload.sshAllowed === true || payload.sshEnabled === true) payload.confirm = true;
      await API.put('/admin/ssh-access', payload);
      Toast.success('SSH policy updated');
      await loadPolicies();
    } catch (error) {
      Toast.error(error.message);
    }
  }

  function renderIdentityPolicy(policy) {
    const panel = document.createElement('div');
    panel.className = 'card';
    const title = document.createElement('h2');
    title.textContent = 'Global SSH policy';
    const detail = document.createElement('p');
    detail.textContent = 'Global ceiling for all SSH policy layers.';
    const fields = document.createElement('div');
    fields.className = 'project-card';
    fields.style.display = 'grid';
    fields.style.gridTemplateColumns = '1fr auto auto';
    fields.style.gap = '8px';
    const label = document.createElement('div');
    label.innerHTML = '<strong>Target</strong><div>global</div>';
    fields.appendChild(label);

    fields.appendChild(renderBooleanCell(policy || {}));
    panel.append(title, detail, fields);
    return panel;

    function renderBooleanCell(row) {
      const wrapper = document.createElement('div');
      booleanColumns.forEach(key => {
        const rowWrap = document.createElement('label');
        rowWrap.className = 'checkbox-label';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = row[key] === true;
        input.onchange = () =>
          saveTargetPolicy({
            targetType: 'global',
            [key]: input.checked,
          });
        rowWrap.textContent = ` ${key}`;
        rowWrap.prepend(input);
        wrapper.appendChild(rowWrap);
      });
      return wrapper;
    }
  }

  function renderScopedPolicyRows(items, title, describeRow, buildPayload) {
    const wrapper = document.createElement('div');
    wrapper.className = 'card';
    const heading = document.createElement('h2');
    heading.textContent = title;
    wrapper.appendChild(heading);
    if (!items.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No policy records are registered yet.';
      wrapper.appendChild(empty);
      return wrapper;
    }

    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Target</th>
          <th>sshAllowed</th>
          <th>sshEnabled</th>
          <th>Save</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const body = table.querySelector('tbody');

    items.forEach(item => {
      const row = document.createElement('tr');
      const targetCell = document.createElement('td');
      targetCell.textContent = describeRow(item);
      row.appendChild(targetCell);

      const checkboxState = { ...item };
      booleanColumns.forEach(key => {
        const td = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = item[key] === true;
        input.onchange = () => (checkboxState[key] = input.checked);
        td.appendChild(input);
        row.appendChild(td);
      });

      const action = document.createElement('td');
      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn btn-primary';
      saveBtn.textContent = 'Save';
      saveBtn.onclick = () => saveTargetPolicy(buildPayload(item, checkboxState));
      action.appendChild(saveBtn);
      row.appendChild(action);
      body.appendChild(row);
    });

    wrapper.appendChild(table);
    return wrapper;
  }

  function renderPolicyRows(title, items, describeRow, buildPayload) {
    const wrapper = document.createElement('div');
    wrapper.className = 'card';
    const heading = document.createElement('h2');
    heading.textContent = title;
    wrapper.appendChild(heading);
    if (!items.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No policy records are registered yet.';
      wrapper.appendChild(empty);
      return wrapper;
    }

    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Target</th>
          <th>sshAllowed</th>
          <th>sshEnabled</th>
          <th>Save</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const body = table.querySelector('tbody');

    items.forEach(item => {
      const row = document.createElement('tr');
      const targetCell = document.createElement('td');
      targetCell.textContent = describeRow(item);
      row.appendChild(targetCell);

      const checkboxState = { ...item };
      booleanColumns.forEach(key => {
        const td = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = item[key] === true;
        input.onchange = () => (checkboxState[key] = input.checked);
        td.appendChild(input);
        row.appendChild(td);
      });

      const action = document.createElement('td');
      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn btn-primary';
      saveBtn.textContent = 'Save';
      saveBtn.onclick = () => saveTargetPolicy(buildPayload(item, checkboxState));
      action.appendChild(saveBtn);
      row.appendChild(action);
      body.appendChild(row);
    });

    wrapper.appendChild(table);
    return wrapper;
  }

  function renderIdentitySection(policiesByType) {
    const identities = (policiesByType.identities || []).map(item => ({
      ...item,
      _identityLabel: `${item.identityType} ${item.userId || item.keyId || ''} ${asListValue(item.issuer)} ${asListValue(item.subject)}`,
    }));
    return renderPolicyRows(
      'OAuth/user Identity Policies',
      identities.map(item => ({ ...item, _type: 'identity', _id: item.id })),
      item => item._identityLabel.trim() || item.id,
      (item, values) => ({
        targetType: 'identity',
        userId: item.userId || undefined,
        keyId: item.keyId || undefined,
        ...(item.issuer ? { authType: 'oauth', issuer: item.issuer } : {}),
        ...(item.subject ? { subject: item.subject } : {}),
        ...pickBoolean(values),
      })
    );
  }

  function renderOAuthClientSection(clientPolicies) {
    return renderPolicyRows(
      'OAuth Client Ceiling Policies',
      clientPolicies.map(item => ({ ...item, _type: 'oauth-client', _id: item.id })),
      item => item.clientId + (item.issuer ? ` (${item.issuer})` : ''),
      (item, values) => ({
        targetType: 'oauth-client',
        issuer: item.issuer,
        clientId: item.clientId,
        ...pickBoolean(values),
      })
    );
  }

  function renderSubjectClientSection(subjectPolicies) {
    return renderPolicyRows(
      'OAuth Subject-Client Policies',
      subjectPolicies.map(item => ({ ...item, _id: item.id })),
      item => `${item.subject} @ ${item.clientId} (${item.issuer})`,
      (item, values) => ({
        targetType: 'subject-client',
        issuer: item.issuer,
        subject: item.subject,
        clientId: item.clientId,
        ...pickBoolean(values),
      })
    );
  }

  function renderProjectSection(projects) {
    return renderPolicyRows(
      'Project Policies',
      projects.map(item => ({ ...item, _type: 'project', _id: item.id })),
      item => `${item.name || item.id} (${item.id})`,
      (item, values) => ({
        targetType: 'project',
        targetId: item.id,
        ...pickBoolean(values),
      })
    );
  }

  function renderConnectionSection(connections) {
    return renderPolicyRows(
      'Connection Policies',
      connections.map(item => ({ ...item, _type: 'connection', _id: item.id })),
      item => `${item.name || item.id} (${item.hostId || 'no host'})`,
      (item, values) => ({
        targetType: 'connection',
        targetId: item.id,
        ...pickBoolean(values),
      })
    );
  }

  function renderHostSection(hosts) {
    return renderPolicyRows(
      'SSH Host Policies',
      hosts.map(item => ({ ...item, _type: 'host', _id: item.id })),
      item => `${item.address || item.name || item.id} (${item.id})`,
      (item, values) => ({
        targetType: 'host',
        targetId: item.id,
        ...pickBoolean(values),
      })
    );
  }

  function addPolicyForm() {
    const wrapper = document.createElement('div');
    wrapper.className = 'card';
    const heading = document.createElement('h2');
    heading.textContent = 'Create or modify a policy quickly';
    const subtitle = document.createElement('p');
    subtitle.textContent = 'Use this for a specific identity/client/connection/project/host policy that is not listed above.';
    const form = document.createElement('form');
    form.className = 'project-card';
    form.innerHTML = `
      <label for="target-type">Target Type</label>
      <select id="target-type">
        <option value="identity">identity (userId)</option>
        <option value="identity-key">identity (keyId)</option>
        <option value="oauth-client">oauth-client</option>
        <option value="subject-client">subject-client</option>
        <option value="connection">connection</option>
        <option value="project">project</option>
        <option value="host">host</option>
        <option value="organization">organization</option>
        <option value="team">team</option>
      </select>
      <input id="target-id" placeholder="Target ID / userId / keyId / clientId / subject" class="input-field" />
      <input id="target-extra" placeholder="issuer / subject / keyId (as required by target)" class="input-field" />
      <label class="checkbox-label"><input id="new-ssh-allowed" type="checkbox" /> sshAllowed</label>
      <label class="checkbox-label"><input id="new-ssh-enabled" type="checkbox" /> sshEnabled</label>
      <button id="save-new-policy" class="btn btn-primary" type="submit">Save policy</button>
    `;
    form.style.display = 'grid';
    form.style.gap = '8px';
    form.style.gridTemplateColumns = '1fr';

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const targetType = form.querySelector('#target-type').value;
      const targetId = form.querySelector('#target-id').value.trim();
      const targetExtra = form.querySelector('#target-extra').value.trim();
      const payload = {
        targetType,
        sshAllowed: form.querySelector('#new-ssh-allowed').checked,
        sshEnabled: form.querySelector('#new-ssh-enabled').checked,
      };
      if (payload.sshAllowed || payload.sshEnabled) payload.confirm = true;
      if (!targetId) {
        Toast.error('Target ID / key is required.');
        return;
      }
      if (targetType === 'identity') {
        payload.userId = targetId;
      } else if (targetType === 'identity-key') {
        payload.keyId = targetId;
      } else if (targetType === 'oauth-client') {
        payload.clientId = targetId;
        payload.issuer = targetExtra;
      } else if (targetType === 'subject-client') {
        const [subject, clientId] = targetId.split(':');
        if (!subject || !clientId) {
          Toast.error('Use "subject:clientId" in target field for subject-client.');
          return;
        }
        payload.subject = subject;
        payload.clientId = clientId;
        payload.issuer = targetExtra;
      } else {
        payload.targetId = targetId;
        if (targetType === 'organization' || targetType === 'team') payload.targetId = targetId;
      }
      try {
        await saveTargetPolicy(payload);
        form.reset();
      } catch {}
    });

    wrapper.append(heading, subtitle, form);
    return wrapper;
  }

  function pickBoolean(values) {
    return booleanColumns.reduce((acc, key) => {
      if (typeof values[key] === 'boolean') acc[key] = values[key];
      return acc;
    }, {});
  }

  async function loadPolicies() {
    const list = root.querySelector('#ssh-policy-list');
    if (!list) return;
    try {
      policies = await API.get('/admin/ssh-access');
      list.replaceChildren();
      const version = document.createElement('p');
      version.style.opacity = '0.8';
      version.textContent = `SSH policy version: ${policies.sshPolicyVersion || 0}`;
      list.appendChild(version);
      list.appendChild(renderIdentityPolicy((policies.globalAndScoped || []).find(item => item.id === 'global') || {}));
      list.appendChild(renderHostSection(policies.hosts || []));
      list.appendChild(renderConnectionSection(policies.connections || []));
      list.appendChild(renderProjectSection(policies.projects || []));
      list.appendChild(
        renderScopedPolicyRows(
          (policies.globalAndScoped || []).filter(item => item.id !== 'global'),
          'Organization and Team Policies',
          item => `${item.id} (${item.scopeType || 'scoped'})`,
          item => ({
            targetType: item.scopeType === 'organization' ? 'organization' : item.scopeType === 'team' ? 'team' : item.scopeType,
            targetId: item.scopeId || item.id,
            ...pickBoolean({ sshAllowed: item.sshAllowed, sshEnabled: item.sshEnabled }),
          })
        )
      );
      list.appendChild(renderIdentitySection({
        identities: policies.identities || [],
      }));
      list.appendChild(renderOAuthClientSection(policies.oauthClients || []));
      list.appendChild(renderSubjectClientSection(policies.subjectClients || []));
      list.appendChild(addPolicyForm());
    } catch (error) {
      list.textContent = `Unable to load SSH policy records: ${error.message}`;
    }
  }

  function render(container) {
    root = container;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1>SSH Access Control</h1>
          <p class="page-subtitle">Set SSH ceilings and enablement per global policy, host, connection, project, identity, or client.</p>
        </div>
      </div>
      <div id="ssh-policy-list" class="workflow-grid"></div>
    `;
    loadPolicies();
    refreshTimer = setInterval(loadPolicies, 20_000);
  }

  function destroy() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    root = null;
  }

  window.SshAccessPage = { render, destroy };
})();
