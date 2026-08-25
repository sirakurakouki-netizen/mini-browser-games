import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("starClusterDesktop", Object.freeze({
  desktop: true,
  platform: process.platform,
  electron: process.versions.electron,
  openFirewallSettings: () => ipcRenderer.invoke("desktop:open-firewall-settings"),
  openExternal: url => ipcRenderer.invoke("desktop:open-external", url),
  copyText: value => ipcRenderer.invoke("desktop:copy-text", value),
  getDisplayState: () => ipcRenderer.invoke("desktop:get-display-state"),
  setDisplayMode: settings => ipcRenderer.invoke("desktop:set-display-mode", settings),
  toggleFullscreen: () => ipcRenderer.invoke("desktop:toggle-fullscreen"),
  onDisplayState: callback => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("desktop:display-state", handler);
    return () => ipcRenderer.removeListener("desktop:display-state", handler);
  },
  quitApp: () => ipcRenderer.invoke("desktop:quit")
}));
