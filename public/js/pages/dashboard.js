/**
 * MCP Sentinel Admin UI - Dashboard Page
 */

const DashboardPage = (() => {
  let pollInterval = null;
  let containerEl = null;

  function formatUptime(seconds) {
    if (!seconds || isNaN(seconds)) return '0s';
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor(seconds % (3600 * 24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    const s = Math.floor(seconds % 60);

    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (parts.length === 0) parts.push(`${s}s`);
    
    return parts.join(' ');
  }

  function getColor(value) {
    if (value < 60) return '#10b981'; // green
    if (value < 85) return '#f59e0b'; // amber
    return '#ef4444'; // red
  }

  function createProgressRing(id, title, suffix = '%') {
    return `
      <div class="card stat-card progress-card" id="card-${id}" style="background: rgba(30, 30, 35, 0.6); border: 1px solid rgba(255,255,255,0.05); border-radius: 1rem; padding: 1.5rem; backdrop-filter: blur(10px);">
        <h3 class="card-title" style="margin-top: 0; margin-bottom: 1.5rem; font-size: 1.1rem; color: #e4e4e7;">${title}</h3>
        <div class="progress-ring-container" style="position: relative; width: 120px; height: 120px; margin: 0 auto; display: flex; align-items: center; justify-content: center;">
          <svg width="120" height="120" viewBox="0 0 120 120" style="transform: rotate(-90deg);">
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="8"></circle>
            <circle id="ring-${id}" cx="60" cy="60" r="52" fill="none" stroke="#10b981" stroke-width="8" stroke-dasharray="326.72" stroke-dashoffset="326.72" stroke-linecap="round" style="transition: stroke-dashoffset 0.5s ease, stroke 0.5s ease;"></circle>
          </svg>
          <div style="position: absolute; text-align: center; display: flex; flex-direction: column; justify-content: center; align-items: center; inset: 0;">
            <div>
              <span id="value-${id}" class="card-value" style="font-size: 1.75rem; font-weight: bold; color: #fff;">0</span>
              <span style="font-size: 0.9rem; color: #a1a1aa; font-weight: 500;">${suffix}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function createTextCard(id, title) {
    return `
      <div class="card stat-card text-card" id="card-${id}" style="background: rgba(30, 30, 35, 0.6); border: 1px solid rgba(255,255,255,0.05); border-radius: 1rem; padding: 1.5rem; backdrop-filter: blur(10px);">
        <h3 class="card-title" style="margin-top: 0; margin-bottom: 1rem; font-size: 1.1rem; color: #e4e4e7;">${title}</h3>
        <div class="card-value-container" style="display: flex; align-items: center; gap: 0.5rem;">
          <span id="value-${id}" class="card-value" style="font-size: 1.75rem; font-weight: bold; color: #fff;">-</span>
        </div>
      </div>
    `;
  }

  function updateProgressRing(id, value) {
    const ring = document.getElementById(`ring-${id}`);
    const valueEl = document.getElementById(`value-${id}`);
    const card = document.getElementById(`card-${id}`);
    
    if (ring && valueEl) {
      const radius = 52;
      const circumference = radius * 2 * Math.PI;
      const offset = circumference - (value / 100) * circumference;
      
      ring.style.strokeDasharray = `${circumference}`;
      ring.style.strokeDashoffset = offset;
      ring.style.stroke = getColor(value);
      
      valueEl.textContent = Math.round(value);
      
      if (card) {
        card.classList.remove('pulse-update');
        void card.offsetWidth; // trigger reflow
        card.classList.add('pulse-update');
      }
    }
  }

  function updateTextCard(id, value, isStatus = false, statusColor = '#10b981') {
    const valueEl = document.getElementById(`value-${id}`);
    const card = document.getElementById(`card-${id}`);
    
    if (valueEl) {
      if (isStatus) {
        valueEl.innerHTML = '';
        const dot = document.createElement('span');
        dot.className = 'status-dot status-active';
        dot.style.display = 'inline-block';
        dot.style.width = '12px';
        dot.style.height = '12px';
        dot.style.borderRadius = '50%';
        dot.style.backgroundColor = statusColor;
        dot.style.marginRight = '10px';
        dot.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.6)';
        valueEl.appendChild(dot);
        
        const textNode = document.createTextNode(String(value));
        valueEl.appendChild(textNode);
      } else {
        valueEl.textContent = value;
      }
      
      if (card) {
        card.classList.remove('pulse-update');
        void card.offsetWidth;
        card.classList.add('pulse-update');
      }
    }
  }

  async function fetchStats() {
    try {
      if (typeof API === 'undefined') {
        throw new Error('API client not found');
      }
      
      const data = await API.get('/admin/stats');
      
      if (data) {
        updateProgressRing('cpu', data.cpu || 0);
        updateProgressRing('memory', data.memory || 0);
        updateProgressRing('disk', data.disk || 0);
        
        const load = data.loadAvg || data.load;
        if (load && typeof load === 'object' && !Array.isArray(load)) {
          updateTextCard('load', `${Number(load['1m'] || 0).toFixed(2)} / ${Number(load['5m'] || 0).toFixed(2)} / ${Number(load['15m'] || 0).toFixed(2)}`);
        } else if (Array.isArray(load)) {
          updateTextCard('load', `${load[0].toFixed(2)} / ${load[1].toFixed(2)} / ${load[2].toFixed(2)}`);
        } else {
          updateTextCard('load', 'N/A');
        }
        
        updateTextCard('sessions', data.activeSessions || 0, true);
        updateTextCard('keys', data.totalKeys ?? data.apiKeys ?? 0);
        updateTextCard('uptime', formatUptime(data.serverUptime ?? data.uptime ?? 0));
        const summary = data.healthSummary;
        const healthColor = summary?.status === 'needs-attention' ? '#ef4444' : summary?.status === 'watch' ? '#f59e0b' : '#10b981';
        updateTextCard('health', summary?.status === 'needs-attention' ? 'Needs attention' : summary?.status === 'watch' ? 'Keep an eye on it' : 'Healthy', true, healthColor);
        const healthMessage = document.getElementById('health-message');
        if (healthMessage) healthMessage.textContent = summary?.message || 'Checking server health…';
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
      if (typeof Toast !== 'undefined' && Toast.error) {
        Toast.error('Failed to fetch dashboard stats');
      }
    }
  }

  function render(container) {
    containerEl = container;
    
    // Set up style for pulse animation
    if (!document.getElementById('dashboard-styles')) {
      const style = document.createElement('style');
      style.id = 'dashboard-styles';
      style.textContent = `
        @keyframes subtlePulse {
          0% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.1); border-color: rgba(255,255,255,0.2); }
          50% { box-shadow: 0 0 15px 0 rgba(255, 255, 255, 0.05); border-color: rgba(255,255,255,0.05); }
          100% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0); border-color: rgba(255,255,255,0.05); }
        }
        .pulse-update {
          animation: subtlePulse 1s ease-out;
        }
      `;
      document.head.appendChild(style);
    }

    containerEl.innerHTML = `
      <div class="page-header" style="margin-bottom: 2.5rem;">
        <h1 class="page-title" style="font-size: 2.25rem; font-weight: 800; letter-spacing: -0.025em; margin: 0; background: linear-gradient(135deg, #fff 0%, #a1a1aa 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Server Care</h1>
        <p class="page-subtitle" style="color: #a1a1aa; margin-top: 0.5rem; font-size: 1.1rem;">Your server at a glance. Start with Guided Tasks for a safe AI-assisted task.</p>
      </div>
      
      <div class="content-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.5rem; margin-bottom: 1.5rem;">
        ${createProgressRing('cpu', 'CPU Usage')}
        ${createProgressRing('memory', 'Memory Usage')}
        ${createProgressRing('disk', 'Disk Usage')}
        ${createTextCard('load', 'Load Average (1m/5m/15m)')}
      </div>
      
      <div class="content-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem;">
        ${createTextCard('health', 'Server Health')}
        ${createTextCard('sessions', 'Active Sessions')}
        ${createTextCard('keys', 'API Keys')}
        ${createTextCard('uptime', 'Server Uptime')}
      </div>
      <p id="health-message" style="color: #a1a1aa; margin-top: 1rem;">Checking server health…</p>
    `;

    // Initial fetch
    fetchStats();
    
    // Set up polling
    pollInterval = setInterval(fetchStats, 5000);
  }

  function destroy() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    containerEl = null;
  }

  return {
    render,
    destroy
  };
})();

window.DashboardPage = DashboardPage;
