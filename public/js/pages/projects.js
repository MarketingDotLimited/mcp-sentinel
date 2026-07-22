import { API } from "../api.js";
import { Toast } from "../toast.js";
import { Router } from "../router.js";
(function () {
  let root;

  async function load() {
    const list = root.querySelector('#project-list');
    try {
      const { projects } = await API.get('/admin/projects');
      list.replaceChildren();
      if (!projects.length) {
        list.textContent = 'No projects yet. Add a repository that is already permitted in GIT_ALLOWED_REPOS.';
        return;
      }
      projects.forEach(project => {
        const card = document.createElement('article');
        card.className = 'card project-card';
        const title = document.createElement('h2');
        title.textContent = project.name;
        const detail = document.createElement('p');
        detail.textContent = `${project.environment} · ${project.repoPath}`;
        const description = document.createElement('p');
        description.textContent = project.description || 'No description provided.';
        const prompt = document.createElement('button');
        prompt.className = 'btn btn-ghost';
        prompt.textContent = 'Copy deployment prompt';
        prompt.onclick = async () => {
          const text = `Use MCP Sentinel to plan a safe deployment for project ${project.name} (ID: ${project.id}). Inspect first, run tests, explain the plan, request approval for production changes, and verify health after deployment.`;
          try {
            await navigator.clipboard.writeText(text);
            Toast.success('Deployment prompt copied.');
          } catch {
            Toast.error('Could not copy the prompt.');
          }
        };
        card.append(title, detail, description, prompt);
        list.appendChild(card);
      });
    } catch (error) {
      list.textContent = `Unable to load projects: ${error.message}`;
    }
  }

  function render(container) {
    root = container;
    root.innerHTML =
      '<div class="page-header"><div><h1>Developer Work</h1><p>Register approved repositories so any AI platform can inspect, build, test, and plan releases safely.</p></div></div><div class="card"><form id="project-form" class="project-form"><input class="input-field" name="name" placeholder="Project name" required><input class="input-field" name="repoPath" placeholder="Allowed repository path, e.g. /srv/my-app" required><select class="input-field" name="environment"><option value="development">Development</option><option value="staging">Staging</option><option value="production">Production</option></select><input class="input-field" name="serviceName" placeholder="Optional systemd service"><input class="input-field" name="healthUrl" placeholder="Optional health URL"><input class="input-field" name="description" placeholder="What does this project do?"><button class="btn btn-primary">Add project</button></form></div><div id="project-list" class="workflow-grid" style="margin-top:20px">Loading projects…</div>';
    root.querySelector('#project-form').onsubmit = async event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      try {
        await API.post('/admin/projects', values);
        Toast.success('Project registered.');
        event.currentTarget.reset();
        load();
      } catch (error) {
        Toast.error(error.message);
      }
    };
    load();
  }
  function destroy() {
    root = null;
  }
  window.ProjectsPage = { render, destroy };
})();
