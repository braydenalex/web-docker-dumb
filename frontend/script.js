const API_URL = `/containers`;

async function fetchContainers() {
  try {
    const response = await fetch(API_URL);
    const containers = await response.json();
    renderUI(containers);
  } catch (error) {
    console.error("Failed to load containers", error);
  }
}

function renderUI(containers) {
  updateSidebar(containers);
  updateSummary(containers);
  // Ensure the summary view is visible and detail view is hidden.
  document.getElementById("summaryView").style.display = 'block';
  document.getElementById("detailView").style.display = 'none';
}

function updateSidebar(containers) {
  const sidebarList = document.getElementById("sidebarList");
  sidebarList.innerHTML = "";
  containers.forEach(container => {
    const li = document.createElement("li");
    li.innerHTML = `
      <strong>${container.name}</strong> 
      <span class="status ${getStatusClass(container.status)}">${container.status}</span>
    `;
    li.addEventListener("click", () => {
      showContainerDetails(container);
    });
    sidebarList.appendChild(li);
  });
}

function updateSummary(containers) {
  // Clear existing lists
  const activeList = document.querySelector("#activeContainers .container-category");
  const exitedList = document.querySelector("#exitedContainers .container-category");
  const inactiveList = document.querySelector("#inactiveContainers .container-category");
  activeList.innerHTML = "";
  exitedList.innerHTML = "";
  inactiveList.innerHTML = "";

  containers.forEach(container => {
    const li = document.createElement("li");
    li.innerHTML = `
      <strong>${container.name}</strong> - 
      <span class="status ${getStatusClass(container.status)}">${container.status}</span>
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
  document.getElementById("summaryView").style.display = 'none';
  const detailView = document.getElementById("detailView");
  detailView.style.display = 'block';
  const containerDetail = document.getElementById("containerDetail");
  containerDetail.innerHTML = `
    <h2>${container.name}</h2>
    <p>Status: <span class="status ${getStatusClass(container.status)}">${container.status}</span></p>
    <div>
      <button class="start" onclick="manageContainer('${container.id}', 'start')">Start</button>
      <button class="stop" onclick="manageContainer('${container.id}', 'stop')">Stop</button>
    </div>
  `;
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
    // After managing the container, refresh the list.
    fetchContainers();
  } catch (error) {
    console.error(`Failed to ${action} container:`, error);
  }
}

document.getElementById("refresh").addEventListener("click", fetchContainers);
document.getElementById("backBtn").addEventListener("click", () => {
  document.getElementById("summaryView").style.display = 'block';
  document.getElementById("detailView").style.display = 'none';
});

fetchContainers();