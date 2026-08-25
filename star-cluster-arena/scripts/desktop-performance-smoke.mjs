import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const forgeCli = resolve(projectRoot, "node_modules/@electron-forge/cli/dist/electron-forge.js");
const mode = String(process.env.SCA_PERF_MODE || "solo").trim().toLowerCase();
const minimumFps = Math.max(0, Number(process.env.SCA_PERF_MIN_FPS) || 55);
const duration = Math.min(60, Math.max(8, Math.round(Number(process.env.SCA_PERF_DURATION) || 16)));
const lowPower = process.env.SCA_PERF_LOW_POWER_GPU === "1";
const multiplayer = process.env.SCA_PERF_MULTIPLAYER === "1";

const child = spawn(process.execPath, [forgeCli, "start"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    SCA_DESKTOP_SMOKE: "1",
    SCA_DESKTOP_SMOKE_GAMEPLAY: "1",
    SCA_DESKTOP_SMOKE_PATH: multiplayer ? "multiplayer" : "single",
    SCA_DESKTOP_SMOKE_GAMEPLAY_MODE: mode,
    SCA_DESKTOP_SMOKE_DURATION: String(duration),
    SCA_DESKTOP_SMOKE_MIN_FPS: String(minimumFps),
    SCA_DESKTOP_SMOKE_LOW_POWER_GPU: lowPower ? "1" : "0"
  },
  stdio: "inherit",
  windowsHide: true
});

child.once("error", error => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`桌面对局性能采样被信号终止：${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code || 0;
});
