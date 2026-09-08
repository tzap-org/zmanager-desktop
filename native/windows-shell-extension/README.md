# ZManager Windows shell extension

This architecture-matched COM DLL implements the selected-item
`IExplorerCommand` roots registered by `packaging/windows/nsis-context-menu.nsh`.
Each root enumerates the commands supported by Explorer's current
`IShellItemArray`; the leaf command resolves all filesystem paths, writes one
versioned `ShellActionRequest`, and launches `zmanager-desktop.exe` once.

The extension must remain a thin operating-system adapter. Do not add archive
planning, format behavior, preferences, passwords, logging, networking, or job
state here. The desktop command layer and `zmanager-core` retain those owners.

Build and test on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-windows-shell-extension.ps1 -RunTests
```

The Windows package build invokes this script automatically and copies the
resulting DLL into the NSIS installer. Registration is per-user. Folder
background commands do not use the DLL because they have one unambiguous target;
they remain static `%V` registry commands.

The current NSIS registration targets Explorer's classic context menu. A future
signed package-with-external-location manifest can expose the same CLSIDs in the
Windows 11 compact menu without changing this DLL or the request contract.
