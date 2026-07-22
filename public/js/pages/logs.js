import { API } from "../api.js";
import { Toast } from "../toast.js";
import { Router } from "../router.js";
window.LogsPage = (function () {
  let abortController = null;
  let containerEl = null;
  let isPaused = false;
  let logBuffer = [];
  let tbodyEl = null;
  let reconnectTimeout = null;
  let dynamicStyle = null;

  const DESTRUCTIVE_TOOLS = ['delete_file', 'kill_process', 'manage_firewall', 'delete_user'];

  function formatTimestamp(ts) {
    const date = new Date(ts);
    const today = new Date();
    const isToday =
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();

    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    if (isToday) {
      const seconds = date.getSeconds().toString().padStart(2, '0');
      return `${hours}:${minutes}:${seconds}`;
    } else {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${months[date.getMonth()]} ${date.getDate()} ${hours}:${minutes}`;
    }
  }

  function formatDuration(ms) {
    if (ms == null) return '-';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function matchesFilters(log) {
    const userIdFilter = document.getElementById('log-filter-user').value.toLowerCase();
    const toolFilter = document.getElementById('log-filter-tool').value.toLowerCase();
    const resultFilter = document.getElementById('log-filter-result').value;

    const logUser = log.userId || '';
    const logTool = log.tool || '';

    if (userIdFilter && !logUser.toLowerCase().includes(userIdFilter)) return false;
    if (toolFilter && !logTool.toLowerCase().includes(toolFilter)) return false;

    const isSuccess = log.success !== false && !log.error;
    if (resultFilter === 'Success' && !isSuccess) return false;
    if (resultFilter === 'Error' && isSuccess) return false;

    return true;
  }

  function applyFilters() {
    if (!tbodyEl) return;
    const rows = tbodyEl.querySelectorAll('tr');
    const userIdFilter = document.getElementById('log-filter-user').value.toLowerCase();
    const toolFilter = document.getElementById('log-filter-tool').value.toLowerCase();
    const resultFilter = document.getElementById('log-filter-result').value;

    rows.forEach(row => {
      const userId = row.dataset.user || '';
      const tool = row.dataset.tool || '';
      const isError = row.classList.contains('error');
      const isSuccess = !isError;

      let show = true;
      if (userIdFilter && !userId.toLowerCase().includes(userIdFilter)) show = false;
      if (toolFilter && !tool.toLowerCase().includes(toolFilter)) show = false;
      if (resultFilter === 'Success' && !isSuccess) show = false;
      if (resultFilter === 'Error' && isSuccess) show = false;

      row.style.display = show ? '' : 'none';
    });
  }

  function createLogRow(log) {
    const tr = document.createElement('tr');

    tr.dataset.user = log.userId || '';
    tr.dataset.tool = log.tool || '';

    const isSuccess = log.success !== false && !log.error;
    if (!isSuccess) {
      tr.classList.add('error');
    }
    if (DESTRUCTIVE_TOOLS.includes(log.tool)) {
      tr.classList.add('destructive');
    }

    const tdTime = document.createElement('td');
    tdTime.textContent = formatTimestamp(log.timestamp || Date.now());
    tr.appendChild(tdTime);

    const tdIp = document.createElement('td');
    tdIp.textContent = log.ip || '-';
    tr.appendChild(tdIp);

    const tdUser = document.createElement('td');
    tdUser.textContent = log.userId || '-';
    tr.appendChild(tdUser);

    const tdTool = document.createElement('td');
    tdTool.textContent = log.tool || '-';
    tr.appendChild(tdTool);

    const tdDuration = document.createElement('td');
    tdDuration.textContent = formatDuration(log.duration);
    tr.appendChild(tdDuration);

    const tdResult = document.createElement('td');
    tdResult.textContent = isSuccess ? '✅' : '❌';
    tr.appendChild(tdResult);

    if (!matchesFilters(log)) {
      tr.style.display = 'none';
    }

    return tr;
  }

  function addLogToTable(log, animate = true) {
    const tr = createLogRow(log);
    if (animate) {
      tr.classList.add('slideIn');
    }
    if (tbodyEl.firstChild) {
      tbodyEl.insertBefore(tr, tbodyEl.firstChild);
    } else {
      tbodyEl.appendChild(tr);
    }
  }

  function flushBuffer() {
    if (logBuffer.length > 0) {
      logBuffer.forEach(log => addLogToTable(log, true));
      logBuffer = [];
    }
  }

  async function loadInitialLogs() {
    try {
      const data = await window.API.get('/admin/logs?limit=200');
      if (data && Array.isArray(data)) {
        data.forEach(log => {
          const tr = createLogRow(log);
          tbodyEl.appendChild(tr);
        });
      }
    } catch (err) {
      console.error('Failed to load initial logs', err);
    }
  }

  async function connectSSE() {
    if (!containerEl) return;
    abortController = new AbortController();

    try {
      const token = window.API ? window.API.getToken() : '';
      const response = await fetch('/admin/logs/stream', {
        headers: { Authorization: 'Bearer ' + token },
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        buffer = lines.pop(); // keep the last partial line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') continue;
            if (!dataStr) continue;

            try {
              const log = JSON.parse(dataStr);
              if (isPaused) {
                logBuffer.push(log);
              } else {
                addLogToTable(log, true);
              }
            } catch (e) {
              console.error('Error parsing SSE data', e);
            }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('SSE connection error, reconnecting...', err);
        if (containerEl) {
          reconnectTimeout = setTimeout(connectSSE, 3000);
        }
      }
    }
  }

  async function render(container) {
    containerEl = container;
    container.innerHTML = '';
    isPaused = false;
    logBuffer = [];

    if (!dynamicStyle) {
      dynamicStyle = document.createElement('style');
      dynamicStyle.textContent = `
                @keyframes pulseBadge {
                    0% { opacity: 1; }
                    50% { opacity: 0.5; }
                    100% { opacity: 1; }
                }
                @keyframes slideInRow {
                    from { transform: translateX(-20px); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                .slideIn { animation: slideInRow 0.3s ease-out; }
                .data-table tr.destructive td:nth-child(4) { color: #d9363e; font-weight: bold; }
                .data-table tr.error { background-color: rgba(255, 77, 79, 0.1); }
            `;
      document.head.appendChild(dynamicStyle);
    }

    // Header
    const headerContainer = document.createElement('div');
    headerContainer.className = 'page-header';

    const headerLeft = document.createElement('div');
    headerLeft.style.display = 'flex';
    headerLeft.style.alignItems = 'center';
    headerLeft.style.gap = '12px';

    const title = document.createElement('h1');
    title.textContent = 'Audit Logs';

    const badge = document.createElement('span');
    badge.className = 'badge-live';
    badge.textContent = 'Live';

    headerLeft.appendChild(title);
    headerLeft.appendChild(badge);
    headerContainer.appendChild(headerLeft);
    container.appendChild(headerContainer);

    // Filter bar
    const filterBar = document.createElement('div');
    filterBar.className = 'filter-bar';

    const userInput = document.createElement('input');
    userInput.id = 'log-filter-user';
    userInput.placeholder = 'Filter by User ID';
    userInput.className = 'input-field';
    userInput.addEventListener('input', applyFilters);

    const toolInput = document.createElement('input');
    toolInput.id = 'log-filter-tool';
    toolInput.placeholder = 'Filter by Tool';
    toolInput.className = 'input-field';
    toolInput.addEventListener('input', applyFilters);

    const resultSelect = document.createElement('select');
    resultSelect.id = 'log-filter-result';
    resultSelect.className = 'input-field';
    const options = ['All', 'Success', 'Error'];
    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      resultSelect.appendChild(option);
    });
    resultSelect.addEventListener('change', applyFilters);

    const pauseBtn = document.createElement('button');
    pauseBtn.textContent = 'Pause';
    pauseBtn.className = 'btn btn-ghost';
    pauseBtn.addEventListener('click', () => {
      isPaused = !isPaused;
      if (isPaused) {
        pauseBtn.textContent = 'Resume';
        badge.style.animation = 'none';
        badge.style.opacity = '0.5';
      } else {
        pauseBtn.textContent = 'Pause';
        badge.style.animation = 'pulseBadge 2s infinite';
        badge.style.opacity = '1';
        flushBuffer();
      }
    });

    filterBar.appendChild(userInput);
    filterBar.appendChild(toolInput);
    filterBar.appendChild(resultSelect);
    filterBar.appendChild(pauseBtn);
    container.appendChild(filterBar);

    // Table
    const table = document.createElement('table');
    table.className = 'data-table';
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';

    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    ['Timestamp', 'IP', 'User', 'Tool', 'Duration', 'Result'].forEach(text => {
      const th = document.createElement('th');
      th.textContent = text;
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    tbodyEl = document.createElement('tbody');
    table.appendChild(tbodyEl);
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'card table-wrapper';
    tableWrapper.appendChild(table);
    container.appendChild(tableWrapper);

    await loadInitialLogs();
    connectSSE();
  }

  function destroy() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (dynamicStyle) {
      dynamicStyle.remove();
      dynamicStyle = null;
    }
    containerEl = null;
    tbodyEl = null;
  }

  return { render, destroy };
})();
