# Windows Packaging Notes

The Windows bundle uses the Tauri NSIS target plus `nsis-context-menu.nsh`, wired by
`src-tauri/tauri.conf.json` at `bundle.windows.nsis.installerHooks`.

The hook installs an architecture-matched `IExplorerCommand` COM DLL and registers
current-user Explorer verbs under `HKCU\Software\Classes`. Selected-item commands
receive one `IShellItemArray`, write one versioned request, and launch:

- `zmanager-desktop.exe --shell-action-request "<request.json>"`

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
add actions. The installed COM-backed `*\shell` cascade gives generic file
selections the same create actions in the classic context menu and receives the
complete selection. Windows 11's compact context menu has separate
package-identity requirements. Selected-item cascades use the registered root
`IExplorerCommand` providers, which enumerate the available children for the
current selection. The folder background cascade remains an explicit ordered
per-user `ExtendedSubCommandsKey` because it invokes the one-target `%V`
quick-action commands directly.
The generic `Add to archive...` action opens the regular Create
Archive dialog with the selected item preloaded. Fixed-format actions use the same
create workflow and start with rename-on-collision enabled. Extraction is registered
for supported archive extensions through `SystemFileAssociations`.

The selected-item COM handler receives Explorer's full selection data object and
does not use a timing heuristic. Static `%1` registry verbs are retained only as
an accepted compatibility input, not as the installed selected-item workflow.

Release wiring:

1. Keep the NSIS target enabled in `src-tauri/tauri.conf.json`.
2. Build the installer with `scripts/build-windows-static.ps1`; it builds the
   architecture-matched shell extension before invoking Tauri.
3. The installer includes `packaging/windows/nsis-context-menu.nsh` automatically via
   `installerHooks`.
4. Validate install/uninstall by checking the DLL and CLSIDs appear after install
   and disappear after uninstall.

Next packaging steps remain code signing, WinGet metadata after public artifacts are
stable, and a signed package-with-external-location registration if first-tier
Windows 11 compact-menu placement is required. That packaging enhancement reuses
the same COM DLL and versioned request boundary.
