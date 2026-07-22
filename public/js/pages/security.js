(function() {
  let root;
  function renderCheck(check) { const item = document.createElement('article'); item.className = `card security-check ${check.status}`; const title = document.createElement('h2'); title.textContent = check.id.replaceAll('-', ' '); const message = document.createElement('p'); message.textContent = check.message; item.append(title, message); return item; }
  async function load() { const content = root.querySelector('#security-content'); try { const report = await API.get('/admin/security-posture'); root.querySelector('#security-score').textContent = `${report.score}/100`; root.querySelector('#security-status').textContent = report.status.replaceAll('-', ' '); const checks = root.querySelector('#security-checks'); checks.replaceChildren(...report.checks.map(renderCheck)); } catch (error) { content.textContent = `Unable to load security posture: ${error.message}`; } }
  function render(container) { root = container; root.innerHTML = '<div class="page-header"><div><h1>Security posture</h1><p>Plain-language checks for the controls protecting your AI, server, and users.</p></div><button class="btn btn-ghost" id="refresh-security">Refresh</button></div><div id="security-content"><div class="card"><h2 id="security-score">Checking…</h2><p id="security-status">Reviewing controls</p></div><div id="security-checks" class="workflow-grid" style="margin-top:20px"></div></div>'; root.querySelector('#refresh-security').onclick = load; load(); }
  function destroy() { root = null; }
  window.SecurityPage = { render, destroy };
})();
