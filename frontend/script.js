const API_URL = `/containers`;

async function fetchContainers() {
  showSpinner();
  try {
    const response = await fetch(API_URL);
    const containers = await response.json();
    renderContainers(containers);
  } catch (error) {
    console.error("Failed to load containers", error);
  } finally {
    hideSpinner();
  }
}

function renderContainers(containers) {
  const list = document.getElementById("containerList");
  list.innerHTML = "";

  containers.forEach(container => {
    const li = document.createElement("li");
    const statusClass = container.status === 'running' ? 'status-running' : 'status-stopped';
    li.innerHTML = `
      <div>
        <strong>${container.name}</strong>
        <span class="status ${statusClass}">${container.status}</span>
      </div>
      <div>
        <button class="start" onclick="manageContainer('${container.id}', 'start')">Start</button>
        <button class="stop" onclick="manageContainer('${container.id}', 'stop')">Stop</button>
      </div>
    `;
    list.appendChild(li);
  });
}

async function manageContainer(id, action) {
  showSpinner();
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
  } finally {
    hideSpinner();
  }
}

function showSpinner() {
  const spinnerOverlay = document.createElement('div');
  spinnerOverlay.className = 'spinner-overlay';
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  spinnerOverlay.appendChild(spinner);
  document.body.appendChild(spinnerOverlay);
}

function hideSpinner() {
  const spinnerOverlay = document.querySelector('.spinner-overlay');
  if (spinnerOverlay) {
    spinnerOverlay.remove();
  }
}

document.getElementById("refresh").addEventListener("click", fetchContainers);
fetchContainers();
