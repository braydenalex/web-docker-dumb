const API_URL = `/containers`;

async function fetchContainers() {
  try {
    const response = await fetch(API_URL);
    const containers = await response.json();
    renderContainers(containers);
  } catch (error) {
    console.error("Failed to load containers", error);
  }
}

function renderContainers(containers) {
  const list = document.getElementById("containerList");
  list.innerHTML = "";

  containers.forEach(container => {
    const li = document.createElement("li");
    li.innerHTML = `
      <strong>${container.name}</strong> (${container.status})
      <button class="start" onclick="manageContainer('${container.id}', 'start')">Start</button>
      <button class="stop" onclick="manageContainer('${container.id}', 'stop')">Stop</button>
    `;
    list.appendChild(li);
  });
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

document.getElementById("refresh").addEventListener("click", fetchContainers);
fetchContainers();
