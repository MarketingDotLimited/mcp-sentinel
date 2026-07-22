import { API } from "../api.js";
import { Toast } from "../toast.js";
import { Router } from "../router.js";
(function () {
  let root;
  let organizations = [];
  let projects = [];
  function option(select, value, label) {
    const item = document.createElement('option');
    item.value = value;
    item.textContent = label;
    select.appendChild(item);
  }
  function renderTeam(team) {
    const card = document.createElement('article');
    card.className = 'card project-card';
    const title = document.createElement('h2');
    title.textContent = team.name;
    const org = organizations.find(item => item.id === team.organizationId);
    const details = document.createElement('p');
    details.textContent = `${team.role} · ${org?.name || 'Unknown organization'} · ${team.projectIds.length} project${team.projectIds.length === 1 ? '' : 's'}`;
    card.append(title, details);
    return card;
  }
  async function load() {
    const [orgData, projectData] = await Promise.all([API.get('/admin/organizations'), API.get('/admin/projects')]);
    organizations = orgData.organizations;
    projects = projectData.projects;
    const list = root.querySelector('#team-list');
    list.replaceChildren(...orgData.teams.map(renderTeam));
    if (!orgData.teams.length) list.textContent = 'No teams yet.';
    const select = root.querySelector('#team-org');
    select.replaceChildren();
    organizations.forEach(item => option(select, item.id, item.name));
    const projectChoices = root.querySelector('#team-projects');
    projectChoices.replaceChildren();
    projects.forEach(project => {
      const label = document.createElement('label');
      label.style.cssText = 'display:block;color:var(--text-secondary)';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = project.id;
      label.append(box, ` ${project.name}`);
      projectChoices.appendChild(label);
    });
  }
  function render(container) {
    root = container;
    root.innerHTML =
      '<div class="page-header"><div><h1>Teams</h1><p>Keep projects and AI access separated by team. Assign a team to a key through the API when issuing it.</p></div></div><div class="content-grid"><div class="card"><h2>Create organization</h2><form id="organization-form" class="project-form"><input class="input-field" name="name" placeholder="Organization name" required><button class="btn btn-primary">Create organization</button></form></div><div class="card"><h2>Create team</h2><form id="team-form"><div class="input-group"><input class="input-field" name="name" placeholder="Team name" required></div><div class="input-group"><select id="team-org" class="input-field" name="organizationId" required></select></div><div class="input-group"><select class="input-field" name="role"><option value="developer">Developer</option><option value="operator">Operator</option><option value="viewer">Viewer</option><option value="auditor">Auditor</option></select></div><div id="team-projects" class="input-group"></div><button class="btn btn-primary">Create team</button></form></div></div><div id="team-list" class="workflow-grid" style="margin-top:20px">Loading teams…</div>';
    root.querySelector('#organization-form').onsubmit = async event => {
      event.preventDefault();
      try {
        await API.post('/admin/organizations', Object.fromEntries(new FormData(event.currentTarget)));
        Toast.success('Organization created.');
        event.currentTarget.reset();
        await load();
      } catch (error) {
        Toast.error(error.message);
      }
    };
    root.querySelector('#team-form').onsubmit = async event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      data.projectIds = Array.from(root.querySelectorAll('#team-projects input:checked')).map(item => item.value);
      try {
        await API.post('/admin/teams', data);
        Toast.success('Team created.');
        event.currentTarget.reset();
        await load();
      } catch (error) {
        Toast.error(error.message);
      }
    };
    load().catch(error => {
      root.querySelector('#team-list').textContent = `Unable to load teams: ${error.message}`;
    });
  }
  function destroy() {
    root = null;
  }
  window.TeamsPage = { render, destroy };
})();
