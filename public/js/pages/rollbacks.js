(function() {
  let rootContainer = null;
  let searchInput = null;
  let searchButton = null;
  let resultsContainer = null;
  
  function formatSize(bytes) {
    if (bytes === undefined || bytes === null) return '0 B';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  function formatDate(timestamp) {
    if (!timestamp) return 'Unknown';
    try {
      return new Date(timestamp).toLocaleString();
    } catch (e) {
      return timestamp;
    }
  }

  async function handleSearch(e) {
    if (e) e.preventDefault();
    const filePath = searchInput.value.trim();
    
    if (!filePath) {
      if (typeof Toast !== 'undefined') {
        Toast.error('Please enter a file path to search.');
      }
      return;
    }

    resultsContainer.innerHTML = '<div class="empty-state">Loading backups...</div>';

    try {
      const response = await API.get('/admin/backups?filePath=' + encodeURIComponent(filePath));
      // API might return { backups: [...] } or just [...]
      const backups = response.backups || response || [];
      renderBackups(filePath, backups);
    } catch (err) {
      console.error('Failed to load backups:', err);
      resultsContainer.innerHTML = '<div class="empty-state">Failed to load backups.</div>';
      if (typeof Toast !== 'undefined') {
        Toast.error('Error loading backups: ' + (err.message || 'Unknown error'));
      }
    }
  }

  function renderBackups(filePath, backups) {
    if (!Array.isArray(backups) || backups.length === 0) {
      resultsContainer.innerHTML = '<div class="empty-state">No backups found for this file.</div>';
      return;
    }

    const table = document.createElement('table');
    table.className = 'data-table';
    
    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th>Date</th>
        <th>User</th>
        <th>Size</th>
        <th>Actions</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    
    backups.forEach(backup => {
      const tr = document.createElement('tr');
      
      const tdDate = document.createElement('td');
      tdDate.textContent = formatDate(backup.timestamp);
      
      const tdUser = document.createElement('td');
      tdUser.textContent = backup.user || backup.username || 'System';
      
      const tdSize = document.createElement('td');
      tdSize.textContent = formatSize(backup.size);
      
      const tdActions = document.createElement('td');
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'btn btn-danger';
      restoreBtn.textContent = 'Restore';
      restoreBtn.onclick = () => showRestoreModal(filePath, backup);
      
      tdActions.appendChild(restoreBtn);
      
      tr.appendChild(tdDate);
      tr.appendChild(tdUser);
      tr.appendChild(tdSize);
      tr.appendChild(tdActions);
      
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    
    resultsContainer.innerHTML = '';
    resultsContainer.appendChild(table);
  }

  function showRestoreModal(filePath, backup) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    
    const modal = document.createElement('div');
    modal.className = 'modal card';
    
    const header = document.createElement('h3');
    header.textContent = 'Confirm Restore';
    
    const text = document.createElement('p');
    text.textContent = 'Are you sure you want to restore the file ';
    
    const fileSpan = document.createElement('strong');
    fileSpan.textContent = filePath;
    text.appendChild(fileSpan);
    
    const text2 = document.createTextNode(' to the backup from ');
    text.appendChild(text2);
    
    const timeSpan = document.createElement('strong');
    timeSpan.textContent = formatDate(backup.timestamp);
    text.appendChild(timeSpan);
    
    const text3 = document.createTextNode('? This will overwrite the current file content.');
    text.appendChild(text3);
    
    const actions = document.createElement('div');
    actions.style.marginTop = '1.5rem';
    actions.style.display = 'flex';
    actions.style.gap = '10px';
    actions.style.justifyContent = 'flex-end';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => {
      if (document.body.contains(overlay)) {
        document.body.removeChild(overlay);
      }
    };
    
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn btn-danger';
    confirmBtn.textContent = 'Restore Backup';
    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Restoring...';
      try {
        await API.post('/admin/backups/restore', { 
          filePath: filePath, 
          timestamp: backup.timestamp, 
          confirm: true 
        });
        if (typeof Toast !== 'undefined') {
          Toast.success('Backup restored successfully');
        }
        if (document.body.contains(overlay)) {
          document.body.removeChild(overlay);
        }
        handleSearch(); // Refresh list
      } catch (err) {
        console.error('Failed to restore backup:', err);
        if (typeof Toast !== 'undefined') {
          Toast.error('Error restoring backup: ' + (err.message || 'Unknown error'));
        }
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Restore Backup';
      }
    };
    
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    
    modal.appendChild(header);
    modal.appendChild(text);
    modal.appendChild(actions);
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  function render(container) {
    rootContainer = container;
    
    const title = document.createElement('h2');
    title.textContent = 'Config Backups';
    
    const card = document.createElement('div');
    card.className = 'card';
    
    const filterBar = document.createElement('form');
    filterBar.className = 'filter-bar input-group';
    filterBar.onsubmit = handleSearch;
    
    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'input-field';
    searchInput.placeholder = '/etc/nginx/nginx.conf';
    searchInput.style.flex = '1';
    
    searchButton = document.createElement('button');
    searchButton.type = 'submit';
    searchButton.className = 'btn btn-primary';
    searchButton.textContent = 'Search';
    
    filterBar.appendChild(searchInput);
    filterBar.appendChild(searchButton);
    
    resultsContainer = document.createElement('div');
    resultsContainer.style.marginTop = '20px';
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'Enter a file path and search to view its backups.';
    resultsContainer.appendChild(emptyState);
    
    card.appendChild(filterBar);
    card.appendChild(resultsContainer);
    
    rootContainer.appendChild(title);
    rootContainer.appendChild(card);
  }

  function destroy() {
    if (rootContainer) {
      rootContainer.innerHTML = '';
      rootContainer = null;
    }
    searchInput = null;
    searchButton = null;
    resultsContainer = null;
  }

  window.RollbacksPage = { render, destroy };
})();
