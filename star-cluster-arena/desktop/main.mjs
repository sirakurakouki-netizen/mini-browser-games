import { appendFile, mkdir } from "node:fs/promises";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Menu, clipboard, ipcMain, screen, session, shell } from "electron";
import electronSquirrelStartup from "electron-squirrel-startup";
import { startServer } from "../backend/server.mjs";
import { inspectWindowsFirewall } from "../backend/multiplayer/windows-network-diagnostics.mjs";
import { normalizeExternalUrl } from "./external-links.mjs";

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SMOKE_MODE = process.env.SCA_DESKTOP_SMOKE === "1";
const SMOKE_MULTIPLAYER = process.env.SCA_DESKTOP_SMOKE_PATH === "multiplayer";
const SMOKE_GAMEPLAY = process.env.SCA_DESKTOP_SMOKE_GAMEPLAY === "1";
const SMOKE_GAMEPLAY_MODE = ["solo", "team", "survival", "battle", "blitz", "spore", "screen", "control", "giant", "demon"].includes(process.env.SCA_DESKTOP_SMOKE_GAMEPLAY_MODE)
  ? process.env.SCA_DESKTOP_SMOKE_GAMEPLAY_MODE
  : "solo";
const SMOKE_MIN_FPS = Math.max(0, Number(process.env.SCA_DESKTOP_SMOKE_MIN_FPS) || 0);
const SMOKE_LOW_POWER_GPU = SMOKE_GAMEPLAY && process.env.SCA_DESKTOP_SMOKE_LOW_POWER_GPU === "1";
const SMOKE_GAMEPLAY_DURATION = Math.min(60, Math.max(8, Math.round(Number(process.env.SCA_DESKTOP_SMOKE_DURATION) || 16)));
let mainWindow = null;
let serverController = null;
let stopping = false;
let logFile = null;
let desktopRefreshRate = 60;
const WINDOW_SIZES = new Map([
  ["1280x720", [1280, 720]],
  ["1440x900", [1440, 900]],
  ["1600x900", [1600, 900]],
  ["1920x1080", [1920, 1080]]
]);

app.commandLine.appendSwitch(SMOKE_LOW_POWER_GPU ? "force_low_power_gpu" : "force_high_performance_gpu");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
if (SMOKE_GAMEPLAY) {
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
}

async function writeLog(level, values) {
  const message = values.map(value => value instanceof Error ? value.stack || value.message : String(value)).join(" ");
  const line = `${new Date().toISOString()} [${level}] ${message}\n`;
  if (level === "error") console.error(message);
  else if (level === "warn") console.warn(message);
  else console.log(message);
  if (!logFile) return;
  try {
    await appendFile(logFile, line, "utf8");
  } catch {
    // 日志写入失败不能阻断游戏启动。
  }
}

const logger = {
  log: (...values) => void writeLog("info", values),
  info: (...values) => void writeLog("info", values),
  warn: (...values) => void writeLog("warn", values),
  error: (...values) => void writeLog("error", values)
};

function isLocalGameUrl(target) {
  if (!serverController) return false;
  try {
    return new URL(target).origin === new URL(serverController.url).origin;
  } catch {
    return false;
  }
}

function desktopGameUrl(pathname = "/") {
  const url = new URL(pathname, serverController.url);
  url.searchParams.set("desktop", "1");
  url.searchParams.set("refresh", String(desktopRefreshRate));
  if (SMOKE_GAMEPLAY) url.searchParams.set("debug", "1");
  return url.href;
}

async function openAllowedExternal(target) {
  const url = normalizeExternalUrl(target);
  if (!url) return { ok: false, error: "不允许打开这个外部地址" };
  try {
    await shell.openExternal(url.href);
    return { ok: true, url: url.href };
  } catch (error) {
    logger.warn("外部地址打开失败", error);
    return { ok: false, error: "系统没有可用于打开该地址的应用" };
  }
}

