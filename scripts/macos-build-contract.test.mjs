import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("macOS build bootstraps generated UniFFI Swift sources before Cargo", () => {
  const build = readFileSync(resolve(root, "scripts/build-macos.sh"), "utf8");
  const sync = build.indexOf("scripts/sync-uniffi-swift-bindings.sh");
  const cargoTest = build.indexOf("(cd src-tauri && cargo test)");
  const tauriBuild = build.indexOf("npm run tauri");

  assert.notEqual(sync, -1, "macOS build must sync UniFFI Swift sources");
  assert.ok(cargoTest === -1 || sync < cargoTest, "sync must precede macOS Cargo tests");
  assert.ok(sync < tauriBuild, "sync must precede the Tauri macOS build");
});

test("macOS package CI syncs UniFFI Swift sources before Cargo validation", () => {
  const workflow = readFileSync(resolve(root, ".github/workflows/package.yml"), "utf8");
  const sync = workflow.indexOf("scripts/sync-uniffi-swift-bindings.sh");
  const cargo = workflow.indexOf("cargo clippy");

  assert.notEqual(sync, -1, "package CI must sync UniFFI Swift sources");
  assert.ok(sync < cargo, "package CI sync must precede Cargo validation");
});

test("macOS release CI syncs UniFFI Swift sources before Cargo validation", () => {
  const workflow = readFileSync(resolve(root, ".github/workflows/release.yml"), "utf8");
  const sync = workflow.indexOf("scripts/sync-uniffi-swift-bindings.sh");
  const cargo = workflow.indexOf("cargo clippy");

  assert.notEqual(sync, -1, "release CI must sync UniFFI Swift sources");
  assert.ok(sync < cargo, "release CI sync must precede Cargo validation");
});

test("macOS linkers include SystemConfiguration for system proxy support", () => {
  const rustBuild = readFileSync(resolve(root, "src-tauri/build.rs"), "utf8");
  const nativeBuild = readFileSync(resolve(root, "scripts/build-macos-native-targets.sh"), "utf8");

  assert.match(
    rustBuild,
    /cargo:rustc-link-lib=framework=SystemConfiguration/,
    "Tauri's macOS final link must include SystemConfiguration",
  );
  assert.match(
    nativeBuild,
    /-framework CoreFoundation -framework Security -framework SystemConfiguration/,
    "UniFFI extension linkers must include SystemConfiguration",
  );
});

test("macOS native FFI targets include hosted TZAP metadata support", () => {
  const nativeBuild = readFileSync(resolve(root, "scripts/build-macos-native-targets.sh"), "utf8");
  assert.match(nativeBuild, /cargo build --release --features tzap-online --target/);
});

test("macOS artifact packaging reports and validates every post-build boundary", () => {
  const build = readFileSync(resolve(root, "scripts/build-macos.sh"), "utf8");

  assert.match(build, /run_packaging_step "stage application" ditto/);
  assert.match(build, /run_packaging_step "create ZIP" ditto/);
  assert.match(build, /run_packaging_step "stage application for DMG" ditto/);
  assert.match(build, /run_packaging_step "create DMG" hdiutil/);
  assert.match(build, /Staged macOS application is incomplete/);
  assert.match(build, /macOS ZIP was not created/);
  assert.match(build, /macOS DMG was not created/);
});

test("macOS application bundles claim both native URL schemes", () => {
  const prepare = readFileSync(resolve(root, "scripts/prepare-macos-self-contained-app.sh"), "utf8");
  const releaseGate = readFileSync(resolve(root, "scripts/release-gate-macos.sh"), "utf8");
  assert.match(prepare, /CFBundleURLSchemes.*\["zmanager", "tzap"\]/s);
  assert.match(releaseGate, /CFBundleURLSchemes.*\["zmanager", "tzap"\]/s);
});

test("release packaging scripts validate Rust in the release profile", () => {
  const scripts = [
    "scripts/build-macos.sh",
    "scripts/build-linux-ubuntu-deb.sh",
    "scripts/build-linux-fedora-rpm.sh",
  ];

  for (const scriptPath of scripts) {
    const script = readFileSync(resolve(root, scriptPath), "utf8");
    assert.match(script, /cargo test --release\)/, `${scriptPath} must run release tests`);
    if (!scriptPath.endsWith("build-macos.sh")) {
      assert.match(
        script,
        /cargo clippy --release --all-targets --all-features/,
        `${scriptPath} must run release clippy`,
      );
    }
  }
});

test("ordinary application startup never rewrites operating-system shell registration", () => {
  const main = readFileSync(resolve(root, "src-tauri/src/main.rs"), "utf8");
  const setupStart = main.indexOf(".setup(");
  const setupEnd = main.indexOf(".on_window_event", setupStart);

  assert.notEqual(setupStart, -1, "Tauri setup block must be present");
  assert.notEqual(setupEnd, -1, "Tauri setup block must have a detectable end");
  assert.doesNotMatch(
    main.slice(setupStart, setupEnd),
    /ensure_macos_registration|register_macos_bundle_after_install/,
    "normal app launch must observe shell integration without registering it",
  );

  const windowsInstaller = readFileSync(
    resolve(root, "packaging/windows/nsis-context-menu.nsh"),
    "utf8",
  );
  const linuxInstaller = readFileSync(
    resolve(root, "packaging/linux/postinstall.sh"),
    "utf8",
  );
  assert.match(windowsInstaller, /!macro NSIS_HOOK_POSTINSTALL/);
  assert.match(linuxInstaller, /update-mime-database/);
  assert.match(linuxInstaller, /reload_nautilus_extensions/);
});

test("macOS postinstall diagnostics cannot write into the signed application bundle", () => {
  const main = readFileSync(resolve(root, "src-tauri/src/main.rs"), "utf8");
  const postinstallStart = main.indexOf('Some("--postinstall")');
  const postinstallEnd = main.indexOf("\n    let diagnostics = diagnostics::DiagnosticLog::new();", postinstallStart);
  const postinstall = main.slice(postinstallStart, postinstallEnd);

  assert.notEqual(postinstallStart, -1, "postinstall branch must be present");
  assert.match(
    postinstall,
    /diagnostics\.initialize\(platform::postinstall_diagnostic_log_directory\(\), true\)/,
    "postinstall must use the user-only diagnostic location policy",
  );
});

test("macOS packaging verifies the installed signature after postinstall exits", () => {
  const build = readFileSync(resolve(root, "scripts/build-macos.sh"), "utf8");
  const postinstall = build.indexOf('open -W -a "$destination" --args --postinstall');
  const verifyInstalled = build.indexOf('codesign --verify --deep --strict "$destination"', postinstall);

  assert.notEqual(postinstall, -1, "installed app postinstall launch must be present");
  assert.ok(verifyInstalled > postinstall, "installed bundle signature must be verified after postinstall");
});
