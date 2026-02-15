const API_BASE_PATH = typeof window.API_BASE_PATH === "string"
  ? window.API_BASE_PATH.replace(/\/+$/, "")
  : "";
const API_URL = `${API_BASE_PATH}/containers`;
const REQUEST_TIMEOUT_MS = 10000;
const MOBILE_BREAKPOINT = 768;
const MIN_REFRESH_MINUTES = 1;
const MAX_REFRESH_MINUTES = 120;
const CONTAINER_ID_PATTERN = /^[a-fA-F0-9]{12,64}$/;

const elements = {
  sidebarList: document.getElementById("sidebarList"),
  activeList: document.querySelector("#activeContainers .container-list"),
  exitedList: document.querySelector("#exitedContainers .container-list"),
  inactiveList: document.querySelector("#inactiveContainers .container-list"),
  containerDetail: document.getElementById("containerDetail"),
  messageBar: document.getElementById("messageBar"),
  refreshButton: document.getElementById("refresh"),
  refreshInterval: document.getElementById("refreshInterval"),
  decreaseInterval: document.getElementById("decInterval"),
  increaseInterval: document.getElementById("incInterval"),
  autoRefreshToggle: document.getElementById("autoRefreshToggle"),
  backButton: document.getElementById("backBtn"),
  summaryView: document.getElementById("summaryView"),
  detailView: document.getElementById("detailView"),
  pageTitle: document.querySelector(".page-title"),
  dashboardGrid: document.querySelector(".dashboard-grid"),
  resizer: document.getElementById("sidebarResizer"),
  sidebarNav: document.getElementById("sidebar"),
  sidebarOverlay: document.getElementById("sidebarOverlay"),
  hamburgerBtn: document.getElementById("hamburgerBtn"),
};

const appState = {
  containers: [],
  selectedContainerId: null,
  refreshIntervalId: null,
  currentLogSize: 13,
  isResizing: false,
  listAbortController: null,
  logsAbortController: null,
};

function statusClass(status) {
  if (status === "running") {
    return "running";
  }
  if (status === "exited") {
    return "exited";
  }
  return "inactive";
}

function sanitizeStatus(status) {
  if (typeof status !== "string") {
    return "inactive";
  }
  const normalizedStatus = status.toLowerCase();
  if (normalizedStatus === "running") {
    return "running";
  }
  if (normalizedStatus === "exited") {
    return "exited";
  }
  return "inactive";
}

function normalizeContainer(rawContainer) {
  if (!rawContainer || typeof rawContainer !== "object") {
    return null;
  }

  const id = typeof rawContainer.id === "string" ? rawContainer.id.trim() : "";
  if (!CONTAINER_ID_PATTERN.test(id)) {
    return null;
  }

  const name = typeof rawContainer.name === "string" && rawContainer.name.trim()
    ? rawContainer.name.trim()
    : "Unnamed Container";
  const image = typeof rawContainer.image === "string" && rawContainer.image.trim()
    ? rawContainer.image.trim()
    : "Unknown image";

  return {
    id,
    name,
    image,
    status: sanitizeStatus(rawContainer.status),
  };
}

function setMessage(message, type = "error") {
  if (!elements.messageBar) {
    return;
  }
  if (!message) {
    elements.messageBar.textContent = "";
    elements.messageBar.classList.remove("visible", "error", "success");
    return;
  }
  elements.messageBar.textContent = message;
  elements.messageBar.classList.add("visible");
  elements.messageBar.classList.remove("error", "success");
  elements.messageBar.classList.add(type);
}

function clearNode(element) {
  element.replaceChildren();
}

function createStatusDot(status, title) {
  const dot = document.createElement("span");
  dot.className = `status-dot ${statusClass(status)}`;
  if (title) {
    dot.title = title;
  }
  return dot;
}

function createEmptyItem(label) {
  const item = document.createElement("li");
  item.className = "empty-state-card";
  item.textContent = label;
  return item;
}

