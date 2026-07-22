(function() {
  let root;
  function copy(text) { navigator.clipboard.writeText(text).then(() => Toast.success('Copied to clipboard.')).catch(() => Toast.error('Could not copy to clipboard.')); }
  async function renderInfo() {
    try {
      const info = await API.get('/admin/connection-info');
      root.querySelector('#mcp-url').textContent = info.mcpUrl;
      const example = { mcpServers: { 'mcp-sentinel': { transport: 'streamable-http', url: info.mcpUrl, headers: { 'X-API-Key': 'YOUR_SCOPED_API_KEY' } } } };
      root.querySelector('#connection-json').textContent = JSON.stringify(example, null, 2);
      root.querySelector('#copy-url').onclick = () => copy(info.mcpUrl);
      root.querySelector('#copy-config').onclick = () => copy(JSON.stringify(example, null, 2));
      const platforms = root.querySelector('#platforms'); platforms.replaceChildren();
      info.platforms.forEach(platform => { const card = document.createElement('article'); card.className = 'card project-card'; const title = document.createElement('h2'); title.textContent = platform.name; const hint = document.createElement('p'); hint.textContent = platform.hint; card.append(title, hint); platforms.appendChild(card); });
    } catch (error) { root.querySelector('#connection-content').textContent = `Unable to load connection details: ${error.message}`; }
  }
  function render(container) {
    root = container;
    root.innerHTML = '<div class="page-header"><div><h1>Connect your AI</h1><p>Use MCP Sentinel with the AI platform you already prefer. Create a scoped key first—never share your owner key.</p></div></div><div id="connection-content"><div class="card"><h2>Secure MCP endpoint</h2><p id="mcp-url" class="connection-url">Loading…</p><button id="copy-url" class="btn btn-ghost">Copy URL</button><p style="margin-top:16px;color:var(--text-secondary)">Use a scoped API key with the minimum role and permissions needed. Enable approval mode for AI agents.</p></div><div class="card" style="margin-top:20px"><div class="card-header"><h2 class="card-title">Generic MCP configuration</h2><button id="copy-config" class="btn btn-ghost">Copy configuration</button></div><pre id="connection-json" class="connection-json"></pre></div><div id="platforms" class="workflow-grid" style="margin-top:20px"></div></div>';
    renderInfo();
  }
  function destroy() { root = null; }
  window.ConnectPage = { render, destroy };
})();
