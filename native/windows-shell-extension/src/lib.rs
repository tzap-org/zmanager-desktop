#![cfg(windows)]
#![allow(non_snake_case)]

use std::{
    cell::{Cell, RefCell},
    collections::HashSet,
    ffi::c_void,
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU32, AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use windows::{
    Win32::{
        Foundation::{CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_FAIL, E_INVALIDARG, E_NOTIMPL, HMODULE, S_FALSE, S_OK},
        System::{
            Com::{CoTaskMemFree, IBindCtx, IClassFactory, IClassFactory_Impl},
            LibraryLoader::{GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS, GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT, GetModuleFileNameW, GetModuleHandleExW},
        },
        UI::Shell::{
            ECF_DEFAULT, ECF_HASSUBCOMMANDS, ECS_ENABLED, ECS_HIDDEN, IEnumExplorerCommand, IEnumExplorerCommand_Impl, IExplorerCommand, IExplorerCommand_Impl,
            IShellItemArray, SHStrDupW, SIGDN_FILESYSPATH,
        },
    },
    core::{BOOL, Error, GUID, HRESULT, Interface, PCWSTR, PWSTR, Ref, Result as WindowsResult, w},
};
use windows_core::implement;
use zmanager_shell_contract::{ShellActionKind, ShellActionRequest, base_name_without_archive_extension};

mod generated;
use generated::*;

static LIVE_OBJECTS: AtomicU32 = AtomicU32::new(0);
static SERVER_LOCKS: AtomicU32 = AtomicU32::new(0);
static REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct LiveObject;

impl LiveObject {
    fn new() -> Self {
        LIVE_OBJECTS.fetch_add(1, Ordering::Relaxed);
        Self
    }
}

impl Drop for LiveObject {
    fn drop(&mut self) {
        LIVE_OBJECTS.fetch_sub(1, Ordering::Relaxed);
    }
}

#[implement(IExplorerCommand)]
struct ZManagerExplorerCommand {
    action: ExplorerAction,
    _live: LiveObject,
}

impl ZManagerExplorerCommand {
    fn new(action: ExplorerAction) -> Self {
        Self { action, _live: LiveObject::new() }
    }
}

impl IExplorerCommand_Impl for ZManagerExplorerCommand_Impl {
    fn GetTitle(&self, selection: Ref<'_, IShellItemArray>) -> WindowsResult<PWSTR> {
        if self.action == ExplorerAction::ExtractToFolder
            && let Ok(selection_ref) = selection.ok()
            && let Ok(paths) = selected_file_system_paths(selection_ref)
            && paths.len() == 1
        {
            let folder_name = base_name_without_archive_extension(&paths[0]);
            let title = format!("Extract to \"{folder_name}\"\0");
            let wide: Vec<u16> = title.encode_utf16().collect();
            return unsafe { SHStrDupW(PCWSTR(wide.as_ptr())) };
        }

        unsafe { SHStrDupW(self.action.title()) }
    }

    fn GetIcon(&self, _selection: Ref<'_, IShellItemArray>) -> WindowsResult<PWSTR> {
        Err(Error::from_hresult(E_NOTIMPL))
    }

    fn GetToolTip(&self, _selection: Ref<'_, IShellItemArray>) -> WindowsResult<PWSTR> {
        Err(Error::from_hresult(E_NOTIMPL))
    }

    fn GetCanonicalName(&self) -> WindowsResult<GUID> {
        Ok(self.action.clsid())
    }

    fn GetState(&self, selection: Ref<'_, IShellItemArray>, _ok_to_be_slow: BOOL) -> WindowsResult<u32> {
        let paths = selected_file_system_paths(selection.ok()?)?;
        Ok(if self.action.supports_paths(&paths) { ECS_ENABLED.0 as u32 } else { ECS_HIDDEN.0 as u32 })
    }

    fn Invoke(&self, selection: Ref<'_, IShellItemArray>, _bind_context: Ref<'_, IBindCtx>) -> WindowsResult<()> {
        let paths = selected_file_system_paths(selection.ok()?)?;
        if !self.action.supports_paths(&paths) {
            return Err(Error::from_hresult(E_INVALIDARG));
        }

        let action = self.action.shell_action();
        let worker_lifetime = LiveObject::new();
        std::thread::Builder::new()
            .name("zmanager-shell-handoff".to_string())
            .spawn(move || {
                let _worker_lifetime = worker_lifetime;
                let _ = handoff_to_zmanager(action, paths);
            })
            .map_err(|error| Error::new(E_FAIL, error.to_string()))?;
        Ok(())
    }

    fn GetFlags(&self) -> WindowsResult<u32> {
        Ok(ECF_DEFAULT.0 as u32)
    }

    fn EnumSubCommands(&self) -> WindowsResult<IEnumExplorerCommand> {
        Err(Error::from_hresult(E_NOTIMPL))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ExplorerRoot {
    Archive,
    Create,
}

impl ExplorerRoot {
    fn from_clsid(clsid: &GUID) -> Option<Self> {
        match *clsid {
            ARCHIVE_ROOT_CLSID => Some(Self::Archive),
            CREATE_ROOT_CLSID => Some(Self::Create),
            _ => None,
        }
    }

    fn clsid(self) -> GUID {
        match self {
            Self::Archive => ARCHIVE_ROOT_CLSID,
            Self::Create => CREATE_ROOT_CLSID,
        }
    }

    fn actions(self) -> &'static [ExplorerAction] {
        match self {
            Self::Archive => ARCHIVE_EXPLORER_ACTIONS,
            Self::Create => CREATE_EXPLORER_ACTIONS,
        }
    }
}

#[implement(IEnumExplorerCommand)]
struct ZManagerExplorerCommandEnumerator {
    commands: Vec<IExplorerCommand>,
    index: Cell<usize>,
    _live: LiveObject,
}

impl ZManagerExplorerCommandEnumerator {
    fn new(commands: Vec<IExplorerCommand>) -> Self {
        Self { commands, index: Cell::new(0), _live: LiveObject::new() }
    }
}

impl IEnumExplorerCommand_Impl for ZManagerExplorerCommandEnumerator_Impl {
    fn Next(&self, celt: u32, puicommand: *mut Option<IExplorerCommand>, pceltfetched: *mut u32) -> HRESULT {
        if puicommand.is_null() || (celt != 1 && pceltfetched.is_null()) {
            return E_INVALIDARG;
        }

        let mut fetched = 0;
        while fetched < celt && self.index.get() < self.commands.len() {
            let index = self.index.get();
            unsafe { puicommand.add(fetched as usize).write(Some(self.commands[index].clone())) };
            self.index.set(index + 1);
            fetched += 1;
        }

        if !pceltfetched.is_null() {
            unsafe { pceltfetched.write(fetched) };
        }
        if fetched == celt { S_OK } else { S_FALSE }
    }

    fn Skip(&self, celt: u32) -> WindowsResult<()> {
        self.index.set(self.index.get().saturating_add(celt as usize).min(self.commands.len()));
        Ok(())
    }

    fn Reset(&self) -> WindowsResult<()> {
        self.index.set(0);
        Ok(())
    }

    fn Clone(&self) -> WindowsResult<IEnumExplorerCommand> {
        Ok(ZManagerExplorerCommandEnumerator { commands: self.commands.clone(), index: Cell::new(self.index.get()), _live: LiveObject::new() }.into())
    }
}

#[implement(IExplorerCommand)]
struct ZManagerRootExplorerCommand {
    root: ExplorerRoot,
    subcommands: RefCell<Option<Vec<IExplorerCommand>>>,
    _live: LiveObject,
}

impl ZManagerRootExplorerCommand {
    fn new(root: ExplorerRoot) -> Self {
        Self { root, subcommands: RefCell::new(None), _live: LiveObject::new() }
    }

    fn load_subcommands(&self, selection: Option<&IShellItemArray>) {
        let actions = match selection {
            Some(selection) => match selected_file_system_paths(selection) {
                Ok(paths) => self.root.actions().iter().copied().filter(|action| action.supports_paths(&paths)).collect(),
                Err(_) => Vec::new(),
            },
            None => self.root.actions().to_vec(),
        };
        let commands = actions.into_iter().map(|action| ZManagerExplorerCommand::new(action).into()).collect();
        *self.subcommands.borrow_mut() = Some(commands);
    }

    fn subcommands(&self) -> Vec<IExplorerCommand> {
        let mut subcommands = self.subcommands.borrow_mut();
        let commands =
            subcommands.get_or_insert_with(|| self.root.actions().iter().copied().map(|action| ZManagerExplorerCommand::new(action).into()).collect());
        commands.clone()
    }
}

impl IExplorerCommand_Impl for ZManagerRootExplorerCommand_Impl {
    fn GetTitle(&self, selection: Ref<'_, IShellItemArray>) -> WindowsResult<PWSTR> {
        self.load_subcommands(selection.ok().ok());
        unsafe { SHStrDupW(w!("ZManager")) }
    }

    fn GetIcon(&self, _selection: Ref<'_, IShellItemArray>) -> WindowsResult<PWSTR> {
        Err(Error::from_hresult(E_NOTIMPL))
    }

    fn GetToolTip(&self, _selection: Ref<'_, IShellItemArray>) -> WindowsResult<PWSTR> {
        Err(Error::from_hresult(E_NOTIMPL))
    }

    fn GetCanonicalName(&self) -> WindowsResult<GUID> {
        Ok(self.root.clsid())
    }

    fn GetState(&self, _selection: Ref<'_, IShellItemArray>, _ok_to_be_slow: BOOL) -> WindowsResult<u32> {
        Ok(ECS_ENABLED.0 as u32)
    }

    fn Invoke(&self, _selection: Ref<'_, IShellItemArray>, _bind_context: Ref<'_, IBindCtx>) -> WindowsResult<()> {
        Err(Error::from_hresult(E_NOTIMPL))
    }

    fn GetFlags(&self) -> WindowsResult<u32> {
        Ok(ECF_HASSUBCOMMANDS.0 as u32)
    }

    fn EnumSubCommands(&self) -> WindowsResult<IEnumExplorerCommand> {
        Ok(ZManagerExplorerCommandEnumerator::new(self.subcommands()).into())
    }
}

#[derive(Clone, Copy)]
enum ExplorerClass {
    Root(ExplorerRoot),
    Action(ExplorerAction),
}

impl ExplorerClass {
    fn from_clsid(clsid: &GUID) -> Option<Self> {
        ExplorerRoot::from_clsid(clsid).map(Self::Root).or_else(|| ExplorerAction::from_clsid(clsid).map(Self::Action))
    }
}

#[implement(IClassFactory)]
struct ZManagerClassFactory {
    class: ExplorerClass,
    _live: LiveObject,
}

impl ZManagerClassFactory {
    fn new(class: ExplorerClass) -> Self {
        Self { class, _live: LiveObject::new() }
    }
}

impl IClassFactory_Impl for ZManagerClassFactory_Impl {
    fn CreateInstance(&self, outer: Ref<'_, windows::core::IUnknown>, interface_id: *const GUID, object: *mut *mut c_void) -> WindowsResult<()> {
        if !outer.is_null() {
            return Err(Error::from_hresult(CLASS_E_NOAGGREGATION));
        }
        if interface_id.is_null() || object.is_null() {
            return Err(Error::from_hresult(E_INVALIDARG));
        }

        let command: IExplorerCommand = match self.class {
            ExplorerClass::Root(root) => ZManagerRootExplorerCommand::new(root).into(),
            ExplorerClass::Action(action) => ZManagerExplorerCommand::new(action).into(),
        };
        unsafe { command.query(interface_id, object).ok() }
    }

    fn LockServer(&self, lock: BOOL) -> WindowsResult<()> {
        if lock.as_bool() {
            SERVER_LOCKS.fetch_add(1, Ordering::Relaxed);
        } else {
            let _ = SERVER_LOCKS.fetch_update(Ordering::Release, Ordering::Relaxed, |count| count.checked_sub(1));
        }
        Ok(())
    }
}

fn selected_file_system_paths(selection: &IShellItemArray) -> WindowsResult<Vec<String>> {
    let count = unsafe { selection.GetCount()? };
    let mut paths = Vec::with_capacity(count as usize);
    let mut seen = HashSet::with_capacity(count as usize);

    for index in 0..count {
        let item = unsafe { selection.GetItemAt(index)? };
        let display_name = unsafe { item.GetDisplayName(SIGDN_FILESYSPATH)? };
        let path = unsafe { display_name.to_string() };
        unsafe { CoTaskMemFree(Some(display_name.0.cast())) };
        let path = path?;
        let comparison_key = path.to_lowercase();
        if seen.insert(comparison_key) {
            paths.push(path);
        }
    }

    Ok(paths)
}

fn handoff_to_zmanager(action: ShellActionKind, paths: Vec<String>) -> io::Result<()> {
    let request = ShellActionRequest::new(action, paths);
    let request_json = request.to_json().map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let request_path = write_request_file(&request_json, &std::env::temp_dir())?;
    let executable = zmanager_executable_path()?;

    match Command::new(executable).arg("--shell-action-request").arg(&request_path).spawn() {
        Ok(_) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(request_path);
            Err(error)
        }
    }
}

fn write_request_file(contents: &str, directory: &Path) -> io::Result<PathBuf> {
    for _ in 0..32 {
        let sequence = REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
        let path = directory.join(format!("zmanager-shell-action-{}-{timestamp}-{sequence}.json", std::process::id()));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                file.write_all(contents.as_bytes())?;
                file.sync_all()?;
                return Ok(path);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }

    Err(io::Error::new(io::ErrorKind::AlreadyExists, "unable to allocate a unique shell-action request file"))
}

fn zmanager_executable_path() -> io::Result<PathBuf> {
    let mut module = HMODULE::default();
    unsafe {
        GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            PCWSTR(DllGetClassObject as *const () as *const u16),
            &mut module,
        )
    }
    .map_err(|error| io::Error::other(error.to_string()))?;

    let mut buffer = vec![0u16; 32_768];
    let length = unsafe { GetModuleFileNameW(Some(module), &mut buffer) };
    if length == 0 || length as usize >= buffer.len() {
        return Err(io::Error::last_os_error());
    }
    let dll_path = PathBuf::from(String::from_utf16_lossy(&buffer[..length as usize]));
    let install_directory = dll_path.parent().ok_or_else(|| io::Error::other("shell extension has no install directory"))?;
    Ok(install_directory.join("zmanager-desktop.exe"))
}

