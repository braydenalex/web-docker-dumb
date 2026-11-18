const API_URL = `${window.API_BASE_PATH || ""}/containers`;
const CONTAINER_ID = /^[a-fA-F0-9]{12,64}$/;
const mobileLayout = window.matchMedia("(max-width: 768px)");
const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
const dockerStates = {
  running: { label: "Running", tone: "running", stop: true },
  created: { label: "Created", tone: "neutral", start: true },
  exited: { label: "Exited", tone: "neutral", start: true },
  paused: { label: "Paused", tone: "warning" },
  restarting: { label: "Restarting", tone: "warning", stop: true },
  removing: { label: "Removing", tone: "warning" },
  dead: { label: "Dead", tone: "error" },
};
const unknownState = { label: "Unknown", tone: "neutral" };

const elements = Object.fromEntries([
  "sidebar", "sidebarList", "sidebarOverlay", "sidebarResizer", "hamburgerBtn", "closeSidebar", "mainContent",
  "refresh", "refreshSettings", "refreshStatus", "refreshInterval", "autoRefreshToggle", "messageBar",
  "summaryView", "containerSearch", "containerGroups", "detailView", "backBtn", "containerName", "containerImage",
  "containerStatus", "startContainer", "stopContainer", "viewLogs", "logsContainer", "logLimit", "logStatus",
  "logsOutput", "refreshLogs", "copyLogs", "downloadLogs", "wrapLogs", "smallerLogs", "largerLogs", "fullscreenLogs",
].map((id) => [id, document.getElementById(id)]));

const state = {
  containers: null,
  lastUpdated: null,
  listError: false,
  listRequest: null,
  refreshTimer: null,
  selectedId: null,
  detailTrigger: null,
  pendingActions: new Map(),
  logRequest: null,
  logText: "",
  logSize: 13,
};

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function setMessage(message = "", type = "") {
  elements.messageBar.textContent = message;
  elements.messageBar.dataset.type = type;
}

