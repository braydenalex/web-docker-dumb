const API_URL = `/containers`;

let refreshIntervalId;

async function fetchContainers() {
  showSkeleton(); 
  try {
    const response = await fetch(API_URL);
    const containers = await response.json();
    renderUI(containers);
  } catch (error) {
    console.error("Failed to load containers", error);
  }
}

function showSkeleton() {
  // Sidebar skeleton
  const sidebarList = document.getElementById("sidebarList");
  sidebarList.innerHTML = "";
  for (let i = 0; i < 3; i++) {
    const li = document.createElement("li");
    li.className = "skeleton-item";
    sidebarList.appendChild(li);
  }

  // Summary skeleton for each category
  const categories = document.querySelectorAll(".container-list");
  categories.forEach(list => {
    list.innerHTML = "";
    for (let i = 0; i < 3; i++) {
      const li = document.createElement("li");
      li.className = "skeleton-item";
      list.appendChild(li);
    }
  });
}

function renderUI(containers) {
  updateSidebar(containers);
  updateSummary(containers);
  switchView('summary');
}

function updateSidebar(containers) {
  const sidebarList = document.getElementById("sidebarList");
  sidebarList.innerHTML = "";
  containers.forEach(container => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span>${container.name}</span>
      <span class="status-dot ${container.status}"></span>
    `;
    li.addEventListener("click", () => {
      showContainerDetails(container);
    });
    sidebarList.appendChild(li);
  });
}

function updateSummary(containers) {
  const activeList = document.querySelector("#activeContainers .container-list");
  const exitedList = document.querySelector("#exitedContainers .container-list");
  const inactiveList = document.querySelector("#inactiveContainers .container-list");
  activeList.innerHTML = "";
  exitedList.innerHTML = "";
  inactiveList.innerHTML = "";

  containers.forEach(container => {
    const li = document.createElement("li");
    li.innerHTML = `
      <strong>${container.name}</strong>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.5rem; font-size:0.85rem; color:#94a3b8;">
        <span>${container.image || 'Image'}</span>
        <span class="status-dot ${container.status}" title="${container.status}"></span>
      </div>
    `;
    li.addEventListener("click", () => {
      showContainerDetails(container);
    });
    if (container.status === "running") {
      activeList.appendChild(li);
    } else if (container.status === "exited") {
      exitedList.appendChild(li);
    } else {
      inactiveList.appendChild(li);
    }
  });
}

function getStatusClass(status) {
  if (status === "running") return "status-running";
  if (status === "exited") return "status-exited";
  return "status-inactive";
}

function showContainerDetails(container) {
  switchView('detail');
  const containerDetail = document.getElementById("containerDetail");
  containerDetail.innerHTML = `
    <h2>${container.name}</h2>
    <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:1.5rem; color:#94a3b8;">
      Status: <span class="status-dot ${container.status}"></span> <span style="color:#f1f5f9; text-transform:capitalize;">${container.status}</span>
    </div>
    
    <div class="controls">
      <button class="btn btn-action btn-start" onclick="manageContainer('${container.id}', 'start')">Start</button>
      <button class="btn btn-action btn-stop" onclick="manageContainer('${container.id}', 'stop')">Stop</button>
      <button class="btn btn-action btn-logs" onclick="viewLogs('${container.id}')">View Logs</button>
    </div>
    <div id="logsContainer" class="logs-container" style="display:none;">
      <div class="log-header">
        <h3 style="margin:0; color:#fff; font-size:0.9rem;">Logs</h3>
        <div class="log-toolbar">
          <button class="toolbar-btn" onclick="toggleLogWrap(this)" title="Toggle Wrap">Wrap</button>
          <button class="toolbar-btn" onclick="changeLogFontSize(-1)" title="Smaller Text">A-</button>
          <button class="toolbar-btn" onclick="changeLogFontSize(1)" title="Larger Text">A+</button>
          <button class="toolbar-btn" onclick="downloadLogs('${container.name}')" title="Download Logs">⬇</button>
          <button class="toolbar-btn" onclick="toggleLogFullscreen()" title="Fullscreen">⛶</button>
        </div>
      </div>
      <pre id="logsOutput" class="log-wrap"></pre>
    </div>
  `;
}

async function viewLogs(containerId) {
  const logsContainer = document.getElementById("logsContainer");
  const logsOutput = document.getElementById("logsOutput");
  logsOutput.textContent = "Loading logs...";
  logsContainer.style.display = "block";
  try {
    const response = await fetch(`${API_URL}/${containerId}/logs`);
    const data = await response.json();
    logsOutput.textContent = data.logs;
  } catch (error) {
    logsOutput.textContent = "Failed to load logs.";
    console.error("Failed to load logs for container", containerId, error);
  }
}

async function manageContainer(id, action) {
  try {
    const response = await fetch(`${API_URL}/${id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    fetchContainers();
  } catch (error) {
    console.error(`Failed to ${action} container:`, error);
  }
}

// Log Features
let currentLogSize = 13;

function toggleLogFullscreen() {
  const container = document.getElementById('logsContainer');
  container.classList.toggle('logs-fullscreen');
}

function changeLogFontSize(delta) {
  const output = document.getElementById('logsOutput');
  currentLogSize = Math.max(10, Math.min(24, currentLogSize + delta));
  output.style.fontSize = `${currentLogSize}px`;
}

function toggleLogWrap(btn) {
  const output = document.getElementById('logsOutput');
  if (output.classList.contains('log-wrap')) {
    output.classList.remove('log-wrap');
    output.classList.add('log-nowrap');
    btn.classList.add('active');
    btn.textContent = "No Wrap";
  } else {
    output.classList.remove('log-nowrap');
    output.classList.add('log-wrap');
    btn.classList.remove('active');
    btn.textContent = "Wrap";
  }
}

function downloadLogs(containerName) {
  const text = document.getElementById('logsOutput').textContent;
  const blob = new Blob([text], { type: 'text/plain' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${containerName}-${new Date().toISOString()}.log`;
  a.click();
  window.URL.revokeObjectURL(url);
}

function startAutoRefresh() {
  const intervalInput = document.getElementById("refreshInterval");
  const interval = parseInt(intervalInput.value) * 60 * 1000; // mins to ms
  fetchContainers();
  refreshIntervalId = setInterval(fetchContainers, interval);
}

const intervalInput = document.getElementById("refreshInterval");
document.getElementById("decInterval").addEventListener("click", () => {
  let val = parseInt(intervalInput.value) || 1;
  if (val > 1) {
    intervalInput.value = val - 1;
    intervalInput.dispatchEvent(new Event('change'));
  }
});
document.getElementById("incInterval").addEventListener("click", () => {
  let val = parseInt(intervalInput.value) || 1;
  intervalInput.value = val + 1;
  intervalInput.dispatchEvent(new Event('change'));
});

// Sidebar Resizer
const sidebar = document.querySelector('.dashboard-grid');
const resizer = document.getElementById('sidebarResizer');
let isResizing = false;

resizer.addEventListener('mousedown', (e) => {
  isResizing = true;
  resizer.classList.add('resizing');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const newWidth = e.clientX;
  if (newWidth > 200 && newWidth < 600) {
    sidebar.style.setProperty('--sidebar-width', `${newWidth}px`);
  }
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    resizer.classList.remove('resizing');
    document.body.style.cursor = 'default';
    document.body.style.userSelect = '';
  }
});

// Mobile Sidebar Toggle
const hamburgerBtn = document.getElementById('hamburgerBtn');
const sidebarNav = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');

function toggleSidebar() {
  sidebarNav.classList.toggle('open');
  sidebarOverlay.classList.toggle('active');
}

function closeSidebar() {
  sidebarNav.classList.remove('open');
  sidebarOverlay.classList.remove('active');
}

hamburgerBtn.addEventListener('click', toggleSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

// Close sidebar mobile
document.getElementById('sidebarList').addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    closeSidebar();
  }
});

// Close sidebar on window resize if switching to desktop
window.addEventListener('resize', () => {
  if (window.innerWidth > 768) {
    closeSidebar();
  }
});


document.getElementById("refresh").addEventListener("click", fetchContainers);

document.getElementById("refreshInterval").addEventListener("change", () => {
  clearInterval(refreshIntervalId);
  startAutoRefresh();
});

// Event listener for the auto-refresh toggle
document.getElementById("autoRefreshToggle").addEventListener("change", (event) => {
  if (event.target.checked) {
    startAutoRefresh();
  } else {
    clearInterval(refreshIntervalId);
  }
});

// Start auto-refresh on page load
startAutoRefresh();

document.getElementById("backBtn").addEventListener("click", () => {
  switchView('summary');
});

function switchView(viewName) {
  const summaryView = document.getElementById("summaryView");
  const detailView = document.getElementById("detailView");

  if (viewName === 'summary') {
    summaryView.classList.remove('active');
    detailView.classList.remove('active');
    summaryView.classList.add('active');
  } else {
    summaryView.classList.remove('active');
    detailView.classList.remove('active');
    detailView.classList.add('active');
  }
}

fetchContainers();