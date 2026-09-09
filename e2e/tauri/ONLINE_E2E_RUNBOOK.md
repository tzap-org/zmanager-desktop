# Online native E2E runbook

The native hosted-account lane is staging-only. It uses a real staging
account, the normal installed product configuration, and delivers the
`tzap://` callback through the registered operating-system protocol handler.
The login helper uses a separate Playwright browser session after Windows UI
Automation observes the user's configured default browser. Production and
local fixtures are not allowed.

## Windows

From the repository root:

```powershell
.\scripts\test-windows-standalone-staging.ps1 -Architecture arm64 -InstallMissing -InstallNodeModules
```

The script initializes the MSVC, Clang, vcpkg, and OpenSSL environment, builds
the normal-product staging NSIS package, installs it into an isolated temporary
directory, and runs the native suite against that installed executable. Staging
credentials and the registered staging client ID are required.
The runner uninstalls the temporary NSIS package after the run so the `tzap://`
registration is not left pointing at a deleted executable.

To smoke the actual staging release artifact without the debug WebDriver
plugin:

```powershell
.\scripts\test-windows-standalone-staging.ps1 -Architecture arm64 -ReleaseArtifact -InstallMissing -InstallNodeModules
```

To run the WDIO lane against an already-built binary:

```powershell
$env:ZMANAGER_GUI_APP_PATH = (Resolve-Path .\src-tauri\target\debug\zmanager-desktop.exe).Path
npm.cmd run test:gui:run
```

## Staging configuration

Copy [staging.env.example](../../staging.env.example) to a private env file and
fill in the account credentials and registered staging client ID before running:

```powershell
$env:TZAP_E2E_ENV_FILE = (Resolve-Path .\staging.env).Path
.\scripts\test-windows-standalone-staging.ps1 -Architecture arm64 -InstallMissing -InstallNodeModules
```

The `online-account.spec.ts` staging lane drives the real Account UI opener and
delivers the real `tzap://auth/callback` through the OS protocol handler. The
release-artifact driver in `e2e/tauri/release-artifact-smoke.ts` performs the
same flow through external Windows UI Automation, including warm/cold callback,
enrollment, restart, and UI cleanup. The runner rejects local and production
environment settings. Staging still requires an operator-approved browser
profile and credentials.
The legacy `staging-contact-sync.spec.ts` uses the same OS callback delivery
path and is an optional staging contact-download regression lane, not a mobile
or LocalSend transport test.

## Artifacts and safety

Each run receives a unique `TZAP_E2E_RUN_ID`, isolated desktop state root,
secure-store namespace, and public evidence artifact directory. The runner
refuses local and production environments, requires staging credentials, keeps
destructive actions disabled by default, writes failure screenshots/task
summaries, redacts secrets from evidence, and writes receiver-bundle hash
evidence beside the archive.
Set `TZAP_E2E_KEEP_ARTIFACTS=1` to retain a successful review bundle; failed
runs retain their failure evidence for diagnosis.