async function apiRequest(path = "", { method = "GET", signal, timeout = 15000 } = {}) {
  const request = new AbortController();
  const abort = () => request.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(abort, timeout);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      mode: "same-origin",
      cache: "no-store",
      signal: request.signal,
    });
    const json = response.headers.get("content-type")?.includes("application/json");
    const payload = json ? await response.json() : null;
    if (!response.ok) {
      throw new Error(typeof payload?.detail === "string" ? payload.detail : `HTTP ${response.status}`);
    }
    return payload;
  } catch (error) {
    if (request.signal.aborted && !signal?.aborted) throw new Error("Request timed out.");
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function normalizeContainer(value) {
  if (typeof value?.id !== "string" || !CONTAINER_ID.test(value.id)) return null;
  return {
    id: value.id,
    name: typeof value.name === "string" && value.name ? value.name : value.id,
    image: typeof value.image === "string" && value.image ? value.image : "Unknown image",
    status: Object.hasOwn(dockerStates, value.status) ? value.status : "unknown",
    project: typeof value.compose_project === "string" ? value.compose_project : "",
  };
}

function containerState(container) {
  return dockerStates[container.status] ?? unknownState;
}

function selectedContainer() {
  return state.containers?.find(({ id }) => id === state.selectedId);
}

function containerItem(container, inSidebar) {
  const item = document.createElement("li");
  const button = document.createElement("button");
  const status = containerState(container);
  button.type = "button";
  button.dataset.containerId = container.id;
  button.className = inSidebar ? "nav-button" : "container-card";
  const name = textElement("strong", container.name, "card-name");
  if (inSidebar) {
    const dot = textElement("span", "", "state-dot");
    dot.dataset.tone = status.tone;
    name.title = container.name;
    button.append(name, dot, textElement("span", status.label, "sr-only"));
  } else {
    const image = textElement("span", container.image, "card-image");
    image.title = container.image;
    const badge = textElement("span", status.label, "state-label");
    badge.dataset.tone = status.tone;
    button.append(name, image, badge);
  }
  button.addEventListener("click", () => showDetails(container.id, button));
  item.append(button);
  return item;
}

function updateSidebarSelection() {
  for (const button of elements.sidebarList.querySelectorAll("[data-container-id]")) {
    if (button.dataset.containerId === state.selectedId) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  }
}

function renderLists() {
  const active = document.activeElement;
  const activeId = active?.dataset.containerId;
  const navHadFocus = elements.sidebarList.contains(active);
  const items = state.containers.map((container) => containerItem(container, true));
  if (items.length === 0) items.push(textElement("li", "No containers available.", "empty-state"));
  elements.sidebarList.replaceChildren(...items);
  updateSidebarSelection();
  renderGroups();
  if (activeId) {
    const list = navHadFocus ? elements.sidebarList : elements.containerGroups;
    const replacement = list.querySelector(`[data-container-id="${activeId}"]`);
    const fallback = navHadFocus ? list.querySelector("button") || elements.closeSidebar : elements.containerSearch;
    (replacement || fallback).focus({ preventScroll: true });
  }
}

function renderGroups() {
  const query = elements.containerSearch.value.trim().toLowerCase();
  const groups = new Map();
  for (const container of state.containers ?? []) {
    const { name, image, project } = container;
    if (!`${name} ${image}`.toLowerCase().includes(query)) continue;
    if (!groups.has(project)) groups.set(project, []);
    groups.get(project).push(container);
  }
  const sections = [];
  for (const [project, containers] of groups) {
    const section = document.createElement("section");
    section.className = "container-group";
    const heading = textElement("h2", project || "Standalone containers");
    const list = textElement("ul", "", "container-list");
    list.append(...containers.map((container) => containerItem(container, false)));
    section.append(heading, list);
    sections.push(section);
  }
  if (sections.length === 0) {
    sections.push(textElement("p", query ? "No names or images match your search." : "No containers available.", "empty-state"));
  }
  elements.containerGroups.replaceChildren(...sections);
}

function updateRefreshStatus() {
  const lastUpdated = state.lastUpdated && clock.format(state.lastUpdated);
  const status = state.listError
    ? (lastUpdated ? `Refresh failed. Showing containers from ${lastUpdated}.` : "Could not load containers. Check the API and try Refresh.")
    : (lastUpdated ? `Last updated ${lastUpdated}` : "Loading containers…");
  elements.refreshStatus.textContent = status;
  elements.refreshStatus.classList.toggle("is-error", state.listError);
}

function refreshContainers({ supersede = false } = {}) {
  if (state.listRequest && !supersede) return state.listRequest.promise;
  state.listRequest?.controller.abort();
  const controller = new AbortController();
  const request = { controller };
  state.listRequest = request;
  elements.refresh.setAttribute("aria-busy", "true");
  request.promise = (async () => {
    try {
      const payload = await apiRequest("", { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!Array.isArray(payload)) throw new Error("Invalid container list.");
      const containers = payload.map(normalizeContainer).filter(Boolean).sort((a, b) =>
        Number(!a.project) - Number(!b.project) || a.project.localeCompare(b.project) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
      );
      const changed = JSON.stringify(containers) !== JSON.stringify(state.containers);
      const previous = selectedContainer();
      state.containers = containers;
      state.lastUpdated = new Date();
      state.listError = false;
      elements.containerSearch.disabled = false;
      if (changed) renderLists();
      if (previous && !selectedContainer()) {
        showSummary();
        setMessage(`${previous.name} is no longer available.`, "error");
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      state.listError = true;
      console.error("Container refresh failed", error);
    } finally {
      if (state.listRequest === request) {
        state.listRequest = null;
        elements.refresh.removeAttribute("aria-busy");
        updateRefreshStatus();
        updateDetail();
      }
    }
  })();
  return request.promise;
}

function updateDetail() {
  const container = selectedContainer();
  if (!container) return;
  const status = containerState(container);
  const pending = state.pendingActions.get(container.id);
  elements.containerName.textContent = container.name;
  elements.containerImage.textContent = container.image;
  elements.containerStatus.textContent = status.label;
  elements.containerStatus.dataset.tone = status.tone;
  elements.startContainer.disabled = state.listError || !!pending || !status.start;
  elements.stopContainer.disabled = state.listError || !!pending || !status.stop;
  elements.startContainer.textContent = pending === "start" ? "Starting…" : "Start";
  elements.stopContainer.textContent = pending === "stop" ? "Stopping…" : "Stop";
}

function showDetails(id, trigger) {
  if (state.selectedId !== id) {
    clearLogs();
    state.selectedId = id;
    state.detailTrigger = trigger;
    setMessage();
  }
  setDrawer(false, false);
  elements.summaryView.hidden = true;
  elements.detailView.hidden = false;
  updateSidebarSelection();
  updateDetail();
  elements.containerName.focus();
}

function showSummary() {
  const id = state.selectedId;
  const trigger = state.detailTrigger;
  clearLogs();
  state.selectedId = null;
  state.detailTrigger = null;
  setMessage();
  elements.detailView.hidden = true;
  elements.summaryView.hidden = false;
  updateSidebarSelection();
  const replacement = elements.containerGroups.querySelector(`[data-container-id="${id}"]`);
  const target = (trigger?.isConnected && !trigger.closest("[inert]")) ? trigger : replacement || elements.containerSearch;
  target.focus();
}

async function manageContainer(action) {
  const container = selectedContainer();
  if (!container || state.listError || state.pendingActions.has(container.id) || !containerState(container)[action]) return;
  state.pendingActions.set(container.id, action);
  updateDetail();
  setMessage();
  try {
    const payload = await apiRequest(`/${container.id}/${action}`, { method: "POST", timeout: 60000 });
    if (typeof payload?.message !== "string") throw new Error("Invalid container action response.");
    setMessage(payload.message, "success");
  } catch (error) {
    setMessage(`${container.name}: ${error.message} Check its current status before trying again.`, "error");
  } finally {
    await refreshContainers({ supersede: true });
    while (state.listRequest) await state.listRequest.promise;
    state.pendingActions.delete(container.id);
    updateDetail();
  }
}

function setLogVisibility(visible) {
  elements.logsContainer.hidden = !visible;
  elements.viewLogs.setAttribute("aria-expanded", String(visible));
  elements.viewLogs.textContent = visible ? "Hide logs" : "View logs";
}

function clearLogs() {
  state.logRequest?.abort();
  state.logRequest = null;
  state.logText = "";
  elements.logLimit.hidden = true;
  elements.logStatus.textContent = "";
  elements.logsOutput.textContent = "";
  elements.refreshLogs.removeAttribute("aria-busy");
  elements.copyLogs.disabled = true;
  elements.downloadLogs.disabled = true;
  setLogFullscreen(false);
  setLogVisibility(false);
}

async function refreshLogs() {
  if (!state.selectedId || state.logRequest) return;
  const controller = new AbortController();
  state.logRequest = controller;
  elements.logStatus.textContent = "Loading logs…";
  elements.refreshLogs.setAttribute("aria-busy", "true");
  try {
    const payload = await apiRequest(`/${state.selectedId}/logs`, { signal: controller.signal });
    if (controller.signal.aborted) return;
    if (typeof payload?.logs !== "string") throw new Error("Invalid log response.");
    state.logText = payload.logs;
    const scroll = elements.logsOutput.scrollTop;
    elements.logsOutput.textContent = state.logText;
    elements.logsOutput.scrollTop = scroll;
    elements.copyLogs.disabled = !state.logText;
    elements.downloadLogs.disabled = !state.logText;
    elements.logLimit.textContent = payload.tail_lines ? `Last ${payload.tail_lines} lines` : "";
    elements.logLimit.hidden = !payload.tail_lines;
    elements.logStatus.textContent = payload.truncated ? "Byte limit reached. Some log output was omitted."
      : state.logText ? "" : "No logs available.";
  } catch (error) {
    if (!controller.signal.aborted) {
      const detail = state.logText ? " Showing the previous logs." : "";
      elements.logStatus.textContent = `Could not refresh logs. ${error.message}${detail}`;
    }
  } finally {
    if (state.logRequest === controller) {
      state.logRequest = null;
      elements.refreshLogs.removeAttribute("aria-busy");
    }
  }
}

async function copyLogs() {
  const id = state.selectedId;
  if (!state.logText) return;
  try {
    await navigator.clipboard.writeText(state.logText);
    if (state.selectedId === id) elements.logStatus.textContent = "Logs copied.";
  } catch {
    if (state.selectedId !== id) return;
    elements.logsOutput.focus();
    const range = document.createRange();
    range.selectNodeContents(elements.logsOutput);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    elements.logStatus.textContent = "Logs selected. Press Ctrl+C or Command+C to copy.";
  }
}

function downloadLogs() {
  const container = selectedContainer();
  if (!container || !state.logText) return;
  const name = container.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const url = URL.createObjectURL(new Blob([state.logText], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}-${timestamp}.log`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setLogFullscreen(fullscreen) {
  elements.logsContainer.classList.toggle("logs-fullscreen", fullscreen);
  elements.fullscreenLogs.setAttribute("aria-pressed", String(fullscreen));
  elements.fullscreenLogs.textContent = fullscreen ? "Exit fullscreen" : "Fullscreen";
}

function changeLogSize(amount) {
  state.logSize = Math.max(10, Math.min(24, state.logSize + amount));
  elements.logsOutput.style.fontSize = `${state.logSize}px`;
  elements.smallerLogs.disabled = state.logSize === 10;
  elements.largerLogs.disabled = state.logSize === 24;
}

function scheduleRefresh() {
  window.clearInterval(state.refreshTimer);
  const minutes = Math.max(1, Math.min(120, Number.parseInt(elements.refreshInterval.value, 10) || 2));
  elements.refreshInterval.value = String(minutes);
  if (elements.autoRefreshToggle.checked) {
    state.refreshTimer = window.setInterval(refreshContainers, minutes * 60 * 1000);
  }
}

function setDrawer(open, restoreFocus = true) {
  const wasOpen = !elements.sidebarOverlay.hidden;
  const showingDrawer = open && mobileLayout.matches;
  elements.sidebar.classList.toggle("open", showingDrawer);
  elements.sidebarOverlay.hidden = !showingDrawer;
  elements.sidebar.inert = mobileLayout.matches && !showingDrawer;
  elements.mainContent.inert = showingDrawer;
  elements.hamburgerBtn.setAttribute("aria-expanded", String(showingDrawer));
  if (showingDrawer) {
    elements.refreshSettings.hidePopover?.();
    elements.sidebar.setAttribute("role", "dialog");
    elements.sidebar.setAttribute("aria-modal", "true");
    elements.closeSidebar.focus();
  } else {
    elements.sidebar.removeAttribute("role");
    elements.sidebar.removeAttribute("aria-modal");
    if (wasOpen && restoreFocus) {
      (mobileLayout.matches ? elements.hamburgerBtn : elements.sidebarList.querySelector("button") || elements.refresh).focus();
    }
  }
}

function trapTab(event, section) {
  const controls = [...section.querySelectorAll("button:not(:disabled), [tabindex='0']")];
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

elements.sidebarResizer.addEventListener("pointerdown", (event) => {
  if (event.button === 0) elements.sidebarResizer.setPointerCapture(event.pointerId);
});
elements.sidebarResizer.addEventListener("pointermove", (event) => {
  if (!elements.sidebarResizer.hasPointerCapture(event.pointerId)) return;
  const max = Math.min(600, window.innerWidth - 380);
  const width = Math.max(200, Math.min(max, event.clientX));
  elements.sidebar.closest(".dashboard-grid").style.setProperty("--sidebar-width", `${width}px`);
});

elements.containerSearch.addEventListener("input", renderGroups);
elements.refresh.addEventListener("click", () => refreshContainers());
elements.autoRefreshToggle.addEventListener("change", scheduleRefresh);
elements.refreshInterval.addEventListener("change", scheduleRefresh);
elements.backBtn.addEventListener("click", showSummary);
elements.startContainer.addEventListener("click", () => manageContainer("start"));
elements.stopContainer.addEventListener("click", () => manageContainer("stop"));
elements.viewLogs.addEventListener("click", () => {
  const open = elements.logsContainer.hidden;
  setLogVisibility(open);
  if (open && !state.logText) refreshLogs();
});
elements.refreshLogs.addEventListener("click", refreshLogs);
elements.copyLogs.addEventListener("click", copyLogs);
elements.downloadLogs.addEventListener("click", downloadLogs);
elements.wrapLogs.addEventListener("click", () => {
  const nowrap = elements.logsOutput.classList.toggle("nowrap");
  elements.wrapLogs.setAttribute("aria-pressed", String(!nowrap));
});
elements.smallerLogs.addEventListener("click", () => changeLogSize(-1));
elements.largerLogs.addEventListener("click", () => changeLogSize(1));
elements.fullscreenLogs.addEventListener("click", () => setLogFullscreen(!elements.logsContainer.classList.contains("logs-fullscreen")));
elements.hamburgerBtn.addEventListener("click", () => setDrawer(true));
elements.closeSidebar.addEventListener("click", () => setDrawer(false));
elements.sidebarOverlay.addEventListener("click", () => setDrawer(false));
mobileLayout.addEventListener("change", () => setDrawer(false));
document.addEventListener("keydown", (event) => {
  const fullscreen = elements.logsContainer.classList.contains("logs-fullscreen");
  if (event.key === "Escape") {
    if (!elements.sidebarOverlay.hidden) setDrawer(false);
    else if (fullscreen) setLogFullscreen(false);
  } else if (event.key === "Tab") {
    if (!elements.sidebarOverlay.hidden) trapTab(event, elements.sidebar);
    else if (fullscreen) trapTab(event, elements.logsContainer);
  }
});

setDrawer(false);
refreshContainers();
scheduleRefresh();
