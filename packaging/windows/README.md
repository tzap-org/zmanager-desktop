# Windows Packaging Notes

The Windows bundle uses the Tauri NSIS target plus `nsis-context-menu.nsh`, wired by
`src-tauri/tauri.conf.json` at `bundle.windows.nsis.installerHooks`.

The hook installs an architecture-matched COM DLL and registers the selected-item
handler using the classic 7-Zip-compatible `shellex\ContextMenuHandlers` contract
under `HKCU\Software\Classes`. Explorer initializes the handler with the complete
selection, then the handler builds a `ZManager` submenu and launches:

- `zmanager-desktop.exe --shell-action-request "<request.json>"`

The registration mirrors what 7-Zip's `DllRegisterServer` writes:

- `CLSID\<clsid>` carries the friendly name, and `CLSID\<clsid>\InprocServer32`
  points at the installed DLL with `ThreadingModel = Apartment`.
- `<clsid>` is added to the HKLM `Shell Extensions\Approved` list. The list only
  matters when the shell-extension security policy is on, and it is outside a
  per-user hive, so the hook writes it best-effort and continues unelevated.
- `*`, `Directory` and `Folder` each get
  `shellex\ContextMenuHandlers\ZManager` pointing at that CLSID. `Drive` is
  deliberately left out, exactly as 7-Zip leaves it out.

Explorer can keep a handler DLL loaded for the lifetime of the process.
`ZM_INSTALL_SHELL_EXTENSION_BINARY` tries to delete the current file first; if
that fails, it renames the DLL aside (same-directory rename works for a mapped
image on Windows) before writing the new one. Windows can also accept deletion
and remove the name while Explorer keeps the old image mapped. The new app and
DLL are installed immediately, and the recorded protocol preserves compatibility
state for that old image. ZManager does not schedule a reboot to replace or delete
these files.

The installer records the installed handler version and any potentially loaded older
handler protocol range in `HKCU\Software\ZManager\ShellIntegration`. The current
and minimum supported versions come from `manifests/shell-actions.json`; the
native Rust contract and NSIS include are generated from that source. The app
currently supports protocol version 1, which is also the compatibility default
for existing installs that predate this marker. This keeps the first update from
the released 1.2.7 handler smooth.

`ZM_RESTART_EXPLORER_IF_INCOMPATIBLE` only acts when a prior handler may still be
loaded and its recorded protocol falls outside the app's supported range. Since
Windows may unlink a mapped DLL successfully, the installer treats an existing
DLL as potentially loaded; an incompatible update can therefore restart Explorer
even when the old DLL happened not to be mapped:

- **Fresh install** — there is no old handler, so no restart is needed.
- **Compatible update** — install completes without restarting Explorer. The
  currently open shell keeps the old menu implementation, which can still send
  requests the updated app understands. The newly installed handler takes over
  the next time Explorer naturally starts, such as after sign-in or a user-initiated
  restart. There is no reboot request.
- **Incompatible update** — an interactive install asks before restarting
  Explorer; a silent install restarts it automatically. This path is reserved for
  a shell-action contract change that makes the old handler unable to communicate
  with the updated app.

When intentionally changing the shell-action request format, update
`requestVersion` and the app parser together. Keep
`minimumSupportedRequestVersion` low while the app accepts old formats; raise it
only when dropping an old format is necessary. The installer then refreshes a
still-loaded handler only when its version is outside that window. Static
context-menu registrations are refreshed immediately with `SHChangeNotify` and
do not require restarting Explorer.

Folder-background commands have one target and continue to use the quick-action
CLI contract:

- `zmanager-desktop.exe --quick-action compress --path "<target>"`
- `zmanager-desktop.exe --quick-action compress-tzap --path "<target>"`
- `zmanager-desktop.exe --quick-action compress-zip --path "<target>"`
- `zmanager-desktop.exe --quick-action compress-7z --path "<target>"`
- `zmanager-desktop.exe --quick-action compress-tzst --path "<target>"`
- `zmanager-desktop.exe --quick-action compress-tgz --path "<target>"`
- `zmanager-desktop.exe --quick-action-request "<legacy-request.json>"`

Explorer shows a single `ZManager` cascaded menu. Supported archive extensions show
`Extract Here`, `Extract to Archive Folder`, and `Open archive` first, followed by `Add to archive...`,
`Add to .tzap`, `Add to .zip`, `Add to .7z`, `Add to .tzst`, and `Add to .tgz`, so archive files
can also be archived again. Selected folders and folder backgrounds show the same
add actions. The installed COM-backed classic handler gives generic file and
folder selections the same create actions and receives the complete selection.
Windows 11's compact context menu has separate package-identity requirements.
The folder background cascade remains an explicit ordered per-user
`ExtendedSubCommandsKey` because it invokes the one-target `%V` quick-action
commands directly.
The generic `Add to archive...` action opens the regular Create
Archive dialog with the selected item preloaded. Fixed-format actions use the same
create workflow and start with rename-on-collision enabled. Extraction needs no
per-extension registration: like 7-Zip, the single handler on `*` inspects the
selection and offers the extract actions when every selected file is a supported
archive. `ZM_REGISTER_ARCHIVE_EXTENSION` only clears the `SystemFileAssociations`
entries written by earlier releases.

The selected-item COM handler receives Explorer's full selection data object and
does not use a timing heuristic. Static `%1` registry verbs are retained only as
an accepted compatibility input, not as the installed selected-item workflow.

Release wiring:

1. Keep the NSIS target enabled in `src-tauri/tauri.conf.json`.
2. Build the installer with `scripts/build.bat` or
   `scripts/build-windows-static.ps1`. `build.bat` delegates to
   `build-windows-static.ps1 -Install`, so both paths build the
   architecture-matched shell extension, refuse to package a DLL older than its
   sources, and register the context menu by running the built NSIS installer.
   There is no second registration path to keep in sync.
