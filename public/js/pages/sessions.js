(function() {
  let refreshInterval = null;
  let rootContainer = null;

  async function loadSessions() {
    try {
      const response = await window.API.get('/admin/sessions');
      const sessions = Array.isArray(response) ? response : (response.sessions || response.data || []);
      renderTable(sessions);
    } catch (err) {
      if (window.Toast) window.Toast.error('Failed to load sessions: ' + err.message);
    }
  }

  function formatTimeAgo(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr > 0) return `${diffHr}h ${diffMin % 60}m ago`;
    if (diffMin > 0) return `${diffMin}m ago`;
    return `${diffSec}s ago`;
  }

  function getAgeColor(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffHr = (now - date) / (1000 * 60 * 60);
    if (diffHr < 1) return 'green';
    if (diffHr <= 4) return 'amber'; // or #ffbf00
    return 'red';
  }

  function renderTable(sessions) {
    const tableBody = rootContainer.querySelector('#sessions-tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    
    if (sessions.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.style.textAlign = 'center';
      td.textContent = 'No active sessions';
      tr.appendChild(td);
      tableBody.appendChild(tr);
      return;
    }

    sessions.forEach(session => {
      const tr = document.createElement('tr');
      
      const tdId = document.createElement('td');
      tdId.textContent = session.id ? session.id.substring(0, 8) : 'N/A';
      
      const tdUser = document.createElement('td');
      tdUser.textContent = session.userId || session.user || 'Unknown';
      
      const tdRole = document.createElement('td');
      const roleBadge = document.createElement('span');
      roleBadge.className = 'badge ' + (session.role === 'admin' ? 'badge-admin' : 'badge-user');
      roleBadge.textContent = session.role || 'user';
      tdRole.appendChild(roleBadge);
      
      const tdIp = document.createElement('td');
      tdIp.textContent = session.ip || 'N/A';
      
      const tdConnected = document.createElement('td');
      tdConnected.textContent = new Date(session.connectedAt || Date.now()).toLocaleString();
      tdConnected.style.color = getAgeColor(session.connectedAt || Date.now());
      
      const tdActive = document.createElement('td');
      tdActive.textContent = formatTimeAgo(session.lastActive || session.connectedAt || Date.now());
      
      const tdActions = document.createElement('td');
      const btnDisconnect = document.createElement('button');
      btnDisconnect.className = 'btn btn-danger btn-sm';
      btnDisconnect.textContent = 'Disconnect';
      btnDisconnect.onclick = () => disconnectSession(session.id);
      tdActions.appendChild(btnDisconnect);
      
      tr.appendChild(tdId);
      tr.appendChild(tdUser);
      tr.appendChild(tdRole);
      tr.appendChild(tdIp);
      tr.appendChild(tdConnected);
      tr.appendChild(tdActive);
      tr.appendChild(tdActions);
      
      tableBody.appendChild(tr);
    });
  }

  async function disconnectSession(sessionId) {
    try {
      await window.API.del('/admin/sessions/' + sessionId);
      if (window.Toast) window.Toast.success('Session disconnected');
      loadSessions();
    } catch (err) {
      if (window.Toast) window.Toast.error('Failed to disconnect session: ' + err.message);
    }
  }

  async function disconnectAllSessions() {
    try {
      await window.API.del('/admin/sessions');
      if (window.Toast) window.Toast.success('All sessions disconnected');
      loadSessions();
    } catch (err) {
      if (window.Toast) window.Toast.error('Failed to disconnect all sessions: ' + err.message);
    }
  }

  function showModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal-title">Disconnect All Sessions</h3>
        <p>Are you sure you want to disconnect all active sessions?</p>
        <div class="modal-actions" style="margin-top: 20px; text-align: right;">
          <button class="btn btn-ghost" id="btn-cancel">Cancel</button>
          <button class="btn btn-danger" id="btn-confirm">Disconnect All</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#btn-cancel').onclick = () => {
      document.body.removeChild(overlay);
    };
    overlay.querySelector('#btn-confirm').onclick = async () => {
      document.body.removeChild(overlay);
      await disconnectAllSessions();
    };
  }

  function render(container) {
    rootContainer = container;
    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2>Active Sessions</h2>
        <button id="btn-disconnect-all" class="btn btn-danger">Disconnect All</button>
      </div>
      <div class="card">
        <table class="data-table" style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr>
              <th>Session ID</th>
              <th>User</th>
              <th>Role</th>
              <th>IP</th>
              <th>Connected At</th>
              <th>Last Active</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="sessions-tbody">
            <tr><td colspan="7" style="text-align: center;">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    `;

    container.querySelector('#btn-disconnect-all').addEventListener('click', showModal);

    loadSessions();
    refreshInterval = setInterval(loadSessions, 10000);
  }

  function destroy() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
    rootContainer = null;
  }

  window.SessionsPage = { render, destroy };
})();
