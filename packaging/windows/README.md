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

Explorer keeps a handler DLL loaded for the lifetime of the process, so
`ZM_INSTALL_SHELL_EXTENSION_BINARY` moves a locked DLL aside (renaming inside the
same directory is permitted) and schedules the stale copy for deletion on reboot
before writing the new one. Without that step a reinstall would silently keep the
previous DLL and the refreshed registration would resolve to stale code.

Replacing the file is not enough on its own: a running Explorer keeps serving the
image it already mapped. The rename is therefore also the signal that this
happened, and `ZM_RESTART_EXPLORER_IF_STALE` acts on it:

- **Fresh install** — nothing was locked, Explorer has no handler mapped, and it
  picks the new one up on the next context menu. No restart, no prompt.
- **Upgrade over a running Explorer** — the DLL was locked. A silent install
  (`/S`, which `scripts/build.bat` uses) restarts Explorer automatically; an
  interactive install asks first, because the user's open Explorer windows close.
  Declining leaves the menu on the old handler until the next sign-out.

Windows normally relaunches the shell itself, so the hook only starts
`explorer.exe` manually when `Shell_TrayWnd` has not reappeared. That avoids
leaving a stray folder window open.

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
   `scripts/refresh-windows-shell-extension.ps1`, which verifies the result on
   the machine: the CLSIDs resolve to an existing DLL with
   `ThreadingModel = Apartment`, the three handler keys point at the create root
   CLSID, and `CoCreateInstance` plus `QueryInterface` for `IShellExtInit` and
   `IContextMenu` both succeed. That last check is what distinguishes a current
   handler from one left over before the classic rewrite. Pass
   `-SkipShellRefresh` to skip it, or run the script standalone at any time.

Do not use file timestamps to decide whether Explorer is stale. NSIS `File` and
`Copy-Item` both preserve the *source* file's modification time, so a freshly
installed DLL carries its build time and can look older than a shell that started
after it was installed. The reliable signal is whether the renamed-aside
`<dll>.old` can be deleted: if it is still locked, some process has the previous
image mapped, and deleting it after the restart proves the image was released.

Next packaging steps remain code signing, WinGet metadata after public artifacts are
stable, and a signed package-with-external-location registration if first-tier
Windows 11 compact-menu placement is required. That packaging enhancement reuses
the same COM DLL and versioned request boundary.
