import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifestCandidates = [
  resolve("dist/.vite/manifest.json"),
  resolve("dist/manifest.json"),
];
const manifestPath = manifestCandidates.find((candidate) => existsSync(candidate));
if (!manifestPath) {
  throw new Error("Vite manifest is missing; cannot verify the Quick Action bundle split.");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const main = manifest["index.html"];
const task = manifest["src/runtime/DisposableTaskRuntimeApp.tsx"];
const shell = manifest["src/ui/react/AppShell.tsx"];

if (!main || !task || !shell) {
  throw new Error("Quick Action bundle contract could not find all surface entries in the Vite manifest.");
}

const dynamicImports = new Set(main.dynamicImports ?? []);
if (!dynamicImports.has("src/runtime/DisposableTaskRuntimeApp.tsx")
  || !dynamicImports.has("src/ui/react/AppShell.tsx")) {
  throw new Error("src/main.ts must dynamically import exactly one surface at runtime.");
}

if (task.file === shell.file) {
  throw new Error("Disposable Task and manager surfaces share an entry chunk.");
}

function reachableFiles(entryKey, visited = new Set()) {
  if (visited.has(entryKey)) return visited;
  visited.add(entryKey);
  for (const importedKey of manifest[entryKey]?.imports ?? []) {
    reachableFiles(importedKey, visited);
  }
  return visited;
}

if (reachableFiles("src/runtime/DisposableTaskRuntimeApp.tsx").has("src/ui/react/AppShell.tsx")) {
  throw new Error("Disposable Task entry transitively imports the manager surface.");
}

console.log(`Quick Action bundle contract passed: task=${task.file}, manager=${shell.file}`);
