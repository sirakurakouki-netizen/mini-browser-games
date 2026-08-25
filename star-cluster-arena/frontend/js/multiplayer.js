(function () {
  "use strict";

  const PROTOCOL_VERSION = "sca-lan-v6";
  const RECONNECT_GRACE_MS = 15_000;
  const CONNECT_TIMEOUT_MS = 1800;
  const MAX_ENDPOINTS = 3;
  const INPUT_INTERVAL_MS = 1000 / 60;
  const HUD_INTERVAL_MS = 160;
  const FOOD_COLORS = ["#44d7b6", "#67e8f9", "#ffd166", "#ff7a90", "#a78bfa", "#f59e0b", "#7dd3fc", "#f472b6"];
  const fallbackModes = [
    ["solo", "自由模式", "限时成长并反复复活，按个人总质量排名。", 100],
    ["team", "团队战", "10 队 4 人协作，按队伍总质量结算。", 40],
    ["survival", "生存模式", "每人三条生命，生命耗尽出局。", 64],
    ["battle", "大逃杀", "安全区持续收缩，无复活，活到最后。", 100],
    ["blitz", "闪电乱斗", "三分钟高资源快节奏乱斗。", 88],
    ["spore", "孢子风暴", "撞击孢子刺球会喷出可争夺质量。", 48],
    ["screen", "霸屏模式", "方形战场，支持快合与冲刺种刺。", 22],
    ["control", "据点战", "四队七人争夺三个星核据点。", 28],
    ["giant", "巨行星霸屏", "巨球开局，维持质量制霸即可获胜。", 36],
    ["demon", "魔王模式", "所有真人合作击败魔王与魔兵。", 10]
  ].map(([key, label, description, targetParticipants]) => ({ key, label, short: label, description, targetParticipants }));

  const cosmeticCatalog = window.ScaCosmeticCatalog;
  if (!cosmeticCatalog) throw new Error("Shared cosmetic catalog failed to load");
  const gameplayCore = window.ScaGameplayCore;
  if (!gameplayCore) throw new Error("Shared gameplay core failed to load");
  const settingsApi = window.ScaGameSettings;
  if (!settingsApi) throw new Error("Shared game settings failed to load");
  const gameSettings = settingsApi.load();
  const displayRefresh = settingsApi.displayRefresh();
  const targetRenderFps = settingsApi.targetFps(gameSettings, displayRefresh);
  const targetRenderInterval = 1000 / targetRenderFps;
  const qualityPreset = settingsApi.qualityPreset(gameSettings);
  const networkPreset = settingsApi.networkPreset(gameSettings);

  const elements = {
    topbar: document.getElementById("topbar"),
    lobbyView: document.getElementById("lobbyView"),
    roomView: document.getElementById("roomView"),
    gameView: document.getElementById("gameView"),
    connectionPill: document.getElementById("connectionPill"),
    connectionText: document.getElementById("connectionText"),
    nickname: document.getElementById("nicknameInput"),
    modeSelect: document.getElementById("modeSelect"),
    modeDescription: document.getElementById("modeDescription"),
    maxPlayers: document.getElementById("maxPlayersSelect"),
    autoFillPreview: document.getElementById("autoFillPreview"),
    createRoom: document.getElementById("createRoomBtn"),
    refreshRooms: document.getElementById("refreshRoomsBtn"),
    roomCodeInput: document.getElementById("roomCodeInput"),
    joinCode: document.getElementById("joinCodeBtn"),
    discoveryStatus: document.getElementById("discoveryStatus"),
    networkWarning: document.getElementById("networkWarning"),
    networkWarningTitle: document.getElementById("networkWarningTitle"),
    networkWarningText: document.getElementById("networkWarningText"),
    openFirewallSettings: document.getElementById("openFirewallSettingsBtn"),
    roomList: document.getElementById("roomList"),
    roomName: document.getElementById("roomName"),
    roomCode: document.getElementById("roomCode"),
    copyRoomCode: document.getElementById("copyRoomCodeBtn"),
    roomMode: document.getElementById("roomMode"),
    roomSettingsPanel: document.getElementById("roomSettingsPanel"),
    roomModeSelect: document.getElementById("roomModeSelect"),
    roomAutoFill: document.getElementById("roomAutoFill"),
    roomModeDescription: document.getElementById("roomModeDescription"),
    roomCapacity: document.getElementById("roomCapacity"),
    roomBots: document.getElementById("roomBots"),
    playerList: document.getElementById("playerList"),
    leaveRoom: document.getElementById("leaveRoomBtn"),
    ready: document.getElementById("readyBtn"),
    startMatch: document.getElementById("startMatchBtn"),
    roomHint: document.getElementById("roomHint"),
    canvas: document.getElementById("multiplayerCanvas"),
    mass: document.getElementById("gameMass"),
    rank: document.getElementById("gameRank"),
    kills: document.getElementById("gameKills"),
    latency: document.getElementById("gameLatency"),
    gameModeName: document.getElementById("gameModeName"),
    gameObjective: document.getElementById("gameObjective"),
    gameNetworkDetail: document.getElementById("gameNetworkDetail"),
    gameTip: document.getElementById("gameTip"),
    timer: document.getElementById("gameTimer"),
    ranking: document.getElementById("gameRanking"),
    gameRoomCode: document.getElementById("gameRoomCode"),
    networkState: document.getElementById("gameNetworkState"),
    exitMatch: document.getElementById("exitMatchBtn"),
    touchSplit: document.getElementById("touchSplitBtn"),
    touchEject: document.getElementById("touchEjectBtn"),
    touchQuickMerge: document.getElementById("touchQuickMergeBtn"),
    touchSpecial: document.getElementById("touchSpecialBtn"),
    reconnectOverlay: document.getElementById("reconnectOverlay"),
    reconnectText: document.getElementById("reconnectText"),
    sessionMenu: document.getElementById("sessionMenu"),
    sessionMenuTitle: document.getElementById("sessionMenuTitle"),
    sessionMenuText: document.getElementById("sessionMenuText"),
    sessionContinue: document.getElementById("sessionContinueBtn"),
    sessionLeave: document.getElementById("sessionLeaveBtn"),
    sessionHome: document.getElementById("sessionHomeBtn"),
    toast: document.getElementById("toast")
  };

  const context = elements.canvas.getContext("2d", { alpha: false, desynchronized: true });
  const snapshotBuffer = new window.ScaSnapshotBuffer.SnapshotBuffer({
    capacity: 32,
    minimumDelayMs: networkPreset.minimumDelayMs,
    maximumDelayMs: networkPreset.maximumDelayMs,
    maximumExtrapolationMs: networkPreset.maximumExtrapolationMs
  });
  const state = {
    view: "lobby",
    rooms: [],
    roomListSignature: "",
    discovery: null,
    diagnostics: null,
    servicePort: 0,
    preferredPort: 0,
    bindHost: "",
    modes: fallbackModes,
    refreshing: false,
    joining: false,
    socket: null,
    endpoint: "",
    endpoints: [],
    roomCode: "",
    matchId: "",
    baselineId: "",
    hostToken: "",
    resumeToken: "",
    playerId: "",
    isHost: false,
    room: null,
    ready: false,
    manualClose: false,
    reconnectStartedAt: 0,
    reconnectTimer: null,
    connectionAttempt: 0,
    connectionGeneration: 0,
    latestSnapshot: null,
    confirmedRemovedFoodIds: new Set(),
    confirmedRemovedEjectedIds: new Set(),
    snapshotBuffer,
    latency: 0,
    inputSeq: 0,
    input: {
      dx: 0,
      dy: 0,
      targetX: 2600,
      targetY: 2600,
      split: false,
      eject: false,
      quickMerge: false,
      special: false
    },
    inputHistory: [],
    lastAckInputSeq: 0,
    lastBaselineRequestAt: 0,
    matchFinishedHandled: false,
    inputTimer: null,
    pingTimer: null,
    camera: { x: 2600, y: 2600, zoom: 0.8 },
    pointer: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    toastTimer: null,
    roomRefreshTimer: null,
    renderFrame: 0,
    nextRenderAt: 0,
    lastRenderAt: 0,
    lastHudAt: 0,
    smoothedFps: 60
  };

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function trimIdSet(values, maximum) {
    while (values.size > maximum) values.delete(values.values().next().value);
  }

  function setConnection(stateName, text) {
    elements.connectionPill.dataset.state = stateName;
    elements.connectionText.textContent = text;
  }

  function showToast(message, error = false) {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle("error", error);
    elements.toast.classList.add("show");
    state.toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 3200);
  }

  function setView(view) {
    state.view = view;
    if (elements.sessionMenu) elements.sessionMenu.hidden = true;
    elements.lobbyView.hidden = view !== "lobby";
    elements.roomView.hidden = view !== "room";
    elements.gameView.hidden = view !== "game";
    elements.topbar.hidden = view === "game";
    if (view === "game") resizeCanvas();
  }

  function mainMenuUrl() {
    const url = new URL("./", location.href);
    const params = new URLSearchParams(location.search);
    if (params.has("desktop")) url.searchParams.set("desktop", params.get("desktop"));
    if (params.has("refresh")) url.searchParams.set("refresh", params.get("refresh"));
    return url.href;
  }

  function goToMainMenu() {
    location.href = mainMenuUrl();
  }

  function closeSessionMenu() {
    if (elements.sessionMenu) elements.sessionMenu.hidden = true;
    elements.canvas?.focus?.({ preventScroll: true });
  }

  function openSessionMenu() {
    if (state.view === "lobby") {
      goToMainMenu();
      return;
    }
    const inGame = state.view === "game";
    const hostWarning = state.isHost ? "你是房主，退出会关闭当前房间并让其他玩家返回大厅。" : "退出后你会离开当前房间。";
    elements.sessionMenuTitle.textContent = inGame ? "联机对局菜单" : "离开等待房间？";
    elements.sessionMenuText.textContent = inGame ? `联机对局不会暂停服务器。${hostWarning}` : hostWarning;
    elements.sessionContinue.textContent = inGame ? "继续对局" : "留在房间";
    elements.sessionLeave.textContent = state.isHost ? "关闭房间" : "离开房间";
    elements.sessionMenu.hidden = false;
    requestAnimationFrame(() => elements.sessionContinue.focus({ preventScroll: true }));
  }

  function playerName() {
    const value = elements.nickname.value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
    return value || "星友";
  }

  async function jsonRequest(url, options) {
    const response = await fetch(url, { cache: "no-store", ...options });
    const value = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value?.message || value?.error || `请求失败 (${response.status})`);
    return value;
  }

  function modeInfo(key) {
    return state.modes.find(mode => mode.key === key) || state.modes[0] || fallbackModes[0];
  }

  function modeLabel(key) {
    return modeInfo(key).label;
  }

  function localCosmetics() {
    return cosmeticCatalog.normalizeProfile({
      skin: localStorage.getItem("ballArenaSkin"),
      spore: localStorage.getItem("ballArenaSpore"),
      halo: localStorage.getItem("ballArenaHalo"),
      trail: localStorage.getItem("ballArenaTrail")
    });
  }

  function configureModeControls(mode) {
    const screenMode = mode === "screen";
    if (elements.touchQuickMerge) elements.touchQuickMerge.hidden = !screenMode;
    if (elements.touchSpecial) elements.touchSpecial.hidden = !screenMode;
    if (elements.gameTip) {
      elements.gameTip.textContent = screenMode
        ? "移动鼠标控制方向 · 空格分裂 · 按住 W 吐球 · A 快速合体 · D 冲刺种刺"
        : "移动鼠标控制方向 · 空格分裂 · 按住 W 吐球";
    }
  }

  function populateModeSelect(select, selected = "solo") {
    if (!select) return;
    const previous = selected || select.value || "solo";
    select.replaceChildren();
    for (const mode of state.modes) {
      const option = document.createElement("option");
      option.value = mode.key;
      option.textContent = mode.label;
      select.append(option);
    }
    select.value = state.modes.some(mode => mode.key === previous) ? previous : "solo";
  }

  function updateModeDescription() {
    if (!elements.modeSelect || !elements.modeDescription) return;
    elements.modeDescription.textContent = modeInfo(elements.modeSelect.value).description;
    const target = modeInfo(elements.modeSelect.value).targetParticipants || modeInfo(elements.modeSelect.value).canonical?.participants || 8;
    if (elements.autoFillPreview) elements.autoFillPreview.textContent = `真人优先，自动补足到 ${target} 个参赛者`;
  }

  async function loadModes() {
    try {
      const value = await jsonRequest("/api/modes");
      if (Array.isArray(value.modes) && value.modes.length) state.modes = value.modes;
    } catch {
      state.modes = fallbackModes;
    }
    populateModeSelect(elements.modeSelect, elements.modeSelect?.value || "solo");
    populateModeSelect(elements.roomModeSelect, state.room?.settings?.mode || "solo");
    updateModeDescription();
  }

  function normalizeCode(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  }

  function normalizedEndpoints(roomOrEndpoints) {
    const values = Array.isArray(roomOrEndpoints)
      ? roomOrEndpoints
      : [...(Array.isArray(roomOrEndpoints?.endpoints) ? roomOrEndpoints.endpoints : []), roomOrEndpoints?.endpoint];
    return [...new Set(values.filter(value => typeof value === "string" && /^wss?:\/\//i.test(value)))].slice(0, MAX_ENDPOINTS);
  }

  function renderNetworkDiagnostics() {
    const firewall = state.diagnostics?.firewall;
    const discoveryFailed = state.discovery && (!state.discovery.listening || state.discovery.lastError);
    const loopbackOnly = ["127.0.0.1", "::1", "localhost"].includes(String(state.bindHost).toLowerCase());
    const fallbackPort = state.preferredPort > 0 && state.servicePort > 0 && state.preferredPort !== state.servicePort;
    let status = "";
    let title = "";
    let message = "";
    if (firewall?.status === "blocked") {
      status = "blocked";
      title = "当前电脑被防火墙阻止作为房主";
      message = firewall.message;
    } else if (loopbackOnly) {
      status = "blocked";
      title = "服务只监听本机，其他电脑一定无法加入";
      message = `当前监听地址是 ${state.bindHost}:${state.servicePort}。请关闭占用端口的旧服务，并以 HOST=0.0.0.0 启动；桌面封装版会自动这样启动。`;
    } else if (discoveryFailed) {
      status = "blocked";
      title = "局域网房间发现不可用";
      message = state.discovery.lastError || "UDP 发现端口未成功启动；仍可使用本机房间，但其他电脑可能看不到它。";
    } else if (firewall?.status === "missing") {
      status = "missing";
      title = "首次建房需要确认网络权限";
      message = firewall.message;
    } else if (fallbackPort) {
      status = "missing";
      title = `首选端口 ${state.preferredPort} 已被占用`;
      message = `当前服务已自动改用 TCP ${state.servicePort}。通常是旧游戏或旧 Node 服务仍在后台；局域网发现仍会广播实际端口，但建议关闭旧进程后重启。`;
    }
    elements.networkWarning.hidden = !status;
    if (!status) return;
    elements.networkWarning.dataset.state = status;
    elements.networkWarningTitle.textContent = title;
    elements.networkWarningText.textContent = message;
    elements.openFirewallSettings.hidden = typeof window.starClusterDesktop?.openFirewallSettings !== "function";
  }

  function roomLabel(room) {
    const stateName = room.state === "lobby" ? "等待中" : room.state === "running" ? "对局中" : "已结束";
    return `${modeLabel(room.mode)} · ${room.players}/${room.maxPlayers} 真人 · ${room.botCount} AI 自动补位 · ${stateName}`;
  }

  function renderRoomList() {
    const joinable = state.rooms.filter(room => room.state === "lobby");
    const signature = JSON.stringify(joinable.map(room => ({
      code: room.code,
      name: room.name,
      state: room.state,
      players: room.players,
      maxPlayers: room.maxPlayers,
      botCount: room.botCount,
      mode: room.mode,
      source: room.source,
      endpoints: normalizedEndpoints(room)
    })));
    if (signature === state.roomListSignature) return;
    state.roomListSignature = signature;
    elements.roomList.replaceChildren();
    if (!joinable.length) {
      const empty = document.createElement("div");
      empty.className = "room-empty";
      empty.textContent = "暂未发现房间。让房主先创建房间，或检查双方是否连接到同一个局域网。";
      elements.roomList.append(empty);
      return;
    }
    for (const room of joinable) {
      const button = document.createElement("button");
      button.className = "room-item";
      button.type = "button";
      const copy = document.createElement("span");
      const name = document.createElement("strong");
      const details = document.createElement("small");
      const code = document.createElement("b");
      name.textContent = room.name;
      const candidates = normalizedEndpoints(room).length;
      details.textContent = `${roomLabel(room)} · ${room.source === "local" ? "本机" : `${candidates} 条连接路径`}`;
      code.textContent = room.code;
      copy.append(name, details);
      button.append(copy, code);
      button.addEventListener("click", () => joinDiscoveredRoom(room));
      elements.roomList.append(button);
    }
  }

  async function refreshRooms(showErrors = false, probe = false) {
    if (state.refreshing || state.view !== "lobby") return;
    state.refreshing = true;
    elements.refreshRooms.classList.add("busy");
    if (probe) setConnection("busy", "正在主动扫描");
    try {
      const value = await jsonRequest(probe ? "/api/lan/probe" : "/api/lan/rooms", probe ? { method: "POST" } : undefined);
      state.rooms = Array.isArray(value.rooms) ? value.rooms : [];
      state.discovery = value.discovery || null;
      state.diagnostics = value.diagnostics || null;
      state.servicePort = Number(value.servicePort) || 0;
      state.preferredPort = Number(value.preferredPort) || 0;
      state.bindHost = String(value.bindHost || "");
      renderRoomList();
      renderNetworkDiagnostics();
      const discovered = state.rooms.filter(room => room.source === "lan").length;
      const local = state.rooms.filter(room => room.source === "local").length;
      const warning = state.discovery?.lastError ? ` · 发现服务提示：${state.discovery.lastError}` : "";
      const addresses = state.discovery?.addresses?.length ? ` · 地址 ${state.discovery.addresses.join(" / ")}` : "";
      const ports = state.servicePort ? ` · TCP ${state.servicePort} / UDP ${state.discovery?.port || "--"}` : "";
      elements.discoveryStatus.textContent = `已扫描：${discovered} 个局域网房间，${local} 个本机房间${ports}${addresses}${warning}`;
      setConnection("online", "联机服务正常");
    } catch (error) {
      elements.discoveryStatus.textContent = "无法连接本机联机服务，请通过启动器或桌面版打开游戏。";
      setConnection("error", "联机服务不可用");
      if (showErrors) showToast(error.message, true);
    } finally {
      state.refreshing = false;
      elements.refreshRooms.classList.remove("busy");
    }
  }

  async function createRoom() {
    if (state.diagnostics?.firewall?.status === "blocked") {
      showToast("防火墙正在阻止入站连接；房间可以创建，但其他电脑大概率无法加入。", true);
    }
    elements.createRoom.disabled = true;
    setConnection("busy", "正在创建房间");
    try {
      const name = playerName();
      localStorage.setItem("starClusterPlayerName", name);
      const value = await jsonRequest("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          roomName: `${name}的星团`,
          mode: elements.modeSelect?.value || "solo",
          maxPlayers: Number(elements.maxPlayers.value)
        })
      });
      state.hostToken = value.hostToken;
      state.diagnostics = value.diagnostics || state.diagnostics;
      renderNetworkDiagnostics();
      await connectRoom(value.endpoints || [value.endpoint], value.code, { hostToken: value.hostToken });
    } catch (error) {
      setConnection("error", "创建失败");
      showToast(error.message, true);
    } finally {
      elements.createRoom.disabled = false;
    }
  }

  async function joinDiscoveredRoom(room) {
    if (!normalizedEndpoints(room).length || room.state !== "lobby" || state.joining) return;
    localStorage.setItem("starClusterPlayerName", playerName());
    try {
      await connectRoom(room, room.code);
    } catch (error) {
      setConnection("error", "房主不可达");
      showToast(error.message, true);
    }
  }

  async function joinByCode() {
    const code = normalizeCode(elements.roomCodeInput.value);
    elements.roomCodeInput.value = code;
    if (code.length !== 6) {
      showToast("请输入完整的 6 位房间码", true);
      return;
    }
    await refreshRooms(true, true);
    const room = state.rooms.find(item => item.code === code && item.state === "lobby");
    if (!room) {
      showToast("当前局域网没有发现这个房间，请让房主确认房间仍在等待中", true);
      return;
    }
    await joinDiscoveredRoom(room);
  }

  function sessionKey(endpoint, code) {
    return `starClusterSession:${endpoint.replace(/[?#].*$/, "")}:${code}`;
  }

  function storedResumeToken(endpoint, code) {
    try {
      return JSON.parse(sessionStorage.getItem(sessionKey(endpoint, code)) || "null")?.resumeToken || "";
    } catch {
      return "";
    }
  }

  function storeSession() {
    if (!state.endpoint || !state.roomCode || !state.resumeToken) return;
    sessionStorage.setItem(sessionKey(state.endpoint, state.roomCode), JSON.stringify({
      resumeToken: state.resumeToken,
      playerId: state.playerId
    }));
  }

  function clearStoredSessions() {
    for (const endpoint of [...state.endpoints, state.endpoint]) {
      if (endpoint && state.roomCode) sessionStorage.removeItem(sessionKey(endpoint, state.roomCode));
    }
  }

  function send(value) {
    if (state.socket?.readyState !== WebSocket.OPEN) return false;
    state.socket.send(JSON.stringify(value));
    return true;
  }

  function setJoining(joining) {
    state.joining = joining;
    elements.joinCode.disabled = joining;
    elements.refreshRooms.disabled = joining;
    elements.createRoom.disabled = joining;
  }

  function connectEndpoint(endpoint, generation, { reconnect = false, hostToken = "" } = {}) {
    return new Promise((resolve, reject) => {
      let active = true;
      let joined = false;
      const socket = new WebSocket(endpoint);
      state.socket = socket;
      const timer = setTimeout(() => fail(new Error("连接房主超时")), CONNECT_TIMEOUT_MS);

      function isCurrent() {
        return active && generation === state.connectionGeneration;
      }

      function fail(error) {
        if (!isCurrent()) return;
        active = false;
        clearTimeout(timer);
        try { socket.close(1000, "candidate-failed"); } catch {}
        reject(error);
      }

      socket.addEventListener("open", () => {
        if (!isCurrent()) return;
        const resumeToken = reconnect ? state.resumeToken : storedResumeToken(endpoint, state.roomCode);
        socket.send(JSON.stringify({
          type: "join",
          protocol: PROTOCOL_VERSION,
          name: playerName(),
          cosmetics: localCosmetics(),
          hostToken: hostToken || state.hostToken,
          resumeToken
        }));
      });
      socket.addEventListener("message", event => {
        if (!isCurrent()) return;
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (!joined && message.type === "error") {
          fail(new Error(message.message || "无法加入房间"));
          return;
        }
        if (!joined && message.type === "welcome") {
          joined = true;
          clearTimeout(timer);
          state.endpoint = endpoint;
          handleServerMessage(message);
          resolve(message);
          return;
        }
        if (joined) handleServerMessage(message);
      });
      socket.addEventListener("error", () => {
        if (!joined) fail(new Error("连接路径不可达"));
      });
      socket.addEventListener("close", () => {
        if (!isCurrent()) return;
        active = false;
        clearTimeout(timer);
        if (!joined) {
          reject(new Error("房间连接已关闭"));
          return;
        }
        handleSocketClose();
      });
    });
  }

  async function connectRoom(roomOrEndpoints, code, { hostToken = "", reconnect = false } = {}) {
    const candidates = normalizedEndpoints(roomOrEndpoints);
    if (!candidates.length) throw new Error("房间没有可用的连接地址");
    const generation = ++state.connectionGeneration;
    if (!reconnect) {
      state.manualClose = false;
      state.endpoints = candidates;
      state.roomCode = normalizeCode(code);
      state.hostToken = hostToken;
      state.reconnectStartedAt = 0;
      state.connectionAttempt = 0;
    }
    setJoining(true);
    let lastError = null;
    for (let index = 0; index < candidates.length; index += 1) {
      if (generation !== state.connectionGeneration) throw new Error("连接已取消");
      state.connectionAttempt += 1;
      setConnection("busy", `正在尝试房主 ${index + 1}/${candidates.length}`);
      try {
        const welcome = await connectEndpoint(candidates[index], generation, { reconnect, hostToken });
        if (generation === state.connectionGeneration) setJoining(false);
        return welcome;
      } catch (error) {
        lastError = error;
      }
    }
    if (generation === state.connectionGeneration) setJoining(false);
    throw new Error(`已尝试 ${candidates.length} 条连接路径仍无法加入；请让房主检查 Windows 防火墙是否允许专用网络。${lastError ? `（${lastError.message}）` : ""}`);
  }

  function handleServerMessage(message) {
    switch (message.type) {
      case "hello":
        break;
      case "welcome":
        state.playerId = message.playerId;
        state.resumeToken = message.resumeToken;
        state.isHost = Boolean(message.host);
        state.room = message.room;
        state.ready = Boolean(message.room.players.find(player => player.id === state.playerId)?.ready);
        state.reconnectStartedAt = 0;
        elements.reconnectOverlay.hidden = true;
        storeSession();
        setConnection("online", state.isHost ? "已创建房间" : "已加入房间");
        if (message.room.state === "lobby") setView("room");
        renderWaitingRoom();
        startConnectionTimers();
        break;
      case "lobby":
        state.room = message.room;
        state.ready = Boolean(message.room.players.find(player => player.id === state.playerId)?.ready);
        if (state.view !== "game" || (state.matchFinishedHandled && message.room.state === "lobby")) {
          if (state.view === "game") {
            state.snapshotBuffer.clear();
            state.latestSnapshot = null;
            state.matchId = "";
            state.baselineId = "";
          }
          setView("room");
          renderWaitingRoom();
        }
        break;
      case "match-start":
        state.latestSnapshot = null;
        state.confirmedRemovedFoodIds.clear();
        state.confirmedRemovedEjectedIds.clear();
        state.snapshotBuffer.clear();
        state.inputHistory = [];
        state.lastAckInputSeq = 0;
        state.lastBaselineRequestAt = 0;
        state.matchFinishedHandled = false;
        state.matchId = message.matchId || "";
        state.baselineId = message.baselineId || "";
        state.lastHudAt = 0;
        state.camera = { x: message.world.width / 2, y: message.world.height / 2, zoom: 0.8 };
        elements.gameRoomCode.textContent = `房间 ${state.roomCode}`;
        elements.networkState.textContent = message.resumed ? "已恢复" : "已连接";
        if (elements.gameModeName) elements.gameModeName.textContent = modeLabel(message.mode || state.room?.settings?.mode || "solo");
        configureModeControls(message.mode || state.room?.settings?.mode || "solo");
        setView("game");
        break;
      case "snapshot":
        message = globalThis.ScaSnapshotWire?.decodeSnapshot(message) || message;
        if (state.matchId && message.matchId && message.matchId !== state.matchId) break;
        if (state.baselineId && message.baselineId && message.baselineId !== state.baselineId) {
          state.snapshotBuffer.clear();
          state.baselineId = message.baselineId;
        }
        for (const id of message.foodDelta?.removed || []) state.confirmedRemovedFoodIds.add(id);
        for (const item of message.foodDelta?.added || []) state.confirmedRemovedFoodIds.delete(item.id);
        const previousEjected = state.latestSnapshot?.ejected || [];
        const currentEjectedIds = new Set((message.ejected || []).map(item => item.id));
        for (const item of previousEjected) {
          if (!currentEjectedIds.has(item.id)) state.confirmedRemovedEjectedIds.add(item.id);
        }
        for (const item of message.ejected || []) state.confirmedRemovedEjectedIds.delete(item.id);
        trimIdSet(state.confirmedRemovedFoodIds, 4096);
        trimIdSet(state.confirmedRemovedEjectedIds, 1024);
        state.latestSnapshot = message;
        state.snapshotBuffer.push(message, performance.now());
        {
          const sync = state.snapshotBuffer.getStats();
          const now = performance.now();
          if (sync.needsBaseline && now - state.lastBaselineRequestAt > 1000) {
            state.lastBaselineRequestAt = now;
            send({
              type: "resync-request",
              foodRevision: sync.foodRevision || 0,
              virusRevision: sync.virusRevision || 0
            });
          }
        }
        {
          const me = message.groups?.find(group => group.id === state.playerId);
          if (me && Number.isFinite(me.ackInputSeq)) {
            state.lastAckInputSeq = Math.max(state.lastAckInputSeq, me.ackInputSeq);
            const cutoff = performance.now() - 2000;
            state.inputHistory = state.inputHistory.filter(input => input.seq > state.lastAckInputSeq && input.sentAt >= cutoff);
          }
        }
        elements.networkState.textContent = "已连接";
        for (const event of message.events || []) handleMatchEvent(event);
        break;
      case "event":
        handleMatchEvent(message);
        break;
      case "pong":
        state.latency = Math.max(0, Math.round(performance.now() - message.clientTime));
        elements.latency.textContent = `${state.latency}ms`;
        break;
      case "error":
        showToast(message.message || "联机服务发生错误", true);
        if (["host-left", "host-closed", "server-shutdown", "match-finished"].includes(message.code)) returnToLobby(false);
        break;
      default:
        break;
    }
  }

  function handleMatchEvent(message) {
    const event = message.event;
    const data = message.data || {};
    if (event === "eliminated") {
      showToast(`${data.killerName || "星云"} 吞噬了 ${data.victimName || "玩家"}`);
    } else if (event === "downed") {
      showToast(`${data.victimName || "玩家"} 被击倒，剩余 ${data.lives ?? 0} 条生命`);
    } else if (event === "control-captured") {
      showToast(`${data.pointId || "星核"} 据点已被占领`);
    } else if (event === "match-event") {
      showToast(`${data.label || "星潮事件"} 开始`);
    } else if (event === "boss-ability") {
      showToast("魔王释放了引力脉冲");
    } else if (event === "match-finished") {
      if (state.matchFinishedHandled) return;
      state.matchFinishedHandled = true;
      const winner = data.ranking?.[0];
      showToast(winner ? `对局结束：${winner.name} 获得第一，即将返回房间` : "对局结束，即将返回房间");
    }
  }

  function handleSocketClose() {
    stopConnectionTimers();
    if (state.manualClose) return;
    if (state.view === "game" && state.resumeToken) {
      beginReconnect();
      return;
    }
    if (state.view === "room") {
      showToast("与房间的连接已断开", true);
      returnToLobby(false);
    }
  }

  function beginReconnect() {
    if (!state.reconnectStartedAt) state.reconnectStartedAt = performance.now();
    elements.reconnectOverlay.hidden = false;
    const elapsed = performance.now() - state.reconnectStartedAt;
    const remaining = Math.max(0, RECONNECT_GRACE_MS - elapsed);
    elements.reconnectText.textContent = `剩余 ${Math.ceil(remaining / 1000)} 秒`;
    elements.networkState.textContent = "重连中";
    if (remaining <= 0) {
      showToast("重连超时，AI 已继续接管你的星团", true);
      returnToLobby(false);
      return;
    }
    clearTimeout(state.reconnectTimer);
    const delay = Math.min(2200, 400 + state.connectionAttempt * 350);
    state.reconnectTimer = setTimeout(() => {
      connectRoom(state.endpoints, state.roomCode, { reconnect: true }).catch(() => beginReconnect());
    }, delay);
  }

  function startConnectionTimers() {
    stopConnectionTimers();
    state.inputTimer = setInterval(sendInput, INPUT_INTERVAL_MS);
    state.pingTimer = setInterval(() => send({ type: "ping", clientTime: performance.now() }), 5000);
  }

  function stopConnectionTimers() {
    clearInterval(state.inputTimer);
    clearInterval(state.pingTimer);
    state.inputTimer = null;
    state.pingTimer = null;
  }

  function renderWaitingRoom() {
    const room = state.room;
    if (!room) return;
    elements.roomName.textContent = room.name;
    elements.roomCode.textContent = room.code;
    const selectedMode = modeInfo(room.settings.mode);
    elements.roomMode.textContent = selectedMode.label;
    if (elements.roomModeSelect) {
      if (elements.roomModeSelect.options.length !== state.modes.length) populateModeSelect(elements.roomModeSelect, room.settings.mode);
      elements.roomModeSelect.value = room.settings.mode;
      elements.roomModeSelect.disabled = !state.isHost;
    }
    if (elements.roomModeDescription) elements.roomModeDescription.textContent = selectedMode.description;
    if (elements.roomAutoFill) elements.roomAutoFill.textContent = `目标 ${room.settings.targetParticipants || selectedMode.targetParticipants || 8} 人，真人加入时自动替换 AI`;
    if (elements.roomSettingsPanel) elements.roomSettingsPanel.dataset.host = state.isHost ? "true" : "false";
    elements.roomCapacity.textContent = `${room.players.filter(player => player.connected).length} / ${room.settings.maxPlayers} 真人`;
    elements.roomBots.textContent = `${room.settings.botCount} 个 AI（自动补位）`;
    elements.playerList.replaceChildren();
    for (const player of room.players) {
      const row = document.createElement("div");
      row.className = `player-row${player.connected ? "" : " disconnected"}`;
      const avatar = document.createElement("span");
      avatar.className = "player-avatar";
      avatar.textContent = player.name.slice(0, 1).toUpperCase();
      const skin = cosmeticCatalog.definition("skin", player.cosmetics?.skin);
      if (skin) avatar.style.background = skin.color;
      const identity = document.createElement("span");
      const name = document.createElement("strong");
      const role = document.createElement("small");
      name.textContent = `${player.name}${player.id === state.playerId ? "（你）" : ""}`;
      role.textContent = player.host ? "房主" : player.connected ? "局域网玩家" : "等待重连";
      identity.append(name, role);
      const ready = document.createElement("b");
      ready.className = `ready-state${player.ready ? " ready" : ""}`;
      ready.textContent = player.ready ? "已准备" : "未准备";
      row.append(avatar, identity, ready);
      elements.playerList.append(row);
    }
    const me = room.players.find(player => player.id === state.playerId);
    state.ready = Boolean(me?.ready);
    elements.ready.textContent = state.ready ? "取消准备" : "准备";
    elements.ready.classList.toggle("primary-button", !state.ready);
    elements.ready.classList.toggle("secondary-button", state.ready);
    const connected = room.players.filter(player => player.connected);
    const canStart = connected.length >= 2 && connected.every(player => player.ready);
    elements.startMatch.hidden = !state.isHost;
    elements.startMatch.disabled = !canStart;
    elements.roomHint.textContent = connected.length < 2
      ? "等待至少两名真人加入。"
      : canStart
        ? "所有玩家已准备，房主可以开始。"
        : "等待所有玩家准备。";
  }

  async function leaveRoom() {
    const hostToken = state.hostToken;
    const code = state.roomCode;
    const wasHost = state.isHost;
    state.manualClose = true;
    state.connectionGeneration += 1;
    clearTimeout(state.reconnectTimer);
    stopConnectionTimers();
    clearStoredSessions();
    try { state.socket?.send(JSON.stringify({ type: "leave" })); } catch {}
    try { state.socket?.close(1000, "player-left"); } catch {}
    if (wasHost && hostToken && code) {
      await jsonRequest(`/api/rooms/${code}`, { method: "DELETE", headers: { Authorization: `Bearer ${hostToken}` } }).catch(() => null);
    }
    setJoining(false);
    resetRoomState();
    setView("lobby");
    setConnection("online", "联机服务正常");
    await refreshRooms();
  }

  function returnToLobby(closeSocket = true) {
    state.connectionGeneration += 1;
    if (closeSocket) {
      state.manualClose = true;
      try { state.socket?.close(1000, "return-to-lobby"); } catch {}
    }
    clearTimeout(state.reconnectTimer);
    stopConnectionTimers();
    setJoining(false);
    resetRoomState();
    setView("lobby");
    setConnection("online", "联机服务正常");
    refreshRooms();
  }

  function resetRoomState() {
    state.socket = null;
    state.endpoint = "";
    state.endpoints = [];
    state.roomCode = "";
    state.matchId = "";
    state.baselineId = "";
    state.hostToken = "";
    state.resumeToken = "";
    state.playerId = "";
    state.isHost = false;
    state.room = null;
    state.ready = false;
    state.latestSnapshot = null;
    state.confirmedRemovedFoodIds.clear();
    state.confirmedRemovedEjectedIds.clear();
    state.snapshotBuffer.clear();
    state.inputHistory = [];
    state.lastAckInputSeq = 0;
    state.lastBaselineRequestAt = 0;
    state.matchFinishedHandled = false;
    state.reconnectStartedAt = 0;
    state.connectionAttempt = 0;
    elements.reconnectOverlay.hidden = true;
  }

  function sendInput() {
    if (state.view !== "game") return;
    state.inputSeq += 1;
    const input = {
      type: "input",
      seq: state.inputSeq,
      dx: state.input.dx,
      dy: state.input.dy,
      targetX: state.input.targetX,
      targetY: state.input.targetY,
      split: state.input.split,
      eject: state.input.eject,
      quickMerge: state.input.quickMerge,
      special: state.input.special
    };
    if (send(input)) {
      state.inputHistory.push({ ...input, sentAt: performance.now() });
      if (state.inputHistory.length > 120) state.inputHistory.splice(0, state.inputHistory.length - 120);
    }
    state.input.split = false;
    state.input.quickMerge = false;
    state.input.special = false;
  }

  function resizeCanvas() {
    const pixelBudget = qualityPreset.pixelBudget;
    const budgetRatio = Math.sqrt(pixelBudget / Math.max(1, window.innerWidth * window.innerHeight));
    const ratio = clamp(Math.min(window.devicePixelRatio || 1, qualityPreset.maximumDpr, budgetRatio), 0.65, qualityPreset.maximumDpr);
    elements.canvas.width = Math.max(1, Math.floor(window.innerWidth * ratio));
    elements.canvas.height = Math.max(1, Math.floor(window.innerHeight * ratio));
    elements.canvas.style.width = `${window.innerWidth}px`;
    elements.canvas.style.height = `${window.innerHeight}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function interpolatedSnapshot(now) {
    const snapshot = state.snapshotBuffer.sample(now);
    return snapshot ? predictLocalPlayer(snapshot, now) : null;
  }

  function predictLocalPlayer(snapshot, now) {
    return window.ScaLocalPredictor.predictLocalPlayer(snapshot, {
      playerId: state.playerId,
      estimatedServerTime: state.snapshotBuffer.estimatedServerTime(now),
      currentInput: state.input,
      inputHistory: state.inputHistory,
      estimateInputTime: input => state.snapshotBuffer.estimatedServerTime(input.sentAt)
    });
  }

  function updateCamera(snapshot, elapsedMs) {
    const player = snapshot.groups.find(group => group.id === state.playerId);
    if (!player?.cells.length) return;
    let mass = 0;
    let x = 0;
    let y = 0;
    let largest = 1;
    for (const cell of player.cells) {
      mass += cell.mass;
      x += cell.x * cell.mass;
      y += cell.y * cell.mass;
      largest = Math.max(largest, cell.radius);
    }
    const targetX = x / Math.max(1, mass);
    const targetY = y / Math.max(1, mass);
    const targetZoom = clamp(Math.min(window.innerWidth, window.innerHeight) / (largest * 8 + 560), 0.3, 1.05);
    const positionBlend = 1 - Math.exp(-7.6 * clamp(elapsedMs, 0, 50) / 1000);
    const zoomBlend = 1 - Math.exp(-5 * clamp(elapsedMs, 0, 50) / 1000);
    state.camera.x += (targetX - state.camera.x) * positionBlend;
    state.camera.y += (targetY - state.camera.y) * positionBlend;
    state.camera.zoom += (targetZoom - state.camera.zoom) * zoomBlend;
  }

  function worldToScreen(x, y) {
    return {
      x: (x - state.camera.x) * state.camera.zoom + window.innerWidth / 2,
      y: (y - state.camera.y) * state.camera.zoom + window.innerHeight / 2
    };
  }

  function pointerWorldTarget() {
    const zoom = Math.max(0.08, state.camera.zoom);
    return {
      x: state.camera.x + (state.pointer.x - window.innerWidth / 2) / zoom,
      y: state.camera.y + (state.pointer.y - window.innerHeight / 2) / zoom
    };
  }

  function drawBackground(snapshot) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const gradient = context.createRadialGradient(width * 0.5, height * 0.45, 0, width * 0.5, height * 0.45, Math.max(width, height));
    gradient.addColorStop(0, "#0a1c22");
    gradient.addColorStop(1, "#030a0e");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    const spacing = 120 * state.camera.zoom;
    if (spacing > 18) {
      const origin = worldToScreen(0, 0);
      context.beginPath();
      context.strokeStyle = "rgba(152, 211, 214, 0.055)";
      context.lineWidth = 1;
      for (let x = origin.x % spacing; x < width; x += spacing) {
        context.moveTo(x, 0);
        context.lineTo(x, height);
      }
      for (let y = origin.y % spacing; y < height; y += spacing) {
        context.moveTo(0, y);
        context.lineTo(width, y);
      }
      context.stroke();
    }
    const arena = snapshot.arena || { x: 0, y: 0, width: snapshot.world.width, height: snapshot.world.height };
    const topLeft = worldToScreen(arena.x, arena.y);
    const bottomRight = worldToScreen(arena.x + arena.width, arena.y + arena.height);
    context.strokeStyle = "rgba(88, 237, 200, 0.45)";
    context.lineWidth = 3;
    context.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
    if (snapshot.safeZone) {
      const center = worldToScreen(snapshot.safeZone.x, snapshot.safeZone.y);
      const radius = snapshot.safeZone.radius * state.camera.zoom;
      context.beginPath();
      context.rect(0, 0, width, height);
      context.arc(center.x, center.y, Math.max(0, radius), 0, Math.PI * 2, true);
      context.fillStyle = "rgba(244, 63, 94, 0.1)";
      context.fill("evenodd");
      context.beginPath();
      context.arc(center.x, center.y, Math.max(0, radius), 0, Math.PI * 2);
      context.strokeStyle = "rgba(251, 113, 133, 0.82)";
      context.lineWidth = 3;
      context.stroke();
    }
  }

  function visible(screen, radius = 20) {
    return screen.x + radius >= -30 && screen.x - radius <= window.innerWidth + 30 && screen.y + radius >= -30 && screen.y - radius <= window.innerHeight + 30;
  }

  function drawCosmeticTrail(group, cell, point, radius, now) {
    if (!group.human || radius < 22) return;
    const trail = cosmeticCatalog.definition("trail", group.cosmetics?.trail);
    if (!trail?.pattern || trail.key === "none") return;
    const speed = Math.hypot(cell.vx || 0, cell.vy || 0);
    if (speed < 16) return;
    const dx = -(cell.vx || 0) / speed;
    const dy = -(cell.vy || 0) / speed;
    const sideX = -dy;
    const sideY = dx;
    context.save();
    context.globalAlpha = 0.34;
    context.fillStyle = trail.color || group.color;
    context.strokeStyle = trail.accent || "#ffffff";
    context.lineWidth = 1.3;
    for (let index = 1; index <= 3; index += 1) {
      const distance = radius * (0.7 + index * 0.42);
      const wobble = Math.sin(now / 220 + index * 1.7) * radius * 0.1;
      const x = point.x + dx * distance + sideX * wobble;
      const y = point.y + dy * distance + sideY * wobble;
      const size = Math.max(2.5, radius * (0.15 - index * 0.022));
      context.beginPath();
      if (["arc", "rift"].includes(trail.pattern)) {
        context.moveTo(x - sideX * size, y - sideY * size);
        context.lineTo(x + sideX * size, y + sideY * size);
        context.stroke();
      } else if (["ribbon", "flame"].includes(trail.pattern)) {
        context.ellipse(x, y, size * 1.4, size * 0.45, Math.atan2(dy, dx), 0, Math.PI * 2);
        context.fill();
      } else if (trail.pattern === "squares") {
        context.fillRect(x - size * 0.5, y - size * 0.5, size, size);
      } else {
        context.arc(x, y, size, 0, Math.PI * 2);
        trail.pattern === "bubbles" ? context.stroke() : context.fill();
      }
    }
    context.restore();
  }

  function drawCosmeticHalo(group, point, radius, now) {
    if (!group.human || radius < 24) return;
    const halo = cosmeticCatalog.definition("halo", group.cosmetics?.halo);
    if (!halo?.pattern || halo.key === "none") return;
    const outer = radius + 9;
    const spin = now / 1500;
    context.save();
    context.globalAlpha = 0.58;
    context.strokeStyle = halo.accent || halo.color || "#ffffff";
    context.fillStyle = halo.color || group.color;
    context.lineWidth = 2.2;
    if (halo.pattern === "frost") context.setLineDash([5, 7]);
    context.beginPath();
    if (["orbit", "gravity"].includes(halo.pattern)) context.arc(point.x, point.y, outer, spin, spin + Math.PI * 1.55);
    else context.arc(point.x, point.y, outer + (halo.pattern === "pulse" ? Math.sin(spin * 2) * 2 : 0), 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
    if (["sun", "crown"].includes(halo.pattern)) {
      for (let index = 0; index < 6; index += 1) {
        const angle = spin * 0.6 + index / 6 * Math.PI * 2;
        context.beginPath();
        context.arc(point.x + Math.cos(angle) * (outer + 2), point.y + Math.sin(angle) * (outer + 2), 2.5, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();
  }

  function drawCosmeticSkin(group, point, radius, now) {
    if (!group.human || radius < 18) return;
    const skin = cosmeticCatalog.definition("skin", group.cosmetics?.skin);
    if (!skin?.pattern) return;
    const spin = now / 1600;
    const accent = skin.accent || "#ffffff";
    context.save();
    context.beginPath();
    context.arc(point.x, point.y, radius * 0.94, 0, Math.PI * 2);
    context.clip();
    context.globalAlpha = 0.3;
    context.strokeStyle = accent;
    context.fillStyle = accent;
    context.lineWidth = Math.max(1.5, radius * 0.055);
    if (skin.pattern === "comet") {
      for (let index = -2; index <= 2; index += 1) {
        context.beginPath();
        context.moveTo(point.x - radius, point.y + index * radius * 0.26 + radius * 0.35);
        context.lineTo(point.x + radius, point.y + index * radius * 0.26 - radius * 0.35);
        context.stroke();
      }
    } else if (skin.pattern === "mecha") {
      for (let ring = 1; ring <= 3; ring += 1) {
        const rr = radius * (0.2 + ring * 0.18);
        context.beginPath();
        for (let side = 0; side < 6; side += 1) {
          const angle = spin * 0.35 + side / 6 * Math.PI * 2;
          const x = point.x + Math.cos(angle) * rr;
          const y = point.y + Math.sin(angle) * rr;
          side ? context.lineTo(x, y) : context.moveTo(x, y);
        }
        context.closePath();
        context.stroke();
      }
    } else if (skin.pattern === "tide") {
      for (let row = -2; row <= 2; row += 1) {
        context.beginPath();
        for (let step = 0; step <= 12; step += 1) {
          const x = point.x - radius + step / 12 * radius * 2;
          const y = point.y + row * radius * 0.24 + Math.sin(step * 0.9 + spin * 2 + row) * radius * 0.08;
          step ? context.lineTo(x, y) : context.moveTo(x, y);
        }
        context.stroke();
      }
    } else if (skin.pattern === "abyss") {
      const gradient = context.createRadialGradient(point.x, point.y, radius * 0.08, point.x, point.y, radius * 0.75);
      gradient.addColorStop(0, "rgba(0,0,0,0.78)");
      gradient.addColorStop(1, accent);
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(point.x, point.y, radius * 0.74, 0, Math.PI * 2);
      context.fill();
    } else {
      const count = skin.pattern === "crown" ? 6 : 10;
      for (let index = 0; index < count; index += 1) {
        const angle = spin + index / count * Math.PI * 2;
        context.beginPath();
        context.arc(point.x + Math.cos(angle) * radius * 0.46, point.y + Math.sin(angle) * radius * 0.46, radius * 0.16, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();
  }

  function drawWorld(snapshot, now) {
    for (const point of snapshot.controlPoints || []) {
      const screen = worldToScreen(point.x, point.y);
      const radius = point.radius * state.camera.zoom;
      if (!visible(screen, radius)) continue;
      const owner = (snapshot.teams || []).find(team => team.team === point.owner);
      const capturing = (snapshot.teams || []).find(team => team.team === point.captureTeam);
      context.beginPath();
      context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      context.fillStyle = owner ? `${owner.color}24` : "rgba(255,255,255,0.045)";
      context.fill();
      context.strokeStyle = owner?.color || "rgba(255,255,255,0.45)";
      context.lineWidth = point.contested ? 5 : 3;
      context.stroke();
      if (point.progress > 0 && capturing) {
        context.beginPath();
        context.arc(screen.x, screen.y, radius + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * point.progress / 100);
        context.strokeStyle = capturing.color;
        context.lineWidth = 5;
        context.stroke();
      }
      context.fillStyle = "rgba(248,251,255,0.9)";
      context.font = "800 18px ui-monospace, monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(point.id, screen.x, screen.y);
    }
    for (const virus of snapshot.viruses || []) {
      const point = worldToScreen(virus.x, virus.y);
      const radius = virus.radius * state.camera.zoom;
      if (!visible(point, radius)) continue;
      context.beginPath();
      const spikes = 18;
      for (let index = 0; index < spikes * 2; index += 1) {
        const angle = index / (spikes * 2) * Math.PI * 2;
        const length = index % 2 ? radius * 0.82 : radius;
        const x = point.x + Math.cos(angle) * length;
        const y = point.y + Math.sin(angle) * length;
        if (!index) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.fillStyle = virus.color || (virus.spore ? "#f472b6" : "#5eea80");
      context.globalAlpha = 0.82;
      context.fill();
      context.globalAlpha = 1;
    }
    const foods = snapshot.foods || [];
    for (let colorIndex = 0; colorIndex < FOOD_COLORS.length; colorIndex += 1) {
      context.beginPath();
      let visibleCount = 0;
      for (const food of foods) {
        if (state.confirmedRemovedFoodIds.has(food.id)) continue;
        if (food.color % FOOD_COLORS.length !== colorIndex) continue;
        const point = worldToScreen(food.x, food.y);
        const radius = Math.max(2, food.radius * state.camera.zoom);
        if (!visible(point, radius)) continue;
        context.moveTo(point.x + radius, point.y);
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        visibleCount += 1;
      }
      if (visibleCount) {
        context.fillStyle = FOOD_COLORS[colorIndex];
        context.fill();
      }
    }
    for (const item of snapshot.ejected || []) {
      if (state.confirmedRemovedEjectedIds.has(item.id)) continue;
      const point = worldToScreen(item.x, item.y);
      const radius = Math.max(3, item.radius * state.camera.zoom);
      if (!visible(point, radius)) continue;
      context.beginPath();
      context.fillStyle = item.color;
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(255,255,255,0.45)";
      context.lineWidth = 1;
      context.stroke();
      const spore = cosmeticCatalog.definition("spore", item.spore);
      if (spore?.accent && radius > 3) {
        context.beginPath();
        context.fillStyle = spore.accent;
        context.globalAlpha = 0.58;
        context.arc(point.x - radius * 0.28, point.y - radius * 0.3, Math.max(1, radius * 0.2), 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;
      }
    }
    const cells = [];
    for (const group of snapshot.groups || []) for (const cell of group.cells || []) cells.push({ group, cell });
    cells.sort((a, b) => a.cell.radius - b.cell.radius);
    for (const { group, cell } of cells) {
      const point = worldToScreen(cell.x, cell.y);
      const radius = cell.radius * state.camera.zoom;
      if (!visible(point, radius)) continue;
      drawCosmeticTrail(group, cell, point, radius, now);
      drawCosmeticHalo(group, point, radius, now);
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fillStyle = group.color;
      context.globalAlpha = group.dead ? 0.35 : 0.9;
      context.fill();
      context.globalAlpha = 1;
      context.lineWidth = group.id === state.playerId ? 3 : 1.5;
      context.strokeStyle = group.id === state.playerId ? "#ecfff9" : "rgba(255,255,255,0.5)";
      context.stroke();
      drawCosmeticSkin(group, point, radius, now);
      if (radius > 12) {
        context.beginPath();
        context.arc(point.x - radius * 0.3, point.y - radius * 0.32, Math.max(2, radius * 0.12), 0, Math.PI * 2);
        context.fillStyle = "rgba(255,255,255,0.42)";
        context.fill();
      }
      if (radius > 16) {
        context.fillStyle = "#f8fbff";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.font = `700 ${clamp(radius * 0.25, 9, 18)}px "Microsoft YaHei UI", sans-serif`;
        context.fillText(group.name, point.x, point.y - 2);
        if (radius > 34) {
          context.fillStyle = "rgba(244,251,253,0.72)";
          context.font = `600 ${clamp(radius * 0.16, 8, 12)}px ui-monospace, monospace`;
          context.fillText(Math.round(cell.mass), point.x, point.y + clamp(radius * 0.2, 10, 18));
        }
      }
    }
  }

  function updateHud(snapshot) {
    const player = snapshot.groups.find(group => group.id === state.playerId);
    elements.mass.textContent = player ? Math.round(player.mass) : "0";
    elements.rank.textContent = player ? `#${player.rank}` : "-";
    elements.kills.textContent = player?.kills || 0;
    if (snapshot.remaining == null) {
      elements.timer.textContent = "生存战";
    } else {
      const seconds = Math.max(0, Math.ceil(snapshot.remaining));
      elements.timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    }
    if (elements.gameModeName) elements.gameModeName.textContent = modeLabel(snapshot.mode || "solo");
    if (snapshot.mode === "screen" && player) {
      const quickSeconds = Math.max(0, Number(player.quickMergeCooldown) || 0);
      const specialSeconds = Math.max(0, Number(player.specialCooldown) || 0);
      const quickLabel = elements.touchQuickMerge?.querySelector("small");
      const specialLabel = elements.touchSpecial?.querySelector("small");
      if (quickLabel) quickLabel.textContent = quickSeconds > 0 ? `${quickSeconds.toFixed(1)}s` : "速合";
      if (specialLabel) specialLabel.textContent = specialSeconds > 0 ? `${specialSeconds.toFixed(1)}s` : "冲刺";
      if (elements.touchQuickMerge) elements.touchQuickMerge.disabled = quickSeconds > 0;
      if (elements.touchSpecial) elements.touchSpecial.disabled = specialSeconds > 0;
    }
    if (elements.gameObjective) {
      const objective = snapshot.objective || {};
      let text = objective.description || modeInfo(snapshot.mode).description;
      if (snapshot.mode === "survival" && player) text = `剩余 ${player.lives} 条生命 · 击杀可加命`;
      if (snapshot.mode === "battle" && snapshot.safeZone) text = `安全区半径 ${Math.round(snapshot.safeZone.radius)} · 圈外持续损失质量`;
      if (snapshot.mode === "control") {
        const leader = snapshot.teams?.[0];
        text = leader ? `${leader.name} ${Math.round(leader.score)} / ${objective.targetScore || 240} 分` : "争夺 A / B / C 三个星核";
      }
      if (objective.domination) {
        const leader = snapshot.groups.find(group => group.id === objective.domination.leaderId);
        text = `${leader?.name || "暂无玩家"} 占总质量 ${Math.round(objective.domination.share * 100)}% · 制霸 ${objective.domination.progressSeconds.toFixed(1)} / ${objective.domination.holdSeconds}s`;
      }
      if (snapshot.mode === "demon") text = `剩余魔王 ${objective.bossesAlive ?? 0} · 勇者协作吞噬魔王`;
      if (objective.activeEvent) text += ` · ${objective.activeEvent.label} ${Math.ceil(objective.activeEvent.remaining)}s`;
      if (player?.dead && !player.eliminated) text = `${player.respawnRemaining.toFixed(1)} 秒后复活`;
      if (player?.eliminated) text = "你已出局，可继续观战";
      elements.gameObjective.textContent = text;
    }
    const sync = state.snapshotBuffer.getStats();
    if (elements.gameNetworkDetail) {
      elements.gameNetworkDetail.textContent = `图形 ${Math.round(state.smoothedFps)} FPS / 目标 ${targetRenderFps} · 权威 ${sync.snapshotHz.toFixed(1)} Hz · 抖动 ${Math.round(sync.jitterMs)}ms · 缓冲 ${Math.round(sync.bufferDepthMs)}ms`;
    }
    elements.latency.title = `往返延迟 ${state.latency}ms；快照 ${sync.snapshotHz.toFixed(1)}Hz；抖动 ${sync.jitterMs.toFixed(1)}ms；缓冲欠载 ${sync.bufferUnderruns} 次`;
    elements.ranking.replaceChildren();
    const showTeams = ["team", "control", "demon"].includes(snapshot.mode) && snapshot.teams?.length;
    const entries = showTeams ? snapshot.teams : (snapshot.ranking || []);
    entries.slice(0, 8).forEach((entry, index) => {
      const item = document.createElement("li");
      if (entry.id === state.playerId || (showTeams && entry.team === player?.team)) item.className = "me";
      const rank = document.createElement("b");
      const name = document.createElement("span");
      const mass = document.createElement("em");
      rank.textContent = String(index + 1);
      name.textContent = entry.name;
      mass.textContent = snapshot.mode === "control"
        ? `${Math.round(entry.score || 0)}分`
        : snapshot.mode === "survival"
          ? `${entry.kills || 0}杀`
          : String(Math.round(entry.mass));
      item.append(rank, name, mass);
      elements.ranking.append(item);
    });
  }

  function render(now) {
    const cadence = gameplayCore.advanceRenderCadence(now, state.nextRenderAt, targetRenderInterval);
    state.nextRenderAt = cadence.nextRenderAt;
    if (!cadence.due) {
      state.renderFrame = requestAnimationFrame(render);
      return;
    }
    const elapsed = state.lastRenderAt ? clamp(now - state.lastRenderAt, 0, 100) : 16.67;
    state.lastRenderAt = now;
    if (elapsed > 0) state.smoothedFps += (1000 / elapsed - state.smoothedFps) * 0.04;
    if (state.view === "game") {
      const snapshot = interpolatedSnapshot(now);
      if (snapshot) {
        updateCamera(snapshot, elapsed);
        drawBackground(snapshot);
        drawWorld(snapshot, now);
        if (now - state.lastHudAt >= HUD_INTERVAL_MS) {
          state.lastHudAt = now;
          updateHud(snapshot);
        }
      } else {
        context.fillStyle = "#051014";
        context.fillRect(0, 0, window.innerWidth, window.innerHeight);
      }
      const dx = state.pointer.x - window.innerWidth / 2;
      const dy = state.pointer.y - window.innerHeight / 2;
      const length = Math.hypot(dx, dy) || 1;
      state.input.dx = dx / length;
      state.input.dy = dy / length;
      const target = pointerWorldTarget();
      state.input.targetX = target.x;
      state.input.targetY = target.y;
    }
    state.renderFrame = requestAnimationFrame(render);
  }

  function pointerFromEvent(event) {
    state.pointer.x = event.clientX;
    state.pointer.y = event.clientY;
  }

  elements.nickname.value = localStorage.getItem("starClusterPlayerName") || "星友";
  elements.nickname.addEventListener("change", () => localStorage.setItem("starClusterPlayerName", playerName()));
  elements.modeSelect?.addEventListener("change", updateModeDescription);
  elements.roomModeSelect?.addEventListener("change", () => {
    if (state.isHost) send({ type: "update-settings", mode: elements.roomModeSelect.value });
  });
  elements.createRoom.addEventListener("click", createRoom);
  elements.refreshRooms.addEventListener("click", () => refreshRooms(true, true));
  elements.roomCodeInput.addEventListener("input", () => { elements.roomCodeInput.value = normalizeCode(elements.roomCodeInput.value); });
  elements.roomCodeInput.addEventListener("keydown", event => { if (event.key === "Enter") joinByCode(); });
  elements.joinCode.addEventListener("click", joinByCode);
  elements.openFirewallSettings.addEventListener("click", async () => {
    try {
      await window.starClusterDesktop?.openFirewallSettings?.();
    } catch {
      showToast("无法打开系统设置，请在 Windows 安全中心中允许星团大作战使用专用网络。", true);
    }
  });
  elements.copyRoomCode.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.roomCode);
      showToast(`房间码 ${state.roomCode} 已复制`);
    } catch {
      showToast(`房间码：${state.roomCode}`);
    }
  });
  elements.ready.addEventListener("click", () => send({
    type: "ready",
    ready: !state.ready,
    configVersion: state.room?.configVersion || 0
  }));
  elements.startMatch.addEventListener("click", () => send({
    type: "start",
    configVersion: state.room?.configVersion || 0
  }));
  elements.leaveRoom.addEventListener("click", openSessionMenu);
  elements.exitMatch.addEventListener("click", openSessionMenu);
  elements.sessionContinue?.addEventListener("click", closeSessionMenu);
  elements.sessionLeave?.addEventListener("click", async () => {
    closeSessionMenu();
    await leaveRoom();
  });
  elements.sessionHome?.addEventListener("click", async () => {
    closeSessionMenu();
    if (state.view !== "lobby") await leaveRoom();
    goToMainMenu();
  });
  elements.canvas.addEventListener("pointermove", pointerFromEvent);
  elements.canvas.addEventListener("pointerdown", pointerFromEvent);
  elements.touchSplit.addEventListener("pointerdown", event => { event.preventDefault(); state.input.split = true; });
  elements.touchEject.addEventListener("pointerdown", event => { event.preventDefault(); state.input.eject = true; });
  elements.touchQuickMerge?.addEventListener("pointerdown", event => { event.preventDefault(); state.input.quickMerge = true; });
  elements.touchSpecial?.addEventListener("pointerdown", event => { event.preventDefault(); state.input.special = true; });
  for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
    elements.touchEject.addEventListener(eventName, event => { event.preventDefault(); state.input.eject = false; });
  }
  window.addEventListener("pointerup", () => { state.input.eject = false; });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (elements.sessionMenu && !elements.sessionMenu.hidden) closeSessionMenu();
      else openSessionMenu();
      return;
    }
    if (state.view !== "game") return;
    if (elements.sessionMenu && !elements.sessionMenu.hidden) return;
    if (event.code === "Space" && !event.repeat) {
      event.preventDefault();
      state.input.split = true;
    }
    if (event.key.toLowerCase() === "w") {
      event.preventDefault();
      state.input.eject = true;
    }
    if (event.key.toLowerCase() === "a" && !event.repeat) {
      event.preventDefault();
      state.input.quickMerge = true;
    }
    if (event.key.toLowerCase() === "d" && !event.repeat) {
      event.preventDefault();
      state.input.special = true;
    }
  });
  document.addEventListener("keyup", event => {
    if (event.key.toLowerCase() === "w") state.input.eject = false;
  });
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("beforeunload", () => {
    state.manualClose = true;
    clearStoredSessions();
    try { state.socket?.send(JSON.stringify({ type: "leave" })); } catch {}
    try { state.socket?.close(1000, "window-closed"); } catch {}
  });

  resizeCanvas();
  document.documentElement.classList.toggle("hide-performance", !gameSettings.showPerformance);
  document.querySelector(".back-link")?.addEventListener("click", event => {
    event.preventDefault();
    goToMainMenu();
  });
  if (new URLSearchParams(location.search).has("debug")) {
    window.__starClusterMultiplayerDebug = Object.freeze({
      snapshot: () => ({
        protocol: PROTOCOL_VERSION,
        targetRenderFps,
        displayRefresh,
        inputHz: Math.round(1000 / INPUT_INTERVAL_MS),
        settings: { ...gameSettings },
        view: state.view,
        measuredFps: Math.round(state.smoothedFps),
        synchronization: state.snapshotBuffer.getStats()
      })
    });
  }
  loadModes();
  refreshRooms(false, true);
  state.roomRefreshTimer = setInterval(() => refreshRooms(), 1200);
  state.renderFrame = requestAnimationFrame(render);
})();
