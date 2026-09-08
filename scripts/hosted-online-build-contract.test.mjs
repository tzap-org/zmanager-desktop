import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("the product build enables hosted online account sign-in by default", () => {
  const manifest = readFileSync(resolve(repositoryRoot, "src-tauri/Cargo.toml"), "utf8");
  const features = manifest.match(/\[features\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? "";

  assert.match(features, /default\s*=\s*\[[^\]]*"hosted-online"/, "the default Cargo feature set must enable hosted-online");
});