#[unsafe(no_mangle)]
unsafe extern "system" fn DllGetClassObject(class_id: *const GUID, interface_id: *const GUID, object: *mut *mut c_void) -> HRESULT {
    if class_id.is_null() || interface_id.is_null() || object.is_null() {
        return E_INVALIDARG;
    }
    unsafe { *object = std::ptr::null_mut() };

    let Some(class) = ExplorerClass::from_clsid(unsafe { &*class_id }) else {
        return CLASS_E_CLASSNOTAVAILABLE;
    };
    let factory: IClassFactory = ZManagerClassFactory::new(class).into();
    unsafe { factory.query(interface_id, object) }
}

#[unsafe(no_mangle)]
unsafe extern "system" fn DllCanUnloadNow() -> HRESULT {
    if LIVE_OBJECTS.load(Ordering::Acquire) == 0 && SERVER_LOCKS.load(Ordering::Acquire) == 0 { S_OK } else { S_FALSE }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use windows::Win32::{
        System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx, CoUninitialize},
        UI::Shell::{Common::ITEMIDLIST, SHCreateShellItemArrayFromIDLists, SHParseDisplayName},
    };

    fn shell_item_array(paths: &[&Path]) -> IShellItemArray {
        let mut owned_pidls = Vec::<*mut ITEMIDLIST>::with_capacity(paths.len());
        for path in paths {
            let wide = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect::<Vec<_>>();
            let mut pidl = std::ptr::null_mut();
            unsafe {
                SHParseDisplayName(PCWSTR(wide.as_ptr()), None, &mut pidl, 0, None).expect("filesystem path should become a shell item");
            }
            owned_pidls.push(pidl);
        }

        let borrowed_pidls = owned_pidls.iter().map(|pidl| *pidl as *const ITEMIDLIST).collect::<Vec<_>>();
        let selection = unsafe { SHCreateShellItemArrayFromIDLists(&borrowed_pidls) }.expect("shell selection array should be created");
        for pidl in owned_pidls {
            unsafe { CoTaskMemFree(Some(pidl.cast())) };
        }
        selection
    }

    fn explorer_command_title(action: ExplorerAction, selection: Option<&IShellItemArray>) -> String {
        let command: IExplorerCommand = ZManagerExplorerCommand::new(action).into();
        let title_pwstr = unsafe {
            match selection {
                Some(selection) => command.GetTitle(selection),
                None => command.GetTitle(None::<&IShellItemArray>),
            }
        }
        .expect("title should resolve");
        let title = unsafe { title_pwstr.to_string() }.expect("title to string");
        unsafe { CoTaskMemFree(Some(title_pwstr.0.cast())) };
        title
    }

    #[test]
    fn every_registered_class_maps_to_one_shell_action() {
        for expected in ALL_EXPLORER_ACTIONS {
            let class_id = expected.clsid();
            let actual = ExplorerAction::from_clsid(&class_id).expect("class should be registered");
            assert_eq!(actual, *expected);
        }
    }

    #[test]
    fn exported_class_factory_creates_the_requested_explorer_command() {
        let mut factory_pointer = std::ptr::null_mut();
        let result = unsafe { DllGetClassObject(&ADD_TO_ZIP_CLSID, &IClassFactory::IID, &mut factory_pointer) };
        assert_eq!(result, S_OK);
        let factory = unsafe { IClassFactory::from_raw(factory_pointer) };

        let command: IExplorerCommand =
            unsafe { factory.CreateInstance(None::<&windows::core::IUnknown>).expect("class factory should create IExplorerCommand") };

        assert_eq!(unsafe { command.GetCanonicalName() }.expect("command should expose its canonical ID"), ADD_TO_ZIP_CLSID);
    }

    #[test]
    fn root_command_enumerates_its_context_actions() {
        let command: IExplorerCommand = ZManagerRootExplorerCommand::new(ExplorerRoot::Archive).into();
        assert_eq!(unsafe { command.GetFlags() }.expect("root should advertise subcommands"), ECF_HASSUBCOMMANDS.0 as u32);

        let enumerator = unsafe { command.EnumSubCommands() }.expect("root should expose a subcommand enumerator");
        let mut commands = vec![None; ARCHIVE_EXPLORER_ACTIONS.len()];
        let mut fetched = 0;
        let result = unsafe { enumerator.Next(&mut commands, Some(&mut fetched)) };

        assert_eq!(result, S_OK);
        assert_eq!(fetched as usize, ARCHIVE_EXPLORER_ACTIONS.len());
        for (command, expected) in commands.into_iter().zip(ARCHIVE_EXPLORER_ACTIONS) {
            assert_eq!(
                unsafe { command.expect("enumerator should return a command").GetCanonicalName() }.expect("child should expose its canonical ID"),
                expected.clsid()
            );
        }
    }

    #[test]
    fn root_command_filters_children_using_the_current_selection() {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok() }.expect("COM apartment should initialize");
        let directory = std::env::temp_dir().join(format!("zmanager-shell-root-command-test-{}", REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)));
        let folder1 = directory.join("folder1");
        let folder2 = directory.join("folder2");
        fs::create_dir_all(&folder1).expect("first folder should be created");
        fs::create_dir_all(&folder2).expect("second folder should be created");

        let selection = shell_item_array(&[&folder1, &folder2]);
        let command: IExplorerCommand = ZManagerRootExplorerCommand::new(ExplorerRoot::Archive).into();
        let title = unsafe { command.GetTitle(Some(&selection)) }.expect("root title should resolve");
        unsafe { CoTaskMemFree(Some(title.0.cast())) };

        let enumerator = unsafe { command.EnumSubCommands() }.expect("filtered root should expose an enumerator");
        let mut commands = vec![None; 8];
        let mut fetched = 0;
        assert_eq!(unsafe { enumerator.Next(&mut commands, Some(&mut fetched)) }, S_OK);
        assert_eq!(fetched, 8);

        let canonical_names = commands
            .into_iter()
            .map(|command| unsafe { command.expect("enumerator should return a command").GetCanonicalName() }.expect("child should expose its canonical ID"))
            .collect::<Vec<_>>();
        assert!(!canonical_names.contains(&OPEN_ARCHIVE_CLSID));
        assert!(!canonical_names.contains(&EXTRACT_TO_FOLDER_CLSID));
        assert!(!canonical_names.contains(&SHARE_ON_LAN_CLSID));

        drop(selection);
        let _ = fs::remove_dir_all(directory);
        unsafe { CoUninitialize() };
    }

    #[test]
    fn exported_class_factory_creates_root_explorer_command() {
        let mut factory_pointer = std::ptr::null_mut();
        let result = unsafe { DllGetClassObject(&ARCHIVE_ROOT_CLSID, &IClassFactory::IID, &mut factory_pointer) };
        assert_eq!(result, S_OK);
        let factory = unsafe { IClassFactory::from_raw(factory_pointer) };

        let command: IExplorerCommand =
            unsafe { factory.CreateInstance(None::<&windows::core::IUnknown>).expect("root class factory should create IExplorerCommand") };

        assert_eq!(unsafe { command.GetCanonicalName() }.expect("root should expose its canonical ID"), ARCHIVE_ROOT_CLSID);
    }

    #[test]
    fn request_file_contains_one_versioned_request_with_all_paths() {
        let directory =
            std::env::temp_dir().join(format!("zmanager-shell-extension-test-{}-{}", std::process::id(), REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&directory).expect("test directory should be created");
        let request = ShellActionRequest::new(ShellActionKind::CompressZip, vec!["C:/work/folder1".to_string(), "C:/work/folder2".to_string()]);

        let path = write_request_file(&request.to_json().unwrap(), &directory).expect("request file should be written");
        let parsed = ShellActionRequest::from_json(&fs::read_to_string(&path).expect("request file should be readable")).expect("request should parse");

        assert_eq!(parsed, request);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn share_on_lan_requires_one_regular_file_but_compress_share_accepts_directories() {
        let directory =
            std::env::temp_dir().join(format!("zmanager-shell-share-shape-test-{}-{}", std::process::id(), REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)));
        let folder = directory.join("folder");
        let file = directory.join("file.txt");
        fs::create_dir_all(&folder).expect("test folder should be created");
        fs::write(&file, b"test").expect("test file should be created");

        let file_path = file.to_string_lossy().into_owned();
        let folder_path = folder.to_string_lossy().into_owned();
        assert!(ExplorerAction::ShareOnLan.supports_paths(std::slice::from_ref(&file_path)));
        assert!(!ExplorerAction::ShareOnLan.supports_paths(std::slice::from_ref(&folder_path)));
        assert!(!ExplorerAction::ShareOnLan.supports_paths(&[file_path.clone(), file_path.clone()]));
        assert!(ExplorerAction::CompressShareOnLan.supports_paths(&[file_path, folder_path]));

        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn windows_shell_item_array_preserves_the_complete_selection() {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok() }.expect("COM apartment should initialize");
        let directory =
            std::env::temp_dir().join(format!("zmanager-shell-selection-test-{}-{}", std::process::id(), REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)));
        let folder1 = directory.join("folder1");
        let folder2 = directory.join("folder2");
        fs::create_dir_all(&folder1).expect("first folder should be created");
        fs::create_dir_all(&folder2).expect("second folder should be created");

        let selection = shell_item_array(&[&folder1, &folder2]);

        let paths = selected_file_system_paths(&selection).expect("complete filesystem selection should resolve");

        assert_eq!(paths.len(), 2);
        assert_eq!(PathBuf::from(&paths[0]), folder1);
        assert_eq!(PathBuf::from(&paths[1]), folder2);

        drop(selection);
        let _ = fs::remove_dir_all(directory);
        unsafe { CoUninitialize() };
    }

    #[test]
    fn extract_to_folder_command_title_is_context_aware_and_falls_back() {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok() }.expect("COM apartment should initialize");
        let directory =
            std::env::temp_dir().join(format!("zmanager-shell-title-test-{}-{}", std::process::id(), REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&directory).expect("dir should be created");
        let archive_file = directory.join("archive.zip");
        let complex_archive_file = directory.join("MPC-BE.1.9.1.x64-installer.zip");
        for path in [&archive_file, &complex_archive_file] {
            fs::write(path, b"test").expect("archive file should be written");
        }

        let archive_selection = shell_item_array(&[&archive_file]);
        assert_eq!(explorer_command_title(ExplorerAction::ExtractToFolder, Some(&archive_selection),), "Extract to \"archive\"");

        let complex_selection = shell_item_array(&[&complex_archive_file]);
        assert_eq!(explorer_command_title(ExplorerAction::ExtractToFolder, Some(&complex_selection),), "Extract to \"MPC-BE.1.9.1.x64-installer\"");

        let multiple_selection = shell_item_array(&[&archive_file, &complex_archive_file]);
        assert_eq!(explorer_command_title(ExplorerAction::ExtractToFolder, Some(&multiple_selection),), "Extract to Archive Folder");
        assert_eq!(explorer_command_title(ExplorerAction::CompressZip, Some(&archive_selection)), "Add to .zip");
        assert_eq!(explorer_command_title(ExplorerAction::ExtractToFolder, None), "Extract to Archive Folder");

        drop(multiple_selection);
        drop(complex_selection);
        drop(archive_selection);
        let _ = fs::remove_dir_all(directory);
        unsafe { CoUninitialize() };
    }
}
