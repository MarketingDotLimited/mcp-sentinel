import { API } from '../api.js';
import { Toast } from '../toast.js';
import { Router } from '../router.js';
(function () {
  let root;

  function makeWorkflowCard(workflow) {
    const card = document.createElement('article');
    card.className = 'card workflow-card';
    const title = document.createElement('h2');
    title.textContent = workflow.title;
    const description = document.createElement('p');
    description.className = 'workflow-description';
    description.textContent = workflow.description;
    const risk = document.createElement('span');
    risk.className = `badge badge-${workflow.risk === 'read-only' ? 'success' : 'warning'}`;
    risk.textContent = workflow.risk === 'read-only' ? 'Safe to start' : 'Approval before changes';
    const list = document.createElement('ul');
    list.className = 'workflow-steps';
    workflow.prompts.forEach(prompt => {
      const item = document.createElement('li');
      item.textContent = prompt;
      list.appendChild(item);
    });
    const button = document.createElement('button');
    button.className = 'btn btn-primary';
    button.textContent = 'Copy AI prompt';
    button.onclick = async () => {
      const prompt = `Use MCP Sentinel to help me: ${workflow.title}. ${workflow.prompts.join('. ')}. Explain the plan in plain language and do not make changes without my confirmation.`;
      try {
        await navigator.clipboard.writeText(prompt);
        Toast.success('A safe prompt is ready to paste into your AI platform.');
      } catch {
        Toast.error('Could not copy the prompt.');
      }
    };
    card.append(title, risk, description, list, button);
    return card;
  }

  async function renderWorkflows() {
    const grid = root.querySelector('#workflow-grid');
    try {
      const { workflows } = await API.get('/admin/workflows');
      grid.replaceChildren(...workflows.map(makeWorkflowCard));
    } catch (error) {
      grid.textContent = `Unable to load guided tasks: ${error.message}`;
    }
  }

  function render(container) {
    root = container;
    root.innerHTML =
      '<div class="page-header"><div><h1>Guided Tasks</h1><p>Start safely with your preferred AI platform. Sentinel keeps control of permissions and approvals.</p></div></div><div id="workflow-grid" class="workflow-grid"><div class="card">Loading guided tasks…</div></div>';
    renderWorkflows();
  }

  function destroy() {
    root = null;
  }
  window.WorkflowsPage = { render, destroy };
})();