function currentDisplayState() {
  if (!mainWindow) return { mode: "windowed", fullscreen: false, bounds: null };
  return {
    mode: mainWindow.isFullScreen() ? "borderless-fullscreen" : "windowed",
    fullscreen: mainWindow.isFullScreen(),
    bounds: mainWindow.getBounds()
  };
}

function emitDisplayState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:display-state", currentDisplayState());
}

function setDesktopDisplayMode(settings = {}) {
  if (!mainWindow) return currentDisplayState();
  const mode = settings?.mode === "borderless-fullscreen" ? "borderless-fullscreen" : "windowed";
  if (mode === "borderless-fullscreen") {
    mainWindow.setFullScreen(true);
  } else {
    mainWindow.setFullScreen(false);
    const size = WINDOW_SIZES.get(String(settings?.windowSize || ""));
    if (size) {
      const display = screen.getDisplayMatching(mainWindow.getBounds());
      const width = Math.min(size[0], display.workAreaSize.width);
      const height = Math.min(size[1], display.workAreaSize.height);
      mainWindow.setSize(Math.max(960, width), Math.max(640, height), true);
      mainWindow.center();
    }
  }
  setImmediate(emitDisplayState);
  return currentDisplayState();
}

function tcpPortHasListener(port, timeoutMs = 280) {
  return new Promise(resolvePort => {
    const socket = connect({ host: "127.0.0.1", port });
    let settled = false;
    const finish = occupied => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePort(occupied);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function collectGameplaySmoke(smokeWindow) {
  return smokeWindow.webContents.executeJavaScript(`(async () => {
    const mode = ${JSON.stringify(SMOKE_GAMEPLAY_MODE)};
    document.querySelector('[data-mode="' + mode + '"]')?.click();
    document.getElementById('playAgainBtn')?.click();
    const samples = [];
    for (let elapsed = 4; elapsed <= ${JSON.stringify(SMOKE_GAMEPLAY_DURATION)}; elapsed += 4) {
      await new Promise(resolve => setTimeout(resolve, 4000));
      const state = window.__ballArenaDebug?.snapshot?.();
      if (!state) throw new Error('单机调试采样接口不可用');
      samples.push({
        elapsed,
        over: state.over,
        alive: state.alive,
        fps: Math.round(1000 / Math.max(1, state.avgFrame)),
        avgFrame: state.avgFrame,
        avgWork: state.avgWork,
        maxFrame: state.maxFrame,
        longFrames: state.longFrames,
        lowQuality: state.lowQuality,
        pixelRatio: state.pixelRatio,
        renderedFrames: state.renderedFrames,
        skippedRenderFrames: state.skippedRenderFrames,
        drawnFood: state.drawnFood,
        drawnCells: state.drawnCells,
        renderer: state.renderer
      });
    }
    const activeSamples = samples.filter(sample => !sample.over);
    const steadySamples = activeSamples.filter(sample => sample.elapsed >= 8);
    return {
      mode,
      samples,
      summary: {
        activeSamples: activeSamples.length,
        averageFps: activeSamples.length ? Math.round(activeSamples.reduce((sum, sample) => sum + sample.fps, 0) / activeSamples.length) : 0,
        steadyAverageFps: steadySamples.length ? Math.round(steadySamples.reduce((sum, sample) => sum + sample.fps, 0) / steadySamples.length) : 0,
        steadyMinimumFps: steadySamples.length ? Math.min(...steadySamples.map(sample => sample.fps)) : 0,
        minimumFps: activeSamples.length ? Math.min(...activeSamples.map(sample => sample.fps)) : 0,
        maximumWorkMs: activeSamples.length ? Math.max(...activeSamples.map(sample => sample.avgWork)) : 0,
        maximumLongFrames: activeSamples.length ? Math.max(...activeSamples.map(sample => sample.longFrames)) : 0
      }
    };
  })()`);
}

async function collectMultiplayerGameplaySmoke(smokeWindow) {
  return smokeWindow.webContents.executeJavaScript(`(async () => {
    const mode = ${JSON.stringify(SMOKE_GAMEPLAY_MODE)};
    const duration = ${JSON.stringify(SMOKE_GAMEPLAY_DURATION)};
    const waitFor = async (predicate, label, timeout = 12000) => {
      const startedAt = performance.now();
      while (!predicate()) {
        if (performance.now() - startedAt > timeout) throw new Error('联机性能采样等待超时：' + label);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    };

    const modeSelect = document.getElementById('modeSelect');
    modeSelect.value = mode;
    modeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('nicknameInput').value = '桌面性能房主';
    document.getElementById('createRoomBtn').click();
    await waitFor(() => document.getElementById('roomView')?.hidden === false, '创建房间');
    const roomCode = document.getElementById('roomCode').textContent.trim();
    const initialBots = document.getElementById('roomBots').textContent.trim();
    const endpoint = location.origin.replace(/^http/, 'ws') + '/ws?room=' + encodeURIComponent(roomCode);
    const guest = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('性能采样访客加入超时')), 8000);
      guest.addEventListener('open', () => guest.send(JSON.stringify({
        type: 'join',
        protocol: 'sca-lan-v6',
        name: '桌面性能访客',
        cosmetics: { skin: 'dragon', spore: 'royal', halo: 'gravity', trail: 'demon-trail' }
      })));
      guest.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.type === 'welcome') {
          guest.send(JSON.stringify({ type: 'ready', ready: true, configVersion: message.room.configVersion }));
          clearTimeout(timer);
          resolve();
        }
        if (message.type === 'ping') guest.send(JSON.stringify({ type: 'pong', clientTime: message.clientTime }));
      });
      guest.addEventListener('error', () => reject(new Error('性能采样访客连接失败')), { once: true });
    });

    await waitFor(() => document.getElementById('roomCapacity').textContent.includes('2 / 8 真人'), '第二名玩家进入房间');
    const filledBots = document.getElementById('roomBots').textContent.trim();
    document.getElementById('readyBtn').click();
    await waitFor(() => !document.getElementById('startMatchBtn').disabled, '双方准备');
    document.getElementById('startMatchBtn').click();
    await waitFor(() => document.getElementById('gameView')?.hidden === false, '开始联机对局');

    const samples = [];
    for (let elapsed = 4; elapsed <= duration; elapsed += 4) {
      await new Promise(resolve => setTimeout(resolve, 4000));
      const detail = document.getElementById('gameNetworkDetail').textContent || '';
      const fps = Number(detail.match(/图形 ([0-9]+) FPS/i)?.[1] || detail.match(/([0-9]+)fps/i)?.[1] || 0);
      const snapshotHz = Number(detail.match(/权威 ([0-9.]+) Hz/i)?.[1] || detail.match(/([0-9.]+)Hz/i)?.[1] || 0);
      samples.push({
        elapsed,
        fps,
        snapshotHz,
        detail,
        mass: document.getElementById('gameMass').textContent,
        rank: document.getElementById('gameRank').textContent
      });
    }
    guest.close(1000, 'smoke-complete');
    const steadySamples = samples.filter(sample => sample.elapsed >= 8 && sample.snapshotHz > 0);
    return {
      mode,
      roomCode,
      initialBots,
      filledBots,
      samples,
      summary: {
        activeSamples: samples.length,
        averageFps: samples.length ? Math.round(samples.reduce((sum, sample) => sum + sample.fps, 0) / samples.length) : 0,
        steadyAverageFps: steadySamples.length ? Math.round(steadySamples.reduce((sum, sample) => sum + sample.fps, 0) / steadySamples.length) : 0,
        steadyMinimumFps: steadySamples.length ? Math.min(...steadySamples.map(sample => sample.fps)) : 0,
        minimumFps: samples.length ? Math.min(...samples.map(sample => sample.fps)) : 0,
        averageSnapshotHz: steadySamples.length ? Number((steadySamples.reduce((sum, sample) => sum + sample.snapshotHz, 0) / steadySamples.length).toFixed(1)) : 0
      }
    };
  })()`);
}

function createMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "游戏",
      submenu: [
        { label: "返回首页", click: () => mainWindow?.loadURL(desktopGameUrl("/")) },
        { label: "联机大厅", click: () => mainWindow?.loadURL(desktopGameUrl("/multiplayer.html")) },
        { type: "separator" },
        { label: "退出", role: "quit" }
      ]
    },
    {
      label: "视图",
      submenu: [
        { label: "全屏", role: "togglefullscreen" },
        { label: "重新载入", role: "reload" },
        { type: "separator" },
        { label: "实际大小", role: "resetzoom" },
        { label: "放大", role: "zoomin" },
        { label: "缩小", role: "zoomout" }
      ]
    }
  ]));
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: SMOKE_GAMEPLAY,
    ...(SMOKE_GAMEPLAY ? { x: -10_000, y: -10_000, skipTaskbar: true } : {}),
    backgroundColor: "#07111f",
    title: "星团大作战",
    icon: join(PROJECT_ROOT, "desktop", "assets", "icon.ico"),
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(PROJECT_ROOT, "desktop", "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: !SMOKE_GAMEPLAY
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (normalizeExternalUrl(url)) setImmediate(() => void openAllowedExternal(url));
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!isLocalGameUrl(target)) {
      event.preventDefault();
      return;
    }
    const url = new URL(target);
    if (!url.searchParams.has("desktop") || !url.searchParams.has("refresh")) {
      event.preventDefault();
      mainWindow?.loadURL(desktopGameUrl(`${url.pathname}${url.search}`));
    }
  });
  mainWindow.webContents.on("will-attach-webview", event => event.preventDefault());
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logger.error(`渲染进程异常退出：${details.reason}`);
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) logger.error(`页面加载失败：${code} ${description} ${url}`);
  });

  mainWindow.once("ready-to-show", () => {
    if (!SMOKE_MODE) mainWindow?.show();
  });
  mainWindow.on("enter-full-screen", emitDisplayState);
  mainWindow.on("leave-full-screen", emitDisplayState);
  mainWindow.on("closed", () => { mainWindow = null; });

  const activeDisplay = screen.getDisplayMatching(mainWindow.getBounds());
  desktopRefreshRate = Math.min(240, Math.max(60, Math.round(Number(activeDisplay.displayFrequency) || 60)));
  logger.info(`显示器刷新率：${desktopRefreshRate} Hz；已请求${SMOKE_LOW_POWER_GPU ? "低功耗" : "高性能"} GPU`);

  if (SMOKE_MODE) {
    const smokeWindow = mainWindow;
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const gameplay = SMOKE_GAMEPLAY
            ? (SMOKE_MULTIPLAYER ? await collectMultiplayerGameplaySmoke(smokeWindow) : await collectGameplaySmoke(smokeWindow))
            : null;
          const state = await smokeWindow.webContents.executeJavaScript(`({ title: document.title, connection: document.getElementById("connectionText")?.textContent || "", warning: document.getElementById("networkWarning")?.hidden === false, renderer: document.getElementById("renderBadge")?.title || "", refresh: new URLSearchParams(location.search).get("refresh") })`);
          state.gameplay = gameplay;
          if (SMOKE_MULTIPLAYER && !SMOKE_GAMEPLAY && state.connection !== "联机服务正常") throw new Error(`联机大厅状态异常：${state.connection}`);
          if (gameplay && gameplay.samples.filter(sample => !sample.over).length < 2) throw new Error(`性能采样缺少有效对局帧：${gameplay.mode}`);
          if (gameplay && SMOKE_MIN_FPS > 0 && gameplay.summary.steadyAverageFps < SMOKE_MIN_FPS) {
            throw new Error(`性能采样低于门槛：${gameplay.summary.steadyAverageFps} < ${SMOKE_MIN_FPS} FPS`);
          }
          logger.info(`DESKTOP_SMOKE_OK ${JSON.stringify(state)}`);
        } catch (error) {
          process.exitCode = 2;
          logger.error(error);
        } finally {
          if (process.exitCode) {
            await stopDesktop();
            app.exit(process.exitCode);
          } else {
            app.quit();
          }
        }
      }, SMOKE_MULTIPLAYER ? 1000 : SMOKE_GAMEPLAY ? 500 : 300);
    });
  }

  await mainWindow.loadURL(desktopGameUrl(SMOKE_MULTIPLAYER ? "/multiplayer.html" : "/"));
}

