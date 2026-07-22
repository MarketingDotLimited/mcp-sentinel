import { API } from '../api.js';
import { Toast } from '../toast.js';
import { Router } from '../router.js';
(function () {
  let root;

  function showApproval(item) {
    const row = document.createElement('tr');
    for (const text of [item.summary, item.requestedBy.userId, item.risk, new Date(item.createdAt).toLocaleString()]) {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.appendChild(cell);
    }
    const actions = document.createElement('td');
    if (item.status === 'pending') {
      for (const [label, decision, style] of [
        ['Approve', 'approved', 'btn-primary'],
        ['Reject', 'rejected', 'btn-danger'],
      ]) {
        const button = document.createElement('button');
        button.className = `btn ${style} btn-sm`;
        button.textContent = label;
        button.onclick = async () => {
          try {
            await API.post(`/admin/approvals/${encodeURIComponent(item.id)}`, { decision });
            Toast.success(`Request ${decision}.`);
            load();
          } catch (error) {
            Toast.error(error.message);
          }
        };
        actions.appendChild(button);
      }
    } else {
      actions.textContent = item.status;
    }
    row.appendChild(actions);
    return row;
  }

  async function load() {
    const body = root.querySelector('tbody');
    try {
      const { approvals } = await API.get('/admin/approvals?includeResolved=true');
      body.replaceChildren();
      if (!approvals.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 5;
        cell.textContent = 'No approval requests yet.';
        row.appendChild(cell);
        body.appendChild(row);
      } else approvals.forEach(item => body.appendChild(showApproval(item)));
    } catch (error) {
      body.innerHTML = `<tr><td colspan="5">Unable to load approvals: ${error.message}</td></tr>`;
    }
  }

  function render(container) {
    root = container;
    root.innerHTML =
      '<div class="page-header"><div><h1>Approvals</h1><p>Review AI-requested changes before they run. Approved requests are single-use and expire after 24 hours.</p></div><button class="btn btn-ghost" id="refresh-approvals">Refresh</button></div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Requested change</th><th>Requested by</th><th>Risk</th><th>Created</th><th>Decision</th></tr></thead><tbody><tr><td colspan="5">Loading…</td></tr></tbody></table></div>';
    root.querySelector('#refresh-approvals').onclick = load;
    load();
  }

  function destroy() {
    root = null;
  }
  window.ApprovalsPage = { render, destroy };
})();
