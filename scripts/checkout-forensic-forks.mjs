#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

try {
  if (process.argv.length > 3) {
    throw new Error("usage: node scripts/checkout-forensic-forks.mjs [sibling-parent-directory]");
  }
  const parent = resolve(process.argv[2] ?? resolve(root, ".."));
  const pins = readFileSync(resolve(root, "forensic-forks.lock"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [name, repository, revision, extra] = line.split(/\s+/);
      if (!/^[a-z0-9][a-z0-9.-]*$/.test(name) || name === ".." ||
          !repository || repository.startsWith("-") || !/^[0-9a-f]{40}$/.test(revision) || extra) {
        throw new Error(`invalid forensic fork pin: ${line}`);
      }
      return { name, repository, revision };
    });
  if (new Set(pins.map(({ name }) => name)).size !== pins.length) {
    throw new Error("duplicate forensic fork checkout name");
  }
  mkdirSync(parent, { recursive: true });
  for (const { name, repository, revision } of pins) {
    const destination = resolve(parent, name);
    if (!existsSync(destination)) {
      git(["clone", "--no-checkout", "--", repository, destination]);
      git(["-C", destination, "checkout", "--detach", revision]);
    }
    // Never reset, switch, or stash an existing developer checkout.
    if (git(["-C", destination, "rev-parse", "HEAD"]) !== revision ||
        git(["-C", destination, "status", "--porcelain"])) {
      throw new Error(`${destination} must be clean at ${revision}; existing work was preserved`);
    }
    console.log(`${name}: verified ${revision}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