async function apiRequest(pathSuffix = "", options = {}) {
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
  const {
    method = "GET",
    body = undefined,
    signal = undefined,
  } = options;

  let abortHandler;
  if (signal) {
    if (signal.aborted) {
      timeoutController.abort();
    }
    abortHandler = () => timeoutController.abort();
    signal.addEventListener("abort", abortHandler, { once: true });
  }

  const headers = {
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const response = await fetch(`${API_URL}${pathSuffix}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      mode: "same-origin",
      signal: timeoutController.signal,
    });

    const contentType = response.headers.get("content-type") || "";
    let payload = null;
    if (contentType.includes("application/json")) {
      payload = await response.json().catch(() => null);
    }

    if (!response.ok) {
      const message = payload && typeof payload.detail === "string"
        ? payload.detail
        : `Request failed with status ${response.status}`;
      throw new Error(message);
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Request timed out.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
}

function showSkeleton() {
  clearNode(elements.sidebarList);
  for (let index = 0; index < 3; index += 1) {
    const skeleton = document.createElement("li");
    skeleton.className = "skeleton-item";
    elements.sidebarList.appendChild(skeleton);
  }

  [elements.activeList, elements.exitedList, elements.inactiveList].forEach((list) => {
    clearNode(list);
    for (let index = 0; index < 3; index += 1) {
      const skeleton = document.createElement("li");
      skeleton.className = "skeleton-item";
      list.appendChild(skeleton);
    }
  });
}

function createSidebarItem(container) {
  const item = document.createElement("li");
  const name = document.createElement("span");
  const status = createStatusDot(container.status, container.status);

  name.textContent = container.name;
  item.append(name, status);

  item.addEventListener("click", () => {
    showContainerDetails(container);
  });
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      showContainerDetails(container);
    }
  });
  item.tabIndex = 0;
  return item;
}

function createSummaryCard(container) {
  const item = document.createElement("li");
  const title = document.createElement("strong");
  const meta = document.createElement("div");
  const image = document.createElement("span");

  title.textContent = container.name;
  meta.className = "card-meta";
  image.className = "card-image";
  image.textContent = container.image;

  meta.append(image, createStatusDot(container.status, container.status));
  item.append(title, meta);

  item.addEventListener("click", () => {
    showContainerDetails(container);
  });
  return item;
}

function updateSidebar(containers) {
  clearNode(elements.sidebarList);
  if (containers.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-sidebar-item";
    empty.textContent = "No containers found";
    elements.sidebarList.appendChild(empty);
    return;
  }

  containers.forEach((container) => {
    elements.sidebarList.appendChild(createSidebarItem(container));
  });
}

function updateSummary(containers) {
  clearNode(elements.activeList);
  clearNode(elements.exitedList);
  clearNode(elements.inactiveList);

  containers.forEach((container) => {
    const card = createSummaryCard(container);
    if (container.status === "running") {
      elements.activeList.appendChild(card);
    } else if (container.status === "exited") {
      elements.exitedList.appendChild(card);
    } else {
      elements.inactiveList.appendChild(card);
    }
  });

  if (elements.activeList.childElementCount === 0) {
    elements.activeList.appendChild(createEmptyItem("No running containers"));
  }
  if (elements.exitedList.childElementCount === 0) {
    elements.exitedList.appendChild(createEmptyItem("No exited containers"));
  }
  if (elements.inactiveList.childElementCount === 0) {
    elements.inactiveList.appendChild(createEmptyItem("No inactive containers"));
  }
}

function renderUI(containers) {
  updateSidebar(containers);
  updateSummary(containers);
}

function switchView(viewName) {
  const showingSummary = viewName === "summary";
  elements.summaryView.classList.toggle("active", showingSummary);
  elements.detailView.classList.toggle("active", !showingSummary);
  elements.pageTitle.textContent = showingSummary ? "Dashboard" : "Container Details";
}

function setActionButtonsDisabled(disabled) {
  const buttons = elements.containerDetail.querySelectorAll(".btn-action");
  buttons.forEach((button) => {
    button.disabled = disabled;
  });
}

function showContainerDetails(container) {
  appState.selectedContainerId = container.id;
  switchView("detail");
  clearNode(elements.containerDetail);
  setMessage("");

  const heading = document.createElement("h2");
  heading.textContent = container.name;

  const statusRow = document.createElement("div");
  statusRow.className = "detail-status";
  const statusLabel = document.createElement("span");
  statusLabel.textContent = "Status:";
  const statusText = document.createElement("span");
  statusText.className = "detail-status-text";
  statusText.textContent = container.status;
  statusRow.append(statusLabel, createStatusDot(container.status, container.status), statusText);

  const controls = document.createElement("div");
  controls.className = "controls";

  const startButton = document.createElement("button");
  startButton.type = "button";
  startButton.className = "btn btn-action btn-start";
  startButton.textContent = "Start";
  startButton.disabled = container.status === "running";
  startButton.addEventListener("click", () => {
    manageContainer(container.id, "start");
  });

  const stopButton = document.createElement("button");
  stopButton.type = "button";
  stopButton.className = "btn btn-action btn-stop";
  stopButton.textContent = "Stop";
  stopButton.disabled = container.status !== "running";
  stopButton.addEventListener("click", () => {
    manageContainer(container.id, "stop");
  });

  const logsButton = document.createElement("button");
  logsButton.type = "button";
  logsButton.className = "btn btn-action btn-logs";
  logsButton.textContent = "View Logs";
  logsButton.addEventListener("click", () => {
    viewLogs(container.id);
  });

  controls.append(startButton, stopButton, logsButton);

  const logsContainer = document.createElement("div");
  logsContainer.id = "logsContainer";
  logsContainer.className = "logs-container";
  logsContainer.hidden = true;

  const logHeader = document.createElement("div");
  logHeader.className = "log-header";

  const logTitle = document.createElement("h3");
  logTitle.className = "log-title";
  logTitle.textContent = "Logs";

  const logToolbar = document.createElement("div");
  logToolbar.className = "log-toolbar";

  const wrapButton = document.createElement("button");
  wrapButton.type = "button";
  wrapButton.className = "toolbar-btn";
  wrapButton.title = "Toggle line wrap";
  wrapButton.textContent = "Wrap";
  wrapButton.addEventListener("click", () => {
    toggleLogWrap(wrapButton);
  });

  const smallerTextButton = document.createElement("button");
  smallerTextButton.type = "button";
  smallerTextButton.className = "toolbar-btn";
  smallerTextButton.title = "Smaller text";
  smallerTextButton.textContent = "A-";
  smallerTextButton.addEventListener("click", () => {
    changeLogFontSize(-1);
  });

  const largerTextButton = document.createElement("button");
  largerTextButton.type = "button";
  largerTextButton.className = "toolbar-btn";
  largerTextButton.title = "Larger text";
  largerTextButton.textContent = "A+";
  largerTextButton.addEventListener("click", () => {
    changeLogFontSize(1);
  });

  const downloadButton = document.createElement("button");
  downloadButton.type = "button";
  downloadButton.className = "toolbar-btn";
  downloadButton.title = "Download logs";
  downloadButton.textContent = "Download";
  downloadButton.addEventListener("click", () => {
    downloadLogs(container.name);
  });

  const fullscreenButton = document.createElement("button");
  fullscreenButton.type = "button";
  fullscreenButton.className = "toolbar-btn";
  fullscreenButton.title = "Fullscreen";
  fullscreenButton.textContent = "Fullscreen";
  fullscreenButton.addEventListener("click", toggleLogFullscreen);

  logToolbar.append(
    wrapButton,
    smallerTextButton,
    largerTextButton,
    downloadButton,
    fullscreenButton,
  );
  logHeader.append(logTitle, logToolbar);

  const logsOutput = document.createElement("pre");
  logsOutput.id = "logsOutput";
  logsOutput.className = "log-wrap";
  logsOutput.textContent = "";
  logsOutput.style.fontSize = `${appState.currentLogSize}px`;

  logsContainer.append(logHeader, logsOutput);
  elements.containerDetail.append(heading, statusRow, controls, logsContainer);
}

async function fetchContainers() {
  showSkeleton();
  if (appState.listAbortController) {
    appState.listAbortController.abort();
  }
  const requestController = new AbortController();
  appState.listAbortController = requestController;

  try {
    const payload = await apiRequest("", { signal: requestController.signal });
    if (!Array.isArray(payload)) {
      throw new Error("Invalid container payload.");
    }
    const containers = payload.map(normalizeContainer).filter(Boolean);
    appState.containers = containers;
    renderUI(containers);

    if (appState.selectedContainerId) {
      const selected = containers.find((container) => container.id === appState.selectedContainerId);
      if (!selected) {
        appState.selectedContainerId = null;
        switchView("summary");
      }
    }
    setMessage("");
  } catch (error) {
    if (requestController.signal.aborted) {
      return;
    }
    console.error("Failed to load containers", error);
    setMessage("Could not load containers. Check server/API connectivity.");
  } finally {
    if (appState.listAbortController === requestController) {
      appState.listAbortController = null;
    }
  }
}

async function viewLogs(containerId) {
  if (!CONTAINER_ID_PATTERN.test(containerId)) {
    setMessage("Invalid container ID.", "error");
    return;
  }

  const logsContainer = document.getElementById("logsContainer");
  const logsOutput = document.getElementById("logsOutput");
  if (!logsContainer || !logsOutput) {
    return;
  }

  if (appState.logsAbortController) {
    appState.logsAbortController.abort();
  }
  const requestController = new AbortController();
  appState.logsAbortController = requestController;

  logsOutput.textContent = "Loading logs...";
  logsContainer.hidden = false;
  setMessage("");

  try {
    const encodedId = encodeURIComponent(containerId);
    const payload = await apiRequest(`/${encodedId}/logs`, { signal: requestController.signal });
    const logs = payload && typeof payload.logs === "string" ? payload.logs : "No logs available.";
    logsOutput.textContent = logs || "No logs available.";
  } catch (error) {
    if (requestController.signal.aborted) {
      return;
    }
    logsOutput.textContent = "Failed to load logs.";
    console.error("Failed to load logs for container", containerId, error);
    setMessage(`Could not load logs: ${error.message}`);
  } finally {
    if (appState.logsAbortController === requestController) {
      appState.logsAbortController = null;
    }
  }
}

async function manageContainer(containerId, action) {
  if (!CONTAINER_ID_PATTERN.test(containerId)) {
    setMessage("Invalid container ID.", "error");
    return;
  }
  if (action !== "start" && action !== "stop") {
    setMessage("Invalid action.", "error");
    return;
  }

  try {
    setActionButtonsDisabled(true);
    setMessage("");
    const encodedId = encodeURIComponent(containerId);
    await apiRequest(`/${encodedId}/${action}`, {
      method: "POST",
      body: {},
    });
    setMessage(`Container ${action} command sent.`, "success");
    await fetchContainers();
    const updatedContainer = appState.containers.find((container) => container.id === containerId);
    if (updatedContainer && elements.detailView.classList.contains("active")) {
      showContainerDetails(updatedContainer);
    }
  } catch (error) {
    console.error(`Failed to ${action} container`, error);
    setMessage(`Failed to ${action} container: ${error.message}`, "error");
  } finally {
    setActionButtonsDisabled(false);
  }
}

function toggleLogFullscreen() {
  const container = document.getElementById("logsContainer");
  if (container) {
    container.classList.toggle("logs-fullscreen");
  }
}

function changeLogFontSize(delta) {
  const output = document.getElementById("logsOutput");
  if (!output) {
    return;
  }
  appState.currentLogSize = Math.max(10, Math.min(24, appState.currentLogSize + delta));
  output.style.fontSize = `${appState.currentLogSize}px`;
}

function toggleLogWrap(button) {
  const output = document.getElementById("logsOutput");
  if (!output) {
    return;
  }

  const usingWrappedLines = output.classList.contains("log-wrap");
  output.classList.toggle("log-wrap", !usingWrappedLines);
  output.classList.toggle("log-nowrap", usingWrappedLines);
  button.classList.toggle("active", usingWrappedLines);
  button.textContent = usingWrappedLines ? "No Wrap" : "Wrap";
}

function sanitizeFileName(input) {
  const sanitized = input.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return sanitized || "container";
}

function downloadLogs(containerName) {
  const logsOutput = document.getElementById("logsOutput");
  if (!logsOutput) {
    return;
  }

  const text = logsOutput.textContent || "";
  const blob = new Blob([text], { type: "text/plain" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const safeName = sanitizeFileName(containerName);
  const timestamp = new Date().toISOString().replace(/[:]/g, "-");
  anchor.href = url;
  anchor.download = `${safeName}-${timestamp}.log`;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

function clampRefreshInterval(value) {
  if (!Number.isFinite(value)) {
    return MIN_REFRESH_MINUTES;
  }
  return Math.max(MIN_REFRESH_MINUTES, Math.min(MAX_REFRESH_MINUTES, value));
}

function startAutoRefresh() {
  if (appState.refreshIntervalId) {
    window.clearInterval(appState.refreshIntervalId);
  }

  const parsedValue = Number.parseInt(elements.refreshInterval.value, 10);
  const minutes = clampRefreshInterval(parsedValue);
  elements.refreshInterval.value = String(minutes);

  fetchContainers();
  appState.refreshIntervalId = window.setInterval(fetchContainers, minutes * 60 * 1000);
}

function stopAutoRefresh() {
  if (appState.refreshIntervalId) {
    window.clearInterval(appState.refreshIntervalId);
    appState.refreshIntervalId = null;
  }
}

function closeSidebar() {
  elements.sidebarNav.classList.remove("open");
  elements.sidebarOverlay.classList.remove("active");
  elements.hamburgerBtn.setAttribute("aria-expanded", "false");
}

function toggleSidebar() {
  const isOpen = elements.sidebarNav.classList.toggle("open");
  elements.sidebarOverlay.classList.toggle("active", isOpen);
  elements.hamburgerBtn.setAttribute("aria-expanded", String(isOpen));
}

function handleResizeStart() {
  if (window.innerWidth <= MOBILE_BREAKPOINT) {
    return;
  }
  appState.isResizing = true;
  elements.resizer.classList.add("resizing");
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
}

function handleResizeMove(event) {
  if (!appState.isResizing) {
    return;
  }
  const newWidth = event.clientX;
  if (newWidth > 200 && newWidth < 600) {
    elements.dashboardGrid.style.setProperty("--sidebar-width", `${newWidth}px`);
  }
}

function handleResizeEnd() {
  if (!appState.isResizing) {
    return;
  }
  appState.isResizing = false;
  elements.resizer.classList.remove("resizing");
  document.body.style.cursor = "default";
  document.body.style.userSelect = "";
}

elements.decreaseInterval.addEventListener("click", () => {
  const current = Number.parseInt(elements.refreshInterval.value, 10) || MIN_REFRESH_MINUTES;
  elements.refreshInterval.value = String(clampRefreshInterval(current - 1));
  elements.refreshInterval.dispatchEvent(new Event("change"));
});

elements.increaseInterval.addEventListener("click", () => {
  const current = Number.parseInt(elements.refreshInterval.value, 10) || MIN_REFRESH_MINUTES;
  elements.refreshInterval.value = String(clampRefreshInterval(current + 1));
  elements.refreshInterval.dispatchEvent(new Event("change"));
});

elements.refreshButton.addEventListener("click", fetchContainers);

elements.refreshInterval.addEventListener("change", () => {
  if (elements.autoRefreshToggle.checked) {
    startAutoRefresh();
  }
});

elements.autoRefreshToggle.addEventListener("change", (event) => {
  if (event.target.checked) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
});

elements.backButton.addEventListener("click", () => {
  appState.selectedContainerId = null;
  switchView("summary");
  setMessage("");
});

elements.resizer.addEventListener("mousedown", handleResizeStart);
document.addEventListener("mousemove", handleResizeMove);
document.addEventListener("mouseup", handleResizeEnd);

elements.hamburgerBtn.addEventListener("click", toggleSidebar);
elements.sidebarOverlay.addEventListener("click", closeSidebar);
elements.sidebarList.addEventListener("click", () => {
  if (window.innerWidth <= MOBILE_BREAKPOINT) {
    closeSidebar();
  }
});

window.addEventListener("resize", () => {
  if (window.innerWidth > MOBILE_BREAKPOINT) {
    closeSidebar();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSidebar();
  }
});

if (elements.autoRefreshToggle.checked) {
  startAutoRefresh();
} else {
  fetchContainers();
}
