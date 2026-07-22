// Enterprise fleet, encrypted backup, and signed webhook setup.
(function () {
  function section(title, description) {
    const card = document.createElement('section');
    card.className = 'card';
    const heading = document.createElement('h2'); heading.textContent = title;
    const copy = document.createElement('p'); copy.className = 'text-muted'; copy.textContent = description;
    card.append(heading, copy);
    return card;
  }

  function field(form, label, name, options = {}) {
    const group = document.createElement('label'); group.className = 'input-group';
    const caption = document.createElement('span'); caption.className = 'input-label'; caption.textContent = label;
    const input = document.createElement(options.multiline ? 'textarea' : 'input');
    input.name = name; input.className = 'input-field'; input.required = options.required !== false;
    input.type = options.type || 'text'; input.placeholder = options.placeholder || '';
    group.append(caption, input); form.append(group); return input;
  }

  function list(container, items, fields, empty) {
    container.replaceChildren();
    if (!items.length) { const p = document.createElement('p'); p.className = 'text-muted'; p.textContent = empty; container.append(p); return; }
    for (const item of items) {
      const row = document.createElement('div'); row.className = 'list-item';
      row.textContent = fields.map(key => `${key}: ${item[key] || '—'}`).join(' · ');
      container.append(row);
    }
  }

  window.OperationsPage = {
    async render(container) {
      container.replaceChildren();
      const header = document.createElement('div'); header.className = 'page-header';
      header.innerHTML = '<div><h1>Enterprise Operations</h1><p>Register only trusted destinations. Secrets are encrypted and never shown again.</p></div>';
      container.append(header);

      const fleetCard = section('Sentinel fleet', 'Health checks can only contact hosts allowed by MCP_FLEET_ALLOWED_HOSTS.');
      const fleetForm = document.createElement('form'); fleetForm.className = 'form-grid';
      field(fleetForm, 'Server name', 'name', { placeholder: 'Production API' });
      field(fleetForm, 'Health URL', 'healthUrl', { type: 'url', placeholder: 'https://sentinel.example.com/health' });
      const fleetButton = document.createElement('button'); fleetButton.className = 'btn btn-primary'; fleetButton.textContent = 'Register server'; fleetForm.append(fleetButton);
      const fleetList = document.createElement('div'); fleetCard.append(fleetForm, fleetList); container.append(fleetCard);

      const backupCard = section('Encrypted backups', 'Backups use AES-256-GCM. Local destinations and source files must be allow-listed in server configuration.');
      const backupForm = document.createElement('form'); backupForm.className = 'form-grid';
      field(backupForm, 'Target name', 'name', { placeholder: 'Local encrypted vault' });
      field(backupForm, 'Local destination', 'destination', { placeholder: '/var/lib/mcp-sentinel/backups' });
      const backupButton = document.createElement('button'); backupButton.className = 'btn btn-primary'; backupButton.textContent = 'Add local target'; backupForm.append(backupButton);
      const backupList = document.createElement('div'); backupCard.append(backupForm, backupList); container.append(backupCard);

      const hookCard = section('Signed webhooks', 'A HMAC SHA-256 signature is included on every delivery. The secret is never displayed after saving.');
      const hookForm = document.createElement('form'); hookForm.className = 'form-grid';
      field(hookForm, 'Webhook name', 'name', { placeholder: 'Release notifications' });
      field(hookForm, 'Destination URL', 'url', { type: 'url', placeholder: 'https://hooks.example.com/release' });
      field(hookForm, 'Signing secret', 'secret', { type: 'password', placeholder: 'At least 32 characters' });
      const hookButton = document.createElement('button'); hookButton.className = 'btn btn-primary'; hookButton.textContent = 'Add webhook'; hookForm.append(hookButton);
      const hookList = document.createElement('div'); hookCard.append(hookForm, hookList); container.append(hookCard);

      const refresh = async () => {
        const [fleet, targets, hooks] = await Promise.all([API.get('/admin/fleet'), API.get('/admin/backup-targets'), API.get('/admin/webhooks')]);
        list(fleetList, fleet.servers, ['name', 'healthUrl'], 'No fleet servers are registered.');
        list(backupList, targets.targets, ['name', 'type', 'destination'], 'No backup targets are registered.');
        list(hookList, hooks.webhooks, ['name', 'url'], 'No webhooks are registered.');
      };
      fleetForm.addEventListener('submit', async event => { event.preventDefault(); try { await API.post('/admin/fleet', Object.fromEntries(new FormData(fleetForm))); fleetForm.reset(); await refresh(); Toast.success('Fleet server registered.'); } catch (err) { Toast.error(err.message); } });
      backupForm.addEventListener('submit', async event => { event.preventDefault(); try { const data = Object.fromEntries(new FormData(backupForm)); await API.post('/admin/backup-targets', { ...data, type: 'local' }); backupForm.reset(); await refresh(); Toast.success('Encrypted backup target added.'); } catch (err) { Toast.error(err.message); } });
      hookForm.addEventListener('submit', async event => { event.preventDefault(); try { const data = Object.fromEntries(new FormData(hookForm)); await API.post('/admin/webhooks', { ...data, events: ['deployment.completed'] }); hookForm.reset(); await refresh(); Toast.success('Signed webhook added.'); } catch (err) { Toast.error(err.message); } });
      try { await refresh(); } catch (err) { Toast.error(err.message); }
    },
    destroy() {},
  };
})();