3. The installer includes `packaging/windows/nsis-context-menu.nsh` automatically via
   `installerHooks`.
4. Validate install/uninstall by checking the DLL and CLSIDs appear after install
   and disappear after uninstall. `scripts/test-windows-shell-integration.ps1`
   asserts the registration contract and the `build.bat` parity, and runs as part
   of `build-windows-static.ps1`.
5. After `-Install`, `build-windows-static.ps1` runs
   `scripts/refresh-windows-shell-extension.ps1 -SkipRestart`, which verifies
   the registered DLL from a separate process without closing the user's
   Explorer windows: the CLSIDs resolve to an existing DLL with
   `ThreadingModel = Apartment`, the three handler keys point at the create root
   CLSID, and `CoCreateInstance` plus `QueryInterface` for `IShellExtInit` and
   `IContextMenu` both succeed. That last check is what distinguishes a current
   handler from one left over before the classic rewrite. Pass
   `-SkipShellRefresh` to skip it, or run the script standalone at any time.

Do not use file timestamps to decide whether Explorer is stale. NSIS `File` and
`Copy-Item` both preserve the *source* file's modification time. Windows can also
accept deletion of a mapped DLL, remove its pathname, and keep its image alive
inside Explorer until that process exits. Therefore, an existing handler DLL is
treated as potentially loaded before replacement or uninstall; an NSIS delete
error alone is not a reliable lock test. The installer compares the recorded
protocol of that potentially loaded handler with the new app's supported range.
Compatible handlers remain active until their host naturally exits, while an
incompatible handler uses the explicit restart path. When a DLL cannot be removed
immediately, uniquely named stale images are retried on later installs and never
set NSIS's reboot-required flag.

Uninstall removes the shell registrations and tries to delete the current and
renamed handler DLLs immediately. It retains the protocol marker for any handler
image that may still be mapped, including when Windows accepted deletion but the
existing Explorer process still holds the image. If immediate deletion fails,
the uninstaller renames that DLL to a unique pending-delete path, then tries to
queue the path with `MoveFileEx(MOVEFILE_DELAY_UNTIL_REBOOT)`. This keeps a
reinstall from reusing a path that Windows has queued for deletion. If the
per-user uninstaller lacks permission to write the machine-wide pending-delete
list, it registers a per-user `RunOnce` cleanup for the next logon instead. A
reinstall before Explorer exits can therefore still apply the compatibility
check. No reboot is forced or prompted.

## Microsoft Store (MSIX)

The release workflow can also build an unsigned MSIX for Microsoft Store
submission. Microsoft signs the package after Store certification. This is a
separate distribution artifact: GitHub's existing NSIS installer and portable
EXE still need their own signatures for trusted direct downloads.

To enable the MSIX artifact, reserve the app name in Partner Center and add these
repository Actions variables using the exact values from **Product identity**:

- `MS_STORE_PACKAGE_NAME`
- `MS_STORE_PUBLISHER`
- `MS_STORE_PUBLISHER_DISPLAY_NAME`

When those three variables exist, each Windows release build creates an x64 or
ARM64 `.msix` and attaches it to the GitHub release. Upload those packages to the
app's Partner Center submission; this workflow does not publish to the Store.
The packages are deliberately unsigned because Store submission replaces the
package signature. Direct-download MSIX distribution would require signing them
with a trusted certificate.
Windows releases include two EXE sets: the plain product names use the local
profile, and names containing `full` use the online profile. The Store MSIX is
built only from the local profile. The online-profile staging smoke test uses
the online build and does not replace the release artifact.

For a local build that produces both the normal Windows installer and Store
package (including the shell extension), run:

```powershell
scripts/prepare-windows-static-build.ps1 `
  -Environment prod `
  -Profile local `
  -Architecture x64 `
  -Build `
  -BuildStoreMsix `
  -StorePackageName "<Partner Center Package/Identity/Name>" `
  -StorePublisher "<Partner Center Package/Identity/Publisher>" `
  -StorePublisherDisplayName "<Partner Center Package/Properties/PublisherDisplayName>"
```

The default build continues to make the existing EXE artifacts. Add
`-BuildStoreMsix` to target the Store format as well; the release workflow uses
this same build path when the three `MS_STORE_*` Actions variables are set.
`-Architecture arm64` produces the ARM64 package instead.

Desktop builds use the local profile by default. It keeps local identity,
certificate, archive, and verification workflows available while hiding hosted
account controls and disabling hosted account and status requests. Use
`-Profile online` to include hosted sign-in, enrollment, renewal, contact sync,
and online certificate status checks. The command-line entry point supports:

```bat
scripts\build.bat                 rem staging environment, local profile
scripts\build.bat online          rem staging environment, online profile
scripts\build.bat prod online     rem production environment, online profile
scripts\build.bat prod            rem production environment, local profile
```

The server environment (`staging` or `prod`) and product profile (`local` or
`online`) are separate choices. Release workflows select the online profile
explicitly.

The package manifest declares the app as a full-trust desktop app, registers
archive file types and the `zmanager:` / `tzap:` protocols, and registers the
existing shell-extension COM class through package identity. Packaged Explorer
context-menu integration is declarative and appears in the Windows 11 modern
menu; on Windows 10 the app remains usable, but this package's Explorer extension
is not available. File-type defaults remain under user control.

Before submission, install and exercise each architecture package on a clean
Windows 11 machine, run the Windows App Certification Kit, and confirm the Store
identity/version in Partner Center. Keep the current NSIS workflow for direct
downloads and users who need the existing installer behavior.
