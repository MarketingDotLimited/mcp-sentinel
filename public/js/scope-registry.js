import { API } from './api.js';

export let SCOPE_GROUPS = {};
export let ROLE_TEMPLATES = {};

export async function loadScopeRegistry() {
  try {
    const res = await API.get('/admin/scope-registry');
    SCOPE_GROUPS = res.groups || {};
    ROLE_TEMPLATES = res.templates || {};
  } catch (e) {
    console.error('Failed to load scope registry', e);
  }
}

export function renderScopeSelector(container, selectedScopes = [], mode = 'hybrid') {
  container.innerHTML = '';

  const headerDiv = document.createElement('div');
  headerDiv.style.marginBottom = '12px';
  headerDiv.style.paddingBottom = '8px';
  headerDiv.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
  const lblAll = document.createElement('label');
  lblAll.className = 'checkbox-label';
  const chkAll = document.createElement('input');
  chkAll.type = 'checkbox';
  chkAll.className = 'scope-chk-all';
  chkAll.checked = selectedScopes.includes('*');
  lblAll.appendChild(chkAll);
  lblAll.appendChild(document.createTextNode(' Full Admin Access (*)'));
  headerDiv.appendChild(lblAll);
  container.appendChild(headerDiv);

  const grid = document.createElement('div');
  grid.className = 'scopes-grid';
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(200px, 1fr))';
  grid.style.gap = '12px';

  const allCheckboxes = [];

  Object.entries(SCOPE_GROUPS).forEach(([groupName, groupData]) => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'scope-group';
    groupDiv.style.background = 'rgba(255,255,255,0.03)';
    groupDiv.style.padding = '8px';
    groupDiv.style.borderRadius = '6px';

    const groupLbl = document.createElement('label');
    groupLbl.className = 'checkbox-label';
    groupLbl.style.fontWeight = 'bold';
    const groupChk = document.createElement('input');
    groupChk.type = 'checkbox';
    groupChk.className = 'scope-chk-group';
    groupChk.value = groupName;
    const isGroupSelected = selectedScopes.includes(groupName) || selectedScopes.includes('*');
    groupChk.checked = isGroupSelected;
    groupLbl.appendChild(groupChk);
    groupLbl.appendChild(document.createTextNode(' ' + groupData.label + ' (' + groupName + ')'));
    groupDiv.appendChild(groupLbl);
    allCheckboxes.push(groupChk);

    if (mode === 'hybrid' || mode === 'granular') {
      const toolsDiv = document.createElement('div');
      toolsDiv.style.marginTop = '6px';
      toolsDiv.style.marginLeft = '16px';
      toolsDiv.style.display = 'flex';
      toolsDiv.style.flexDirection = 'column';
      toolsDiv.style.gap = '4px';

      const toolCheckboxes = [];

      groupData.tools.forEach(tool => {
        const toolLbl = document.createElement('label');
        toolLbl.className = 'checkbox-label';
        toolLbl.style.fontSize = '12px';
        const toolChk = document.createElement('input');
        toolChk.type = 'checkbox';
        toolChk.className = 'scope-chk-tool';
        toolChk.value = tool;
        toolChk.checked = isGroupSelected || selectedScopes.includes(tool) || selectedScopes.includes('*');
        toolChk.disabled = isGroupSelected || selectedScopes.includes('*');
        toolLbl.appendChild(toolChk);
        toolLbl.appendChild(document.createTextNode(' ' + tool));
        toolsDiv.appendChild(toolLbl);
        allCheckboxes.push(toolChk);
        toolCheckboxes.push(toolChk);
      });

      groupChk.addEventListener('change', e => {
        toolCheckboxes.forEach(chk => {
          if (e.target.checked || chkAll.checked) {
            chk.checked = true;
            chk.disabled = true;
          } else {
            chk.checked = false;
            chk.disabled = false;
          }
        });
      });

      groupDiv.appendChild(toolsDiv);
    }

    grid.appendChild(groupDiv);
  });

  chkAll.addEventListener('change', e => {
    allCheckboxes.forEach(chk => {
      if (e.target.checked) {
        chk.checked = true;
        if (chk.classList.contains('scope-chk-tool')) chk.disabled = true;
      } else {
        chk.checked = false;
        if (chk.classList.contains('scope-chk-tool')) {
          chk.disabled = false;
          const groupChk = chk.closest('.scope-group').querySelector('.scope-chk-group');
          if (groupChk.checked) chk.disabled = true;
        }
      }
    });
  });

  container.appendChild(grid);
}

export function getSelectedScopes(container) {
  const chkAll = container.querySelector('.scope-chk-all');
  if (chkAll && chkAll.checked) {
    return ['*'];
  }

  const selected = [];
  const groups = container.querySelectorAll('.scope-chk-group:checked');
  groups.forEach(g => {
    selected.push(g.value);
  });

  const tools = container.querySelectorAll('.scope-chk-tool:checked');
  tools.forEach(t => {
    if (!t.disabled) {
      selected.push(t.value);
    }
  });

  return selected;
}

export function applyRoleTemplate(container, roleId) {
  if (!ROLE_TEMPLATES) return;
  const templatesArray = Array.isArray(ROLE_TEMPLATES) ? ROLE_TEMPLATES : Object.values(ROLE_TEMPLATES);
  const template = templatesArray.find(t => t.id === roleId);
  if (!template) return;

  const chkAll = container.querySelector('.scope-chk-all');
  if (chkAll) {
    chkAll.checked = template.scopes.includes('*');
    chkAll.dispatchEvent(new Event('change'));
  }

  const groupChks = container.querySelectorAll('.scope-chk-group');
  groupChks.forEach(chk => {
    chk.checked = template.scopes.includes('*') || template.scopes.includes(chk.value);
    chk.dispatchEvent(new Event('change'));
  });

  const toolChks = container.querySelectorAll('.scope-chk-tool');
  toolChks.forEach(chk => {
    if (!chk.disabled) {
      chk.checked = template.scopes.includes(chk.value);
    }
  });
}
