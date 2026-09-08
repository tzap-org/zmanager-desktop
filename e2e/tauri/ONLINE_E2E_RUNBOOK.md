# Online native E2E runbook

The default lane is deterministic and local. It starts an in-process hosted-auth/TZAP fixture, uses a real headless browser for login, delivers the `tzap://` callback through the OS, and runs the desktop native command boundary.

## Windows

From the repository root:

```powershell
.\scripts\test-windows-gui.ps1 -Architecture arm64
```

The script initializes the MSVC, Clang, vcpkg, and OpenSSL environment, builds the debug GUI binary, and runs the complete native suite. The online fixture is the default; no credentials or network access are required.

To run the WDIO lane against an already-built binary:

```powershell
$env:ZMANAGER_GUI_APP_PATH = (Resolve-Path .\src-tauri\target\debug\zmanager-desktop.exe).Path
npm.cmd run test:gui:run
```

## Staging

Staging is explicit and gated. Copy [staging.env.example](../../staging.env.example) to a private env file, fill in the account credentials, and provide the approved browser/deep-link adapter before running:

```powershell
$env:TZAP_E2E_ENV_FILE = (Resolve-Path .\staging.env).Path
$env:TZAP_E2E_STAGING_CALLBACK_ADAPTER = '1'
.\scripts\test-windows-gui.ps1 -Architecture arm64
```

The `online-account.spec.ts` staging lane automates browser login and delivers
the real `tzap://auth/callback` through the OS/deep-link adapter. The local lane
remains the required CI/default acceptance path; staging still requires an
operator-approved browser profile, credentials, and explicit adapter opt-in.
The legacy `staging-contact-sync.spec.ts` uses the same OS callback delivery
path and is an optional staging contact-download regression lane, not a mobile
or LocalSend transport test.

## Artifacts and safety

Each run receives a unique `TZAP_E2E_RUN_ID`, isolated desktop state root,
secure-store namespace, public evidence artifact directory, and a separate
private fixture-secret directory under `%TEMP%\zmanager-online-e2e-secrets`.
Fixture private keys never enter the evidence directory. The runner refuses
production, requires staging credentials, keeps destructive actions disabled by
default, writes failure screenshots/task summaries, redacts secrets from
evidence, and writes receiver-bundle hash evidence beside the archive.
Set `TZAP_E2E_KEEP_ARTIFACTS=1` to retain a successful review bundle; failed
runs retain their failure evidence for diagnosis.
