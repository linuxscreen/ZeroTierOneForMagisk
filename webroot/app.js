(() => {
  "use strict";

  const API_PATH = "/data/adb/modules/ZeroTierOneForMagisk/webroot/api.sh";
  const REFRESH_INTERVAL = 5000;
  const DETAIL_REFRESH_INTERVAL = 15000;

  const state = {
    page: "control",
    overview: null,
    peers: [],
    networks: [],
    planet: null,
    selectedPlanet: null,
    busy: false,
    lastDetailRefresh: 0,
    bridgeWarningShown: false,
  };

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

  function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'"'"'`)}'`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function exec(command) {
    return new Promise((resolve, reject) => {
      if (!window.ksu || typeof window.ksu.exec !== "function") {
        reject(new Error("当前 WebView 没有提供 root 命令桥，请使用 KernelSU/APatch 管理器或 Magisk 的 MMRL/WebUI X 打开。"));
        return;
      }

      const callbackName = `zt_exec_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("root 命令执行超时，请重试或重新打开模块界面。"));
      }, 15000);
      const cleanup = () => {
        window.clearTimeout(timeout);
        try {
          delete window[callbackName];
        } catch (_) {
          window[callbackName] = undefined;
        }
      };

      window[callbackName] = (errno, stdout, stderr) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          errno: Number(errno || 0),
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
        });
      };

      try {
        window.ksu.exec(command, JSON.stringify({}), callbackName);
      } catch (error) {
        settled = true;
        cleanup();
        reject(error);
      }
    });
  }

  async function api(...args) {
    const command = ["sh", API_PATH, ...args].map(shellQuote).join(" ");
    const result = await exec(command);
    const output = result.stdout.trim();
    let payload;

    try {
      payload = JSON.parse(output);
    } catch (_) {
      const detail = result.stderr.trim() || output || `命令返回码 ${result.errno}`;
      throw new Error(`模块接口返回了无法识别的数据：${detail}`);
    }

    if (!payload.ok) {
      throw new Error(payload.error || payload.message || "操作失败");
    }
    return payload;
  }

  function toast(message, type = "success") {
    const item = document.createElement("div");
    item.className = `toast${type === "error" ? " is-error" : ""}`;
    item.textContent = message;
    $("#toast-stack").appendChild(item);
    window.setTimeout(() => item.remove(), type === "error" ? 5200 : 3200);
  }

  function reportError(error, { quiet = false } = {}) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("root 命令桥")) {
      if (state.bridgeWarningShown) return;
      state.bridgeWarningShown = true;
    }
    if (!quiet) toast(message, "error");
  }

  function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return "—";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KiB`;
    return `${(value / 1024 / 1024).toFixed(2)} MiB`;
  }

  function formatTime(seconds) {
    const value = Number(seconds);
    if (!value) return "—";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value * 1000));
  }

  function formatClockTime(date = new Date()) {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  }

  function normalizeList(data, key) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data[key])) return data[key];
    return [];
  }

  function setRefreshSpinner(action, spinning) {
    const button = $(`[data-action="${action}"]`);
    if (!button) return;
    button.classList.toggle("is-spinning", spinning);
    button.disabled = spinning;
  }

  function setServiceButtonsDisabled(disabled) {
    const running = Boolean(state.overview?.running);
    $$('[data-service-action]').forEach((button) => {
      const requiresRunning = button.dataset.serviceAction === "stop" || button.dataset.serviceAction === "restart";
      button.disabled = disabled || (requiresRunning && !running);
    });
  }

  function renderOverview(data) {
    state.overview = data;
    const running = Boolean(data.running);
    const info = data.info || {};
    const online = typeof info.online === "boolean" ? info.online : null;
    const headerStatus = $("#header-status");
    const hero = $("#hero-panel");

    headerStatus.className = `status-chip ${running ? "is-running" : "is-stopped"}`;
    $(".status-text", headerStatus).textContent = running ? "运行中" : "已停止";
    hero.classList.toggle("is-running", running);
    hero.classList.toggle("is-stopped", !running);

    $("#service-state").textContent = running ? "运行中" : "已停止";
    $("#service-description").textContent = running
      ? "ZeroTier 后台服务正在运行，节点控制面已连接。"
      : "ZeroTier 后台服务当前未运行，Peers 与网络数据暂不可用。";
    $("#node-id").textContent = info.address || "----------";
    $("#node-version").textContent = formatVersion(info);
    $("#node-online").textContent = !running ? "OFFLINE" : online === true ? "ONLINE" : online === false ? "NO PLANET" : "CONNECTING";

    const autostart = $("#autostart-toggle");
    autostart.checked = Boolean(data.autostart);
    autostart.disabled = state.busy;
    $("#pending-banner").classList.toggle("is-hidden", !data.planetPending);
    setServiceButtonsDisabled(state.busy);
  }

  function formatVersion(item) {
    if (item.version && typeof item.version === "string") return item.version;
    const parts = [item.versionMajor, item.versionMinor, item.versionRev]
      .filter((part) => Number.isFinite(Number(part)) && Number(part) >= 0);
    return parts.length ? parts.join(".") : "—";
  }

  async function refreshOverview({ quiet = false } = {}) {
    try {
      const response = await api("get", "overview");
      renderOverview(response.data);
    } catch (error) {
      reportError(error, { quiet });
      const status = $("#header-status");
      status.className = "status-chip is-unknown";
      $(".status-text", status).textContent = "连接失败";
      $("#service-state").textContent = "连接失败";
      $("#service-description").textContent = "当前 WebView 无法执行模块 root 命令，请检查打开方式。";
      setServiceButtonsDisabled(state.busy);
    }
  }

  function peerPaths(peer) {
    return Array.isArray(peer.paths) ? peer.paths : [];
  }

  function isDirectPeer(peer) {
    return peerPaths(peer).some((path) => path && path.expired !== true && path.active !== false);
  }

  function renderPeers(peers) {
    state.peers = peers;
    const list = $("#peers-list");
    const directCount = peers.filter(isDirectPeer).length;
    $("#peer-count").textContent = String(peers.length);
    $("#direct-count").textContent = String(directCount);
    $("#peers-updated").textContent = `${formatClockTime()} 更新`;

    if (!peers.length) {
      list.innerHTML = '<div class="empty-state"><div><b>没有 Peer 数据</b><span>节点可能刚启动，或当前没有可用链路。</span></div></div>';
      return;
    }

    list.innerHTML = peers
      .slice()
      .sort((a, b) => String(a.role || "").localeCompare(String(b.role || "")) || Number(a.latency || 99999) - Number(b.latency || 99999))
      .map((peer) => {
        const direct = isDirectPeer(peer);
        const paths = peerPaths(peer)
          .filter(Boolean)
          .map((path) => path.address || path.endpoint || path.localSocket)
          .filter(Boolean);
        const latency = Number(peer.latency);
        const version = formatVersion(peer);
        const role = String(peer.role || "LEAF").toUpperCase();
        return `
          <article class="data-card${direct ? " is-direct" : ""}">
            <div class="data-card-head">
              <div>
                <h3>${escapeHtml(peer.address || "UNKNOWN")}</h3>
                <p class="data-card-subtitle">${escapeHtml(role === "PLANET" || role === "MOON" ? "ROOT INFRASTRUCTURE" : "ZEROTIER PEER")}</p>
              </div>
              <span class="tag${direct ? " tag-orange" : ""}">${direct ? "DIRECT" : "RELAY"}</span>
            </div>
            <div class="data-metrics">
              <div class="data-metric"><span>ROLE</span><strong>${escapeHtml(role)}</strong></div>
              <div class="data-metric"><span>LATENCY</span><strong>${Number.isFinite(latency) && latency >= 0 ? `${latency} ms` : "—"}</strong></div>
              <div class="data-metric"><span>VERSION</span><strong>${escapeHtml(version)}</strong></div>
            </div>
            <p class="path-line">${paths.length ? escapeHtml(paths.join(" · ")) : "没有活动物理路径"}</p>
          </article>`;
      })
      .join("");
  }

  async function refreshPeers({ quiet = false } = {}) {
    setRefreshSpinner("refresh-peers", true);
    try {
      const response = await api("get", "peers");
      renderPeers(normalizeList(response.data, "peers"));
      state.lastDetailRefresh = Date.now();
    } catch (error) {
      reportError(error, { quiet });
      if (!state.peers.length) {
        $("#peers-list").innerHTML = '<div class="empty-state"><div><b>无法读取 Peers</b><span>请确认 ZeroTier 服务已启动。</span></div></div>';
      }
    } finally {
      setRefreshSpinner("refresh-peers", false);
    }
  }

  function networkName(network) {
    return network.name || network.id || "UNNAMED NETWORK";
  }

  function renderNetworks(networks) {
    state.networks = networks;
    $("#network-count").textContent = String(networks.length);
    const list = $("#networks-list");
    if (!networks.length) {
      list.innerHTML = '<div class="empty-state"><div><b>尚未加入网络</b><span>在上方输入 16 位 Network ID。</span></div></div>';
      return;
    }

    list.innerHTML = networks
      .map((network) => {
        const status = String(network.status || "UNKNOWN").toUpperCase();
        const ok = status === "OK";
        const addresses = Array.isArray(network.assignedAddresses) ? network.assignedAddresses : [];
        const device = network.portDeviceName || network.device || "—";
        return `
          <article class="data-card${ok ? " is-ok" : ""}">
            <div class="data-card-head">
              <div>
                <h3>${escapeHtml(networkName(network))}</h3>
                <p class="data-card-subtitle">${escapeHtml(network.id || "—")}</p>
              </div>
              <span class="tag${ok ? " tag-orange" : ""}">${escapeHtml(status)}</span>
            </div>
            <div class="data-metrics">
              <div class="data-metric"><span>TYPE</span><strong>${escapeHtml(network.type || "—")}</strong></div>
              <div class="data-metric"><span>DEVICE</span><strong>${escapeHtml(device)}</strong></div>
              <div class="data-metric"><span>MTU</span><strong>${escapeHtml(network.mtu || "—")}</strong></div>
            </div>
            <p class="address-list">${addresses.length ? addresses.map(escapeHtml).join("<br>") : "尚未分配地址"}</p>
            <div class="network-actions">
              <button class="leave-button" type="button" data-leave-network="${escapeHtml(network.id || "")}" data-network-name="${escapeHtml(networkName(network))}">退出网络</button>
            </div>
          </article>`;
      })
      .join("");
  }

  async function refreshNetworks({ quiet = false } = {}) {
    setRefreshSpinner("refresh-networks", true);
    try {
      const response = await api("get", "networks");
      renderNetworks(normalizeList(response.data, "networks"));
      state.lastDetailRefresh = Date.now();
    } catch (error) {
      reportError(error, { quiet });
      if (!state.networks.length) {
        $("#networks-list").innerHTML = '<div class="empty-state"><div><b>无法读取网络</b><span>请确认 ZeroTier 服务已启动。</span></div></div>';
      }
    } finally {
      setRefreshSpinner("refresh-networks", false);
    }
  }

  function renderFileMetadata(prefix, file) {
    $(`#${prefix}-size`).textContent = file ? formatBytes(file.size) : "不存在";
    $(`#${prefix}-hash`).textContent = file?.sha256 ? `SHA256 ${file.sha256.slice(0, 14)}…` : "SHA256 —";
    $(`#${prefix}-time`).textContent = file ? formatTime(file.mtime) : "—";
  }

  function renderPlanet(data) {
    state.planet = data;
    renderFileMetadata("planet-current", data.current);
    renderFileMetadata("planet-backup", data.backup);
    $("#restore-planet").disabled = !data.backup || state.busy;
    $("#backup-planet").disabled = !data.current || state.busy;
    $("#pending-banner").classList.toggle("is-hidden", !data.pending);
  }

  async function refreshPlanet({ quiet = false } = {}) {
    setRefreshSpinner("refresh-planet", true);
    try {
      const response = await api("get", "planet");
      renderPlanet(response.data);
    } catch (error) {
      reportError(error, { quiet });
    } finally {
      setRefreshSpinner("refresh-planet", false);
    }
  }

  async function serviceAction(action) {
    if (state.busy) return;
    if (action === "stop") {
      const confirmed = await confirmAction(
        "停止 ZeroTier？",
        "当前节点的虚拟网络连接会立即断开；开机自启设置不会被修改。",
        "停止服务",
        true,
      );
      if (!confirmed) return;
    }

    state.busy = true;
    setServiceButtonsDisabled(true);
    $("#autostart-toggle").disabled = true;
    try {
      const response = await api("service", action);
      toast(response.message || "服务操作完成");
      if (typeof response.data?.running === "boolean") {
        renderOverview({
          running: response.data.running,
          autostart: state.overview?.autostart ?? true,
          planetPending: state.overview?.planetPending ?? false,
          info: response.data.running ? state.overview?.info ?? null : null,
        });
      }
      await refreshOverview({ quiet: true });
      if (state.page === "planet") await refreshPlanet({ quiet: true });
      if (action === "stop") {
        state.peers = [];
        state.networks = [];
      }
    } catch (error) {
      reportError(error);
    } finally {
      state.busy = false;
      setServiceButtonsDisabled(false);
      $("#autostart-toggle").disabled = false;
    }
  }

  async function toggleAutostart(event) {
    if (state.busy) return;
    const checkbox = event.currentTarget;
    const requested = checkbox.checked;
    checkbox.disabled = true;
    try {
      const response = await api("autostart", requested ? "enable" : "disable");
      toast(response.message || (requested ? "已启用开机自启" : "已关闭开机自启"));
      if (state.overview) state.overview.autostart = requested;
    } catch (error) {
      checkbox.checked = !requested;
      reportError(error);
    } finally {
      checkbox.disabled = false;
    }
  }

  async function joinNetwork(event) {
    event.preventDefault();
    const input = $("#network-id");
    const networkId = input.value.trim().toLowerCase();
    if (!/^[0-9a-f]{16}$/.test(networkId)) {
      toast("Network ID 必须是 16 位十六进制字符", "error");
      input.focus();
      return;
    }

    const button = $("button[type='submit']", event.currentTarget);
    button.disabled = true;
    try {
      const response = await api("network", "join", networkId);
      toast(response.message || "已提交加入网络请求");
      input.value = "";
      window.setTimeout(() => refreshNetworks({ quiet: true }), 700);
    } catch (error) {
      reportError(error);
    } finally {
      button.disabled = false;
    }
  }

  async function leaveNetwork(button) {
    const networkId = button.dataset.leaveNetwork;
    const name = button.dataset.networkName || networkId;
    if (!/^[0-9a-f]{16}$/i.test(networkId || "")) return;
    const confirmed = await confirmAction(
      `退出 ${name}？`,
      `节点将离开网络 ${networkId}，已分配的虚拟地址会被移除。`,
      "退出网络",
      true,
    );
    if (!confirmed) return;

    button.disabled = true;
    try {
      const response = await api("network", "leave", networkId);
      toast(response.message || "已退出网络");
      await refreshNetworks({ quiet: true });
    } catch (error) {
      reportError(error);
    } finally {
      button.disabled = false;
    }
  }

  function bytesToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const block = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += block) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + block));
    }
    return btoa(binary);
  }

  function updateUploadProgress(percent, stage) {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    $("#upload-progress").classList.remove("is-hidden");
    $("#upload-stage").textContent = stage;
    $("#upload-percent").textContent = `${value}%`;
    $("#upload-bar").style.width = `${value}%`;
  }

  function choosePlanetFile(event) {
    const file = event.currentTarget.files?.[0] || null;
    state.selectedPlanet = file;
    if (!file) {
      $("#planet-file-label").textContent = "选择 Planet 文件";
      $("#replace-planet").disabled = true;
      return;
    }
    $("#planet-file-label").textContent = `${file.name} · ${formatBytes(file.size)}`;
    $("#replace-planet").disabled = file.size <= 0 || file.size > 1024 * 1024;
    if (file.size <= 0 || file.size > 1024 * 1024) {
      toast("Planet 文件必须小于 1 MiB 且不能为空", "error");
    }
  }

  async function replacePlanet() {
    const file = state.selectedPlanet;
    if (!file || state.busy) return;
    const confirmed = await confirmAction(
      "替换当前 Planet？",
      "当前文件会保存为最近备份。替换完成后不会自动重启 ZeroTier。",
      "上传并替换",
    );
    if (!confirmed) return;

    state.busy = true;
    $("#replace-planet").disabled = true;
    $("#restore-planet").disabled = true;
    try {
      updateUploadProgress(2, "正在读取文件");
      const base64 = bytesToBase64(await file.arrayBuffer());
      await api("planet", "begin", String(file.size));
      const chunkSize = 24576;
      for (let offset = 0; offset < base64.length; offset += chunkSize) {
        const chunk = base64.slice(offset, offset + chunkSize);
        await api("planet", "append", chunk);
        updateUploadProgress(5 + ((offset + chunk.length) / base64.length) * 88, "正在安全上传");
      }
      updateUploadProgress(96, "正在校验并替换");
      const response = await api("planet", "commit");
      updateUploadProgress(100, "替换完成");
      toast(response.message || "Planet 已替换");
      state.selectedPlanet = null;
      $("#planet-file").value = "";
      $("#planet-file-label").textContent = "选择 Planet 文件";
      await Promise.all([refreshPlanet({ quiet: true }), refreshOverview({ quiet: true })]);
    } catch (error) {
      reportError(error);
    } finally {
      state.busy = false;
      window.setTimeout(() => $("#upload-progress").classList.add("is-hidden"), 1100);
      $("#replace-planet").disabled = !state.selectedPlanet;
      $("#restore-planet").disabled = !state.planet?.backup;
    }
  }

  async function restorePlanet() {
    if (!state.planet?.backup || state.busy) return;
    const confirmed = await confirmAction(
      "恢复最近 Planet 备份？",
      "当前 Planet 将被最近一份内部备份覆盖。完成后需要手动重启 ZeroTier。",
      "恢复备份",
      true,
    );
    if (!confirmed) return;

    state.busy = true;
    $("#restore-planet").disabled = true;
    try {
      const response = await api("planet", "restore");
      toast(response.message || "Planet 备份已恢复");
      await Promise.all([refreshPlanet({ quiet: true }), refreshOverview({ quiet: true })]);
    } catch (error) {
      reportError(error);
    } finally {
      state.busy = false;
      $("#restore-planet").disabled = !state.planet?.backup;
    }
  }

  async function backupPlanet() {
    const path = $("#backup-path").value.trim().replace(/\/+$/, "") || "/sdcard/Download/ZeroTier";
    if (!/^(\/sdcard(?:\/|$)|\/storage\/emulated\/\d+(?:\/|$)|\/data\/local\/tmp(?:\/|$))/.test(path) || path.includes("..")) {
      toast("备份路径仅支持共享存储或 /data/local/tmp，且不能包含 ..", "error");
      return;
    }
    const button = $("#backup-planet");
    button.disabled = true;
    try {
      const response = await api("planet", "backup", path);
      const output = $("#backup-result");
      output.textContent = response.data?.path || response.message || "备份完成";
      output.classList.remove("is-hidden");
      toast(response.message || "Planet 已备份");
    } catch (error) {
      reportError(error);
    } finally {
      button.disabled = !state.planet?.current;
    }
  }

  function selectBackupDestination(event) {
    const select = event.currentTarget;
    const input = $("#backup-path");
    const field = $("#backup-path-field");
    if (select.value === "custom") {
      input.value = input.dataset.customPath || "/sdcard/ZeroTier";
      input.readOnly = false;
      field.classList.add("is-editable");
      window.requestAnimationFrame(() => input.focus());
      return;
    }

    if (!input.readOnly && input.value.trim()) {
      input.dataset.customPath = input.value.trim();
    }
    input.value = select.value;
    input.readOnly = true;
    field.classList.remove("is-editable");
  }

  function confirmAction(title, message, confirmLabel, danger = false) {
    const dialog = $("#confirm-dialog");
    if (dialog.open) return Promise.resolve(false);
    $("#confirm-title").textContent = title;
    $("#confirm-message").textContent = message;
    const confirmButton = $("#confirm-button");
    confirmButton.textContent = confirmLabel;
    confirmButton.classList.toggle("is-danger", danger);

    return new Promise((resolve) => {
      const onClose = () => {
        dialog.removeEventListener("close", onClose);
        resolve(dialog.returnValue === "confirm");
      };
      dialog.addEventListener("close", onClose);
      dialog.returnValue = "";
      try {
        dialog.showModal();
      } catch (_) {
        dialog.removeEventListener("close", onClose);
        resolve(window.confirm(`${title}\n\n${message}`));
      }
    });
  }

  function activatePage(page, syncHash = true) {
    if (!$( `[data-page="${page}"]` )) return;
    state.page = page;
    $$('[data-page]').forEach((section) => section.classList.toggle("is-active", section.dataset.page === page));
    $$('[data-nav]').forEach((button) => button.classList.toggle("is-active", button.dataset.nav === page));
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (syncHash && window.location.hash !== `#${page}`) {
      window.history.replaceState(null, "", `#${page}`);
    }

    if (page === "peers") refreshPeers({ quiet: state.peers.length > 0 });
    if (page === "networks") refreshNetworks({ quiet: state.networks.length > 0 });
    if (page === "planet") refreshPlanet({ quiet: Boolean(state.planet) });
  }

  function bindEvents() {
    $$('[data-nav]').forEach((button) => button.addEventListener("click", () => activatePage(button.dataset.nav)));
    $$('[data-service-action]').forEach((button) => button.addEventListener("click", () => serviceAction(button.dataset.serviceAction)));
    $("#header-status").addEventListener("click", () => refreshOverview());
    $('[data-action="refresh-peers"]').addEventListener("click", () => refreshPeers());
    $('[data-action="refresh-networks"]').addEventListener("click", () => refreshNetworks());
    $('[data-action="refresh-planet"]').addEventListener("click", () => refreshPlanet());
    $("#autostart-toggle").addEventListener("change", toggleAutostart);
    $("#join-form").addEventListener("submit", joinNetwork);
    $("#networks-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-leave-network]");
      if (button) leaveNetwork(button);
    });
    $("#planet-file").addEventListener("change", choosePlanetFile);
    $("#replace-planet").addEventListener("click", replacePlanet);
    $("#restore-planet").addEventListener("click", restorePlanet);
    $("#backup-preset").addEventListener("change", selectBackupDestination);
    $("#backup-path").addEventListener("input", (event) => {
      event.currentTarget.dataset.customPath = event.currentTarget.value;
    });
    $("#backup-planet").addEventListener("click", backupPlanet);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        refreshOverview({ quiet: true });
        if (state.page === "peers") refreshPeers({ quiet: true });
        if (state.page === "networks") refreshNetworks({ quiet: true });
        if (state.page === "planet") refreshPlanet({ quiet: true });
      }
    });
  }

  async function initialize() {
    bindEvents();
    renderPeers([]);
    renderNetworks([]);
    const initialPage = window.location.hash.slice(1);
    if (["control", "peers", "networks", "planet"].includes(initialPage)) {
      activatePage(initialPage, false);
    }
    await refreshOverview();
    window.setInterval(() => {
      if (document.hidden || state.busy) return;
      refreshOverview({ quiet: true });
      if (Date.now() - state.lastDetailRefresh < DETAIL_REFRESH_INTERVAL) return;
      if (state.page === "peers") refreshPeers({ quiet: true });
      if (state.page === "networks") refreshNetworks({ quiet: true });
    }, REFRESH_INTERVAL);
  }

  initialize();
})();
