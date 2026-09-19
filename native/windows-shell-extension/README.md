# ZManager Windows shell extension

This architecture-matched COM DLL implements the selected-item
`IShellExtInit` + `IContextMenu` handler registered by
`packaging/windows/nsis-context-menu.nsh`, following the classic registration
model used by 7-Zip. It also retains the `IExplorerCommand` root implementation
for the registered root CLSIDs. The classic handler receives Explorer's full
selection, builds the ordered `ZManager` submenu, and launches
`zmanager-desktop.exe` once for the selected action.

The classic contract has three details that are easy to get wrong, so they are
covered by unit tests:

- `QueryContextMenu` returns the number of command identifiers claimed and only
  builds a menu for the ordinary browse flags, matching 7-Zip's gate.
- `InvokeCommand` receives a **zero-based** command offset that Explorer has
  already made relative to `idCmdFirst`; subtracting `idCmdFirst` again collapses
  every entry onto the first action. Canonical `ZManager.*` verb strings and the
  wide verb from `CMINVOKECOMMANDINFOEX` resolve to the same command.
- `GetCommandString` answers `GCS_VERB`/`GCS_HELPTEXT` with that verb and
  `GCS_VALIDATE` with `S_OK`/`S_FALSE`, in both the ANSI and wide forms.

The extension must remain a thin operating-system adapter. Do not add archive
planning, format behavior, preferences, passwords, logging, networking, or job
state here. The desktop command layer and `zmanager-core` retain those owners.

Build and test on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-windows-shell-extension.ps1 -RunTests
```

The Windows package build invokes this script automatically and copies the
resulting DLL into the NSIS installer; `scripts/build.bat` goes through the same
`build-windows-static.ps1`, which refuses to package a DLL older than its
sources. Registration is per-user. Folder background commands do not use the DLL
because they have one unambiguous target; they remain static `%V` registry
commands.

Explorer keeps this DLL loaded once a context menu has been shown, so a rebuild
does not take effect until Explorer restarts. The installer handles that itself
when it finds the DLL locked, and `scripts/refresh-windows-shell-extension.ps1`
verifies the result (and restarts as a backstop) after `build.bat`.

The current NSIS registration targets Explorer's classic context menu. A future
signed package-with-external-location manifest can expose the same CLSIDs in the
Windows 11 compact menu without changing this DLL or the request contract.