async function startDesktop() {
  const logsDirectory = join(app.getPath("userData"), "logs");
  await mkdir(logsDirectory, { recursive: true });
  logFile = join(logsDirectory, "desktop.log");

  const firewall = await inspectWindowsFirewall({ logger });
  let lastPortError = null;
  for (const port of [25555, 25557, 0]) {
    if (port > 0 && await tcpPortHasListener(port)) {
      lastPortError = Object.assign(new Error(`TCP port ${port} already has a loopback listener`), { code: "EADDRINUSE" });
      logger.warn(`联机端口 ${port} 已有本机服务应答，跳过重叠监听并尝试备用端口。`);
      continue;
    }
    try {
      serverController = await startServer({
        host: "0.0.0.0",
        port,
        preferredPort: 25555,
        discoveryEnabled: true,
        networkDiagnostics: { firewall },
        logger
      });
      break;
    } catch (error) {
      lastPortError = error;
      if (error.code !== "EADDRINUSE" || port === 0) throw error;
      logger.warn(`联机端口 ${port} 已被占用，正在尝试备用端口。`);
    }
  }
  if (!serverController) throw lastPortError || new Error("无法启动内置游戏服务");
  logger.info(`内置游戏服务已启动：${serverController.url}`);
  logger.info(`局域网地址：${serverController.discovery.status().addresses.join(", ") || "无"}；TCP ${serverController.port}；UDP ${serverController.discovery.status().port}；防火墙 ${firewall.status}`);
  createMenu();
  await createMainWindow();
}

