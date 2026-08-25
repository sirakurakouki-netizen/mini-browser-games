import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const requiredFiles = [
  "backend/server.mjs",
  "desktop/main.mjs",
  "desktop/preload.mjs",
  "desktop/external-links.mjs",
  "desktop/forge.config.mjs",
  "desktop/electron-builder.yml",
  "desktop/assets/icon.ico",
  "frontend/index.html",
  "frontend/multiplayer.html",
  "frontend/js/cosmetic-catalog.js",
  "frontend/js/gameplay-core.js",
  "frontend/js/game-mode-catalog.js",
  "frontend/js/local-predictor.js",
  "frontend/js/multiplayer.js",
  "frontend/js/snapshot-buffer.js",
  "frontend/js/snapshot-wire.js",
  "backend/multiplayer/modes.mjs",
  "backend/multiplayer/snapshot-wire.mjs",
  "docs/SDD-LAN-MULTIPLAYER-DESKTOP.md",
  "docs/SDD-MULTIPLAYER-MODES-PERFORMANCE-V3.2.md",
  "docs/SDD-SHARED-GAMEPLAY-PERFORMANCE-V3.3.md",
  "docs/SDD-PERFORMANCE-VALIDATION-V3.3.1.md",
  "docs/SDD-CANONICAL-MULTIPLAYER-PARITY-V3.4.md",
  "docs/SDD-UNIFIED-GAME-SHELL-LAN-V3.5.md",
  "docs/SDD-CANONICAL-GAMEPLAY-DESKTOP-V3.6.md",
  "docs/RELEASE-NOTES-V3.6.0.md"
];

async function recurse(relativeDirectory) {
  const root = join(projectRoot, relativeDirectory);
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relative = join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...await recurse(relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

for (const relative of requiredFiles) await access(join(projectRoot, relative));

const sourceFiles = (await Promise.all([
  recurse("backend"),
  recurse("desktop"),
  recurse("frontend/js"),
  recurse("scripts")
])).flat().filter(file => [".js", ".mjs"].includes(extname(file)));

for (const relative of sourceFiles) {
  execFileSync(process.execPath, ["--check", join(projectRoot, relative)], { stdio: "pipe" });
}

const htmlFiles = ["frontend/index.html", "frontend/multiplayer.html"];
for (const relative of htmlFiles) {
  const html = await readFile(join(projectRoot, relative), "utf8");
  const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)].map(match => match[1]);
  for (const reference of references) {
    if (!reference.startsWith("./") && !reference.startsWith("../")) continue;
    const localPath = reference.split(/[?#]/, 1)[0];
    await access(resolve(projectRoot, dirname(relative), localPath));
  }
}

console.log(`项目检查通过：${requiredFiles.length} 个关键文件，${sourceFiles.length} 个脚本语法有效，HTML 本地资源完整。`);
