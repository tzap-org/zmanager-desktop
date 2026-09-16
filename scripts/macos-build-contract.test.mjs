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

test("macOS application provides a headless postinstall launch that registers nothing itself", () => {
  const main = readFileSync(resolve(root, "src-tauri/src/main.rs"), "utf8");
  // PlugInKit registers an appex only after its parent app has been run on the
  // Mac, so the install step needs a way to run the app once without UI.
  assert.match(main, /--postinstall/);
  assert.match(main, /postinstall_diagnostic_log_directory/);
  assert.match(main, /wait_for_app_group/);
  // That launch exists to BE a first run, not to issue registration commands.
  // pluginkit edits are reverted by the next discovery pass; LaunchServices is
  // driven from the install script, which knows every path the build produced.
  const executableMain = main
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(executableMain, /pluginkit|lsregister|register_macos_bundle_after_install/);
});

test("macOS installation registers exactly one extension provider", () => {
  const build = readFileSync(resolve(root, "scripts/build-macos.sh"), "utf8");
  assert.match(build, /ditto "\$staged_app" "\$temporary"/);
  assert.match(build, /codesign --verify --deep --strict "\$destination"/);

  // Retire the build's intermediate bundles before force-registering the
  // installed one. LaunchServices indexes apps from almost any location, and a
  // second registered bundle carrying the extensions is what produces duplicate
  // Finder context-menu entries.
  assert.match(build, /"\$lsregister" -u "\$stale_bundle"/);
  assert.match(build, /"\$lsregister" -f "\$destination"/);

  // Run the installed app once so PlugInKit discovers its appexes.
  assert.match(build, /open -n -W -a "\$destination" --args --postinstall/);

  // And prove the end state rather than assuming it.
  assert.match(build, /verify-macos-extension-registration\.sh "\$destination"/);

  // pluginkit must never be used to register or enable a shipping build: its
  // edits are temporary and reverted by the next PlugInKit discovery pass, and
  // the enabled state is a user setting owned by System Settings.
  const executableBuild = build
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  assert.doesNotMatch(executableBuild, /pluginkit/);
  assert.doesNotMatch(executableBuild, /macos-register-bundle/);
});

test("macOS registration verifier asserts a single provider without touching user state", () => {
  const verifier = readFileSync(resolve(root, "scripts/verify-macos-extension-registration.sh"), "utf8");
  assert.match(verifier, /More than one registered bundle carries the Finder Sync extension/);
  // Read-only probes of pluginkit are fine; mutating registration or the user's
  // enabled/disabled choice is not.
  assert.doesNotMatch(verifier, /pluginkit"? +-(?:a|r|e)\b/);
  assert.doesNotMatch(verifier, /-e +use/);
});

test("macOS packaging prepares only the staged release bundle", () => {
  const build = readFileSync(resolve(root, "scripts/build-macos.sh"), "utf8");
  const stage = build.indexOf('run_packaging_step "stage application" ditto "$application" "$staged_app"');
  const prepare = build.indexOf('scripts/prepare-macos-self-contained-app.sh "$staged_app"');

  assert.ok(stage >= 0, "macOS build must stage the Tauri application");
  assert.ok(prepare > stage, "native extensions must be prepared only after staging");
  assert.doesNotMatch(build, /prepare-macos-self-contained-app\.sh "\$application"/);
});

test("macOS source contains no production registration commands", () => {
  const macos = readFileSync(resolve(root, "src-tauri/src/platform/macos.rs"), "utf8");
  const profileRefresh = readFileSync(resolve(root, "scripts/refresh-macos-development-profiles.sh"), "utf8");
  const helper = resolve(root, "scripts/macos-register-bundle.sh");
  const executableSource = macos
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  assert.doesNotMatch(executableSource, /\.args\(\[\s*["']-(?:a|r|f|u)["']/);
  assert.doesNotMatch(profileRefresh, /lsregister|pluginkit/);
  assert.throws(() => readFileSync(helper, "utf8"), /ENOENT/);
});