async function stopDesktop() {
  if (stopping) return;
  stopping = true;
  try {
    await serverController?.close();
    logger.info("内置游戏服务已停止");
  } catch (error) {
    logger.error(error);
  }
}

if (electronSquirrelStartup) {
  app.quit();
} else {
  const primaryInstance = app.requestSingleInstanceLock();
  if (!primaryInstance) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    });
    app.on("before-quit", event => {
      if (serverController && !stopping) {
        event.preventDefault();
        void stopDesktop().finally(() => app.quit());
      }
    });
    app.on("window-all-closed", () => app.quit());
    app.whenReady().then(async () => {
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      ipcMain.handle("desktop:open-firewall-settings", async event => {
        if (!mainWindow || event.sender !== mainWindow.webContents) return false;
        await shell.openExternal("windowsdefender://Network");
        return true;
      });
      ipcMain.handle("desktop:open-external", async (event, target) => {
        if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, error: "游戏窗口不可用" };
        return openAllowedExternal(target);
      });
      ipcMain.handle("desktop:copy-text", (event, value) => {
        if (!mainWindow || event.sender !== mainWindow.webContents) return false;
        const text = String(value ?? "").slice(0, 256);
        if (!text) return false;
        clipboard.writeText(text);
        return true;
      });
      ipcMain.handle("desktop:get-display-state", event => {
        if (!mainWindow || event.sender !== mainWindow.webContents) return null;
        return currentDisplayState();
      });
      ipcMain.handle("desktop:set-display-mode", (event, settings) => {
        if (!mainWindow || event.sender !== mainWindow.webContents) return null;
        return setDesktopDisplayMode(settings);
      });
      ipcMain.handle("desktop:toggle-fullscreen", event => {
        if (!mainWindow || event.sender !== mainWindow.webContents) return null;
        return setDesktopDisplayMode({ mode: mainWindow.isFullScreen() ? "windowed" : "borderless-fullscreen" });
      });
      ipcMain.handle("desktop:quit", event => {
        if (!mainWindow || event.sender !== mainWindow.webContents) return false;
        app.quit();
        return true;
      });
      await startDesktop();
    }).catch(error => {
      logger.error(error);
      app.exit(1);
    });
  }
}
