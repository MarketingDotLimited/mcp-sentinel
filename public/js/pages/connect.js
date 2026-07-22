// Plain-language onboarding for every supported MCP client.
(function () {
  let root;
  const docs = {
    chatgpt: 'https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta',
    claude: 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp',
    claudeCode: 'https://docs.anthropic.com/en/docs/claude-code/mcp',
    codex: 'https://developers.openai.com/codex/mcp',
    antigravity: 'https://antigravity.google/docs/mcp',
  };

  function copy(text) {
    navigator.clipboard.writeText(text).then(() => Toast.success('Copied. Keep keys in a secret store, never in source control.')).catch(() => Toast.error('Could not copy to clipboard.'));
  }

  function codeBlock(title, code) {
    const wrapper = document.createElement('div'); wrapper.className = 'connect-code';
    const header = document.createElement('div'); header.className = 'card-header';
    const heading = document.createElement('h3'); heading.className = 'card-title'; heading.textContent = title;
    const button = document.createElement('button'); button.className = 'btn btn-ghost btn-sm'; button.textContent = 'Copy'; button.onclick = () => copy(code);
    header.append(heading, button);
    const pre = document.createElement('pre'); pre.className = 'connection-json'; pre.textContent = code;
    wrapper.append(header, pre); return wrapper;
  }

  function numbered(items) {
    const list = document.createElement('ol'); list.className = 'connect-steps';
    items.forEach(item => { const li = document.createElement('li'); li.textContent = item; list.append(li); });
    return list;
  }

  function platformCard({ title, badge, description, steps, code, codeTitle, learnMore, warning }) {
    const card = document.createElement('article'); card.className = 'card connect-platform';
    const heading = document.createElement('h2'); heading.textContent = title;
    const tag = document.createElement('span'); tag.className = 'badge badge-info'; tag.textContent = badge;
    const body = document.createElement('p'); body.textContent = description;
    card.append(heading, tag, body, numbered(steps));
    if (warning) { const note = document.createElement('p'); note.className = 'connect-warning'; note.textContent = warning; card.append(note); }
    if (code) card.append(codeBlock(codeTitle, code));
    const link = document.createElement('a'); link.className = 'btn btn-ghost btn-sm'; link.href = learnMore; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open official setup guide ↗'; card.append(link);
    return card;
  }

  function renderContent(info) {
    const endpoint = info.mcpUrl;
    const key = 'YOUR_SCOPED_API_KEY';
    const generic = JSON.stringify({ mcpServers: { 'mcp-sentinel': { transport: 'streamable-http', url: endpoint, headers: { 'X-API-Key': key } } } }, null, 2);
    const claudeCode = `claude mcp add --transport http mcp-sentinel "${endpoint}" \\\n+  --header "X-API-Key: ${key}"\n\nclaude mcp get mcp-sentinel`;
    const codex = `export MCP_SENTINEL_API_KEY='${key}'\ncodex mcp add mcp-sentinel --url "${endpoint}" \\\n+  --bearer-token-env-var MCP_SENTINEL_API_KEY\ncodex mcp get mcp-sentinel`;
    const antigravity = JSON.stringify({ mcpServers: { 'mcp-sentinel': { serverUrl: endpoint, headers: { 'X-API-Key': key } } } }, null, 2);
    const safePrompt = 'Use MCP Sentinel to inspect server health only. Explain findings in plain language. Do not make any changes, do not use write tools, and ask for my confirmation before proposing a fix.';

    root.replaceChildren();
    const header = document.createElement('div'); header.className = 'page-header';
    header.innerHTML = '<div><h1>Connect your AI</h1><p>A guided, secure bridge between your AI and the servers or projects you choose to manage.</p></div>';
    root.append(header);

    const status = document.createElement('div'); status.className = `connect-readiness ${info.readiness.cloudConnectorReady ? 'is-ready' : 'is-warning'}`;
    const statusTitle = document.createElement('strong'); statusTitle.textContent = info.readiness.cloudConnectorReady ? 'Cloud connector readiness: configured' : 'Cloud connector readiness: needs setup';
    const statusText = document.createElement('span'); statusText.textContent = info.readiness.cloudConnectorMessage;
    status.append(statusTitle, statusText); root.append(status);

    const why = document.createElement('section'); why.className = 'card';
    why.innerHTML = '<h2>What this does — and why it is safer</h2><p>MCP Sentinel gives an AI a controlled way to inspect servers, develop software, and automate work. The AI never receives unrestricted shell access: every request reaches Sentinel first.</p><div class="connect-flow"><div><strong>1. Ask naturally</strong><span>You ask your AI to check, build, deploy, or automate.</span></div><div><strong>2. Sentinel decides</strong><span>Roles, scopes, policy, team limits, and approval rules are checked.</span></div><div><strong>3. Act or explain</strong><span>Safe actions run; risky actions wait for confirmation or approval.</span></div><div><strong>4. Audit remains</strong><span>Results and security events are recorded for review.</span></div></div>';
    root.append(why);

    const start = document.createElement('section'); start.className = 'card';
    const startTitle = document.createElement('h2'); startTitle.textContent = 'Before you connect any AI';
    start.append(startTitle, numbered([
      'Use HTTPS for every remote connection. Cloud AI services cannot safely reach a private or HTTP-only server.',
      'Create one scoped API key per person or AI platform in API Keys. Start with Viewer or Developer, not Administrator.',
      'Turn on “Require approval for risky AI actions” for every agent that can change systems.',
      'Connect one platform, run the safe test prompt below, then expand permissions only when needed.',
    ]), codeBlock('Safe first prompt (paste into any connected AI)', safePrompt));
    root.append(start);

    const auth = document.createElement('section'); auth.className = 'card';
    auth.innerHTML = '<h2>Authentication: choose the right path</h2><p><strong>CLI and desktop developer tools:</strong> use a dedicated, scoped Sentinel API key. They can send a protected header or bearer token directly.</p><p><strong>ChatGPT and Claude cloud connectors:</strong> use a public HTTPS endpoint and OAuth/OIDC. Cloud services connect from their own infrastructure, so they must never depend on your private laptop network or a raw owner key pasted into a chat.</p><p>Sentinel validates configured OIDC tokens when <code>AUTHELIA_ISSUER</code> and <code>AUTHELIA_JWKS_URL</code> are set. If those are not configured, the readiness banner stays in warning mode on purpose.</p>';
    const oauthLink = document.createElement('a'); oauthLink.href = '#/oauth'; oauthLink.className = 'btn btn-ghost btn-sm'; oauthLink.textContent = 'Open OAuth & Access'; auth.append(oauthLink); root.append(auth);

    const endpointCard = document.createElement('section'); endpointCard.className = 'card';
    const endpointTitle = document.createElement('h2'); endpointTitle.textContent = 'Your Sentinel endpoint';
    const url = document.createElement('p'); url.className = 'connection-url'; url.textContent = endpoint;
    const copyUrl = document.createElement('button'); copyUrl.className = 'btn btn-ghost'; copyUrl.textContent = 'Copy endpoint'; copyUrl.onclick = () => copy(endpoint);
    endpointCard.append(endpointTitle, url, copyUrl, codeBlock('Generic remote MCP configuration', generic)); root.append(endpointCard);

    const guideTitle = document.createElement('h2'); guideTitle.className = 'section-title'; guideTitle.textContent = 'Choose your AI platform'; root.append(guideTitle);
    const platforms = document.createElement('div'); platforms.className = 'connect-platform-grid';
    platforms.append(
      platformCard({ title: 'ChatGPT (web)', badge: 'Cloud connector · OAuth/OIDC', description: 'Use this for a company ChatGPT workspace. ChatGPT connects from the cloud, so it needs a public HTTPS Sentinel URL and an OAuth/OIDC setup—not a pasted owner key.', steps: ['Ask a workspace admin to enable Developer mode in Settings → Apps / Advanced settings.', 'Open Apps → Create and enter the Sentinel endpoint above.', 'Choose the OAuth/OIDC authentication option and complete the configuration supplied by your identity provider.', 'Scan tools, keep write tools disabled until tested, then create or publish the app.', 'Start a chat, enable the app, and paste the safe first prompt.'], warning: 'If the readiness banner says “needs setup”, use a CLI first or finish public HTTPS and OAuth/OIDC before adding ChatGPT.', learnMore: docs.chatgpt }),
      platformCard({ title: 'Claude (web)', badge: 'Cloud connector · OAuth/OIDC', description: 'Claude web can use a remote custom connector. The connection originates from Anthropic’s cloud, so your endpoint must be publicly reachable over HTTPS.', steps: ['Open Claude → Customize → Connectors.', 'Choose Add custom connector and paste the Sentinel endpoint.', 'Complete OAuth/OIDC authentication; do not attempt to paste an API key into chat.', 'Enable only the Sentinel tools needed in this conversation.', 'Use the safe first prompt, then review every approval request.'], warning: 'Team and Enterprise workspaces require an Owner to add the organization connector first.', learnMore: docs.claude }),
      platformCard({ title: 'Claude Desktop', badge: 'Remote connector · OAuth/OIDC', description: 'For a remote Sentinel server, use the same Settings → Connectors flow as Claude web. The desktop app brokers remote connectors through your Claude account.', steps: ['Open Claude Desktop → Settings → Connectors.', 'Add Sentinel as a custom remote connector with the endpoint above.', 'Complete OAuth/OIDC authentication and enable the connector for a chat.', 'Use the safe first prompt and leave risky tools approval-gated.'], warning: 'Do not add this remote URL to claude_desktop_config.json; Anthropic documents Settings → Connectors as the remote setup path.', learnMore: docs.claude }),
      platformCard({ title: 'Claude Code CLI', badge: 'Remote HTTP · scoped header', description: 'Best for developers who want Sentinel beside their repository workflow. Claude Code can send Sentinel’s scoped API-key header directly.', steps: ['Create a Developer or Viewer key in API Keys; keep approval enabled.', 'Run the command below in a terminal. Replace only the key placeholder.', 'Run claude mcp get mcp-sentinel to confirm it is installed.', 'Start Claude Code and ask for the safe first prompt.'], code: claudeCode, codeTitle: 'Terminal command', learnMore: docs.claudeCode }),
      platformCard({ title: 'Codex CLI', badge: 'Remote HTTP · bearer environment variable', description: 'Codex CLI uses a bearer-token environment variable for remote MCP. Sentinel accepts a scoped Sentinel API key in that bearer slot.', steps: ['Create a dedicated Developer or Viewer key. Do not reuse it across people or platforms.', 'Put the key in a shell secret manager or protected environment variable.', 'Run the command below, then check codex mcp get mcp-sentinel.', 'Open a new Codex session and ask for the safe first prompt.'], code: codex, codeTitle: 'Terminal command', learnMore: docs.codex }),
      platformCard({ title: 'Antigravity CLI / IDE', badge: 'Remote HTTP · JSON configuration', description: 'Antigravity uses a remote serverUrl plus custom headers. You can use the interactive /mcp manager or edit the MCP configuration file directly.', steps: ['Create a dedicated scoped key with approvals enabled.', 'Open /mcp to manage servers, or edit ~/.gemini/config/mcp_config.json globally.', 'For only one project, use .agents/mcp_config.json in that workspace.', 'Merge the configuration below with existing entries, then reload the MCP manager.'], code: antigravity, codeTitle: 'mcp_config.json entry', learnMore: docs.antigravity }),
      platformCard({ title: 'Any other MCP-capable tool', badge: 'Standard Streamable HTTP', description: 'Use the generic configuration above. Most tools accept a URL and custom header; bearer-only tools can send the scoped Sentinel key as Authorization: Bearer.', steps: ['Find “MCP”, “Connectors”, or “Tools” in the AI platform settings.', 'Choose Remote / Streamable HTTP and paste the Sentinel endpoint.', 'Use X-API-Key when custom headers are supported; otherwise use the scoped key as the bearer credential.', 'Verify with the safe first prompt before allowing any changes.'], learnMore: 'https://modelcontextprotocol.io/' }),
    );
    root.append(platforms);

    const help = document.createElement('section'); help.className = 'card';
    help.innerHTML = '<h2>Understand permissions before saying “yes”</h2><ul class="connect-faq"><li><strong>Viewer:</strong> safe inspection and project information.</li><li><strong>Developer:</strong> code, repositories, tests, and deployment planning; use approvals for changes.</li><li><strong>Operator:</strong> approved service and configuration operations; keep approvals on.</li><li><strong>Administrator:</strong> full control. Reserve it for owners and emergency recovery—not everyday AI use.</li><li><strong>Approval required:</strong> Sentinel stores the exact risky request, an administrator reviews it, and the approval is single-use.</li></ul><p>If a connection fails, check HTTPS/public reachability for cloud apps, verify the key is active and scoped correctly for CLI apps, and inspect Audit Logs for the exact denial reason.</p>';
    root.append(help);
  }

  async function render(container) {
    root = container;
    root.textContent = 'Loading your AI connection guide…';
    try { renderContent(await API.get('/admin/connection-info')); }
    catch (error) { root.textContent = `Unable to load connection details: ${error.message}`; }
  }
  function destroy() { root = null; }
  window.ConnectPage = { render, destroy };
})();
