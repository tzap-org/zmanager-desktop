#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [coreLock = resolve(root, "..", "zmanager", "Cargo.lock"), desktopLock = resolve(root, "src-tauri", "Cargo.lock")] = process.argv.slice(2);
const sharedPackages = [
  "aff4",
  "backhand",
  "btrfs-core",
  "dar-core",
  "forensic-vfs-engine",
  "tzap-core",
  "zfs-forensic-core",
  "zip",
  "zip-forensic-core",
  "zmanager-core",
];

function packageVersions(path) {
  const source = readFileSync(path, "utf8");
  const packages = new Map();
  for (const block of source.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = block.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    const version = block.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    if (name && version) {
      const versions = packages.get(name) ?? new Set();
      versions.add(version);
      packages.set(name, versions);
    }
  }
  return packages;
}

try {
  const core = packageVersions(coreLock);
  const desktop = packageVersions(desktopLock);
  const mismatches = [];
  for (const name of sharedPackages) {
    const coreVersions = [...(core.get(name) ?? [])].sort();
    const desktopVersions = [...(desktop.get(name) ?? [])].sort();
    if (coreVersions.length === 0 || desktopVersions.length === 0 ||
        coreVersions.join(",") !== desktopVersions.join(",")) {
      mismatches.push(`${name}: core=[${coreVersions.join(",") || "missing"}], desktop=[${desktopVersions.join(",") || "missing"}]`);
    }
  }
  if (mismatches.length) {
    throw new Error(`shared lock versions differ:\n${mismatches.join("\n")}`);
  }
  console.log(`Shared package versions match across ${coreLock} and ${desktopLock}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
