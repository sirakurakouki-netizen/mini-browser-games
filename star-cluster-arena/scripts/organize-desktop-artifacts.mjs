import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseRoot = resolve(projectRoot, "../star-cluster-arena-desktop");
const buildRoot = join(releaseRoot, "build");
const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const versionRoot = join(releaseRoot, `v${packageJson.version}`);

async function listFiles(root) {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) found.push(...await listFiles(absolute));
    else if (entry.isFile()) found.push(absolute);
  }
  return found;
}

async function sha256(file) {
  const bytes = await readFile(file);
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

function selectArtifact(files, extension, marker) {
  const version = packageJson.version.toLowerCase();
  return files.find(file => {
    const name = basename(file).toLowerCase();
    return extname(name) === extension && name.includes(version) && name.includes(marker);
  });
}

await mkdir(versionRoot, { recursive: true });
const files = await listFiles(buildRoot);
const installer = selectArtifact(files, ".exe", "安装程序");
const portable = selectArtifact(files, ".zip", "便携版");

if (!installer || (await stat(installer)).size < 1024 * 1024) throw new Error("没有找到有效的 NSIS 桌面安装程序");
if (!portable || (await stat(portable)).size < 1024 * 1024) throw new Error("没有找到有效的桌面便携版压缩包");

const installerTarget = join(versionRoot, `星团大作战-安装程序-${packageJson.version}-win-x64.exe`);
const portableTarget = join(versionRoot, `星团大作战-便携版-${packageJson.version}-win-x64.zip`);
await copyFile(installer, installerTarget);
await copyFile(portable, portableTarget);

const checksums = [
  `${await sha256(installerTarget)}  ${basename(installerTarget)}`,
  `${await sha256(portableTarget)}  ${basename(portableTarget)}`
];
await writeFile(join(versionRoot, "SHA256SUMS.txt"), `${checksums.join("\r\n")}\r\n`, "utf8");
await writeFile(join(versionRoot, "使用说明.txt"), [
  `星团大作战 ${packageJson.version}（Windows x64）`,
  packageJson.version.includes("beta") ? "注意：这是联机测试版，不替代 v3.6.0 稳定版。AI、完整随机事件与多阶段安全区仍在继续对齐。" : "",
  "",
  `安装版：双击“${basename(installerTarget)}”，可在安装向导中选择安装位置、桌面快捷方式和当前用户/所有用户安装。`,
  `便携版：完整解压“${basename(portableTarget)}”，再双击解压目录内的 StarClusterArena.exe。`,
  "请勿只从便携版目录单独复制 EXE，否则游戏资源和内置联机服务会缺失。",
  "升级或更改安装目录不会主动删除用户存档，卸载时也默认保留存档。",
  "",
  "局域网联机：一名玩家在游戏内创建房间，其他玩家从联机大厅自动发现并加入，无需手工输入 IP。",
  "如 Windows 防火墙询问网络访问权限，请只允许可信的专用网络。未购买代码签名证书的构建可能触发 SmartScreen 提示。",
  "",
  "协议：sca-lan-v6；联机模式：10 种；真人上限：8；AI 按模式目标人数自动补位。"
].join("\r\n"), "utf8");

console.log(`发行目录：${versionRoot}`);
console.log(`安装程序：${installerTarget}`);
console.log(`便携版：${portableTarget}`);
console.log(`SHA-256：${join(versionRoot, "SHA256SUMS.txt")}`);
