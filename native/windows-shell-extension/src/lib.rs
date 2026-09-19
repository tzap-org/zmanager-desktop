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
            Com::{CoTaskMemFree, IBindCtx, IClassFactory, IClassFactory_Impl, IDataObject},
            LibraryLoader::{GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS, GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT, GetModuleFileNameW, GetModuleHandleExW},
            Registry::HKEY,
        },
        UI::Shell::{
            CMF_EXPLORE, CMF_NORMAL, CMF_VERBSONLY, CMINVOKECOMMANDINFO, CMINVOKECOMMANDINFOEX, ECF_DEFAULT, ECF_HASSUBCOMMANDS, ECS_ENABLED, ECS_HIDDEN,
            GCS_HELPTEXTW, GCS_UNICODE, GCS_VALIDATEW, GCS_VERBW, IContextMenu, IContextMenu_Impl, IEnumExplorerCommand, IEnumExplorerCommand_Impl,
            IExplorerCommand, IExplorerCommand_Impl, IShellExtInit, IShellExtInit_Impl, IShellItemArray, SHCreateShellItemArrayFromDataObject, SHStrDupW,
            SIGDN_FILESYSPATH,
        },
        UI::WindowsAndMessaging::{AppendMenuW, CreatePopupMenu, DestroyMenu, HMENU, InsertMenuW, MF_BYPOSITION, MF_POPUP, MF_STRING},
    },
    core::{BOOL, Error, GUID, HRESULT, Interface, PCWSTR, PSTR, PWSTR, Ref, Result as WindowsResult, w},
};
use windows_core::implement;
use zmanager_shell_contract::{SUPPORTED_ARCHIVE_SUFFIXES, ShellActionKind, ShellActionRequest, base_name_without_archive_extension};

mod generated;
use generated::*;

/// Selected-item verbs Explorer may invoke by name instead of by command
/// offset. 7-Zip publishes the same kind of stable `SevenZip*` verb strings.
const CLASSIC_VERB_PREFIX: &str = "ZManager.";

/// `CMINVOKECOMMANDINFOEX::lpVerbW` is only meaningful when the caller sets
/// this mask; `windows` does not re-export the shell's `CMIC_MASK_UNICODE`.
const CMIC_MASK_UNICODE: u32 = 0x0000_4000;

/// The low four bits of `QueryContextMenu`'s flags carry the menu type.
const CMF_TYPE_MASK: u32 = 0x0000_000F;

/// `IS_INTRESOURCE`: Explorer packs a zero-based command offset into the verb
/// pointer instead of passing a string.
fn is_int_resource(value: usize) -> bool {
    value >> 16 == 0
}

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

#[implement(IExplorerCommand, IContextMenu, IShellExtInit)]
struct ZManagerRootExplorerCommand {
    root: ExplorerRoot,
    subcommands: RefCell<Option<Vec<IExplorerCommand>>>,
    classic_paths: RefCell<Vec<String>>,
    classic_actions: RefCell<Vec<ExplorerAction>>,
    _live: LiveObject,
}

impl ZManagerRootExplorerCommand {
    fn new(root: ExplorerRoot) -> Self {
        Self {
            root,
            subcommands: RefCell::new(None),
            classic_paths: RefCell::new(Vec::new()),
            classic_actions: RefCell::new(Vec::new()),
            _live: LiveObject::new(),
        }
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

    fn classic_actions_for_paths(&self, paths: &[String]) -> Vec<ExplorerAction> {
        if paths.is_empty() {
            return Vec::new();
        }
        let actions = if self.root == ExplorerRoot::Create && paths.iter().all(|path| is_supported_archive_file(path)) {
            ARCHIVE_EXPLORER_ACTIONS
        } else {
            self.root.actions()
        };
        actions.iter().copied().filter(|action| action.supports_paths(paths)).collect()
    }

    /// Resolve the command Explorer is asking about, accepting every form the
    /// classic contract allows: the unicode verb, the ANSI verb, or the
    /// zero-based command offset packed as an integer resource.
    fn classic_command_index(&self, command: &CMINVOKECOMMANDINFO) -> Option<usize> {
        if command.cbSize as usize >= size_of::<CMINVOKECOMMANDINFOEX>() && command.fMask & CMIC_MASK_UNICODE != 0 {
            let extended = unsafe { &*(command as *const CMINVOKECOMMANDINFO).cast::<CMINVOKECOMMANDINFOEX>() };
            if !is_int_resource(extended.lpVerbW.0 as usize) {
                return self.classic_index_for_verb(&unsafe { extended.lpVerbW.to_string() }.ok()?);
            }
        }

        let verb = command.lpVerb.0 as usize;
        if is_int_resource(verb) {
            // MSDN: the offset is already relative to idCmdFirst, so it indexes
            // the command list directly. Subtracting idCmdFirst would be wrong.
            return Some(verb & 0xFFFF);
        }
        self.classic_index_for_verb(&unsafe { command.lpVerb.to_string() }.ok()?)
    }

    fn classic_index_for_verb(&self, verb: &str) -> Option<usize> {
        self.classic_actions.borrow().iter().position(|action| classic_verb(*action).eq_ignore_ascii_case(verb))
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

impl IShellExtInit_Impl for ZManagerRootExplorerCommand_Impl {
    fn Initialize(
        &self,
        _pidlfolder: *const windows::Win32::UI::Shell::Common::ITEMIDLIST,
        pdtobj: Ref<'_, IDataObject>,
        _hkeyprogid: HKEY,
    ) -> WindowsResult<()> {
        self.classic_paths.borrow_mut().clear();
        self.classic_actions.borrow_mut().clear();

        let data_object = pdtobj.ok()?;
        let shell_items: IShellItemArray = unsafe { SHCreateShellItemArrayFromDataObject(data_object)? };
        let paths = selected_file_system_paths(&shell_items)?;
        let actions = self.classic_actions_for_paths(&paths);
        *self.classic_paths.borrow_mut() = paths;
        *self.classic_actions.borrow_mut() = actions;
        Ok(())
    }
}

impl IContextMenu_Impl for ZManagerRootExplorerCommand_Impl {
    fn QueryContextMenu(&self, hmenu: HMENU, indexmenu: u32, idcmdfirst: u32, idcmdlast: u32, uflags: u32) -> HRESULT {
        // 7-Zip's gate: build the menu for the ordinary browse cases only. The
        // remaining menu types ask for the default verb, so we add nothing.
        if uflags & CMF_TYPE_MASK != CMF_NORMAL && uflags & CMF_VERBSONLY == 0 && uflags & CMF_EXPLORE == 0 {
            return HRESULT(0);
        }
        if idcmdfirst > idcmdlast {
            return E_INVALIDARG;
        }

        let paths = self.classic_paths.borrow().clone();
        let capacity = (idcmdlast - idcmdfirst + 1) as usize;
        let actions: Vec<ExplorerAction> = self.classic_actions_for_paths(&paths).into_iter().take(capacity).collect();
        *self.classic_actions.borrow_mut() = actions.clone();
        if actions.is_empty() {
            return HRESULT(0);
        }

        // Explorer passes a null menu when it only wants the command count.
        if !hmenu.is_invalid() && !self.insert_classic_menu(hmenu, indexmenu, idcmdfirst, &actions, &paths) {
            return HRESULT(0);
        }

        // MSDN: report the number of command identifiers claimed so sibling
        // handlers are given a disjoint identifier range.
        HRESULT(actions.len() as i32)
    }

    fn InvokeCommand(&self, pici: *const CMINVOKECOMMANDINFO) -> WindowsResult<()> {
        if pici.is_null() {
            return Err(Error::from_hresult(E_INVALIDARG));
        }

        let command = unsafe { &*pici };
        let index = self.classic_command_index(command).ok_or_else(|| Error::from_hresult(E_INVALIDARG))?;
        let action = self.classic_actions.borrow().get(index).copied().ok_or_else(|| Error::from_hresult(E_INVALIDARG))?;
        let paths = self.classic_paths.borrow().clone();
        if !action.supports_paths(&paths) {
            return Err(Error::from_hresult(E_INVALIDARG));
        }

        handoff_to_zmanager(action.shell_action(), paths).map_err(|error| Error::new(E_FAIL, error.to_string()))
    }

    fn GetCommandString(&self, idcmd: usize, utype: u32, _preserved: *const u32, pszname: PSTR, cchmax: u32) -> WindowsResult<()> {
        let action = self.classic_actions.borrow().get(idcmd).copied();

        // The ANSI and wide request types differ only by GCS_UNICODE.
        if utype | GCS_UNICODE == GCS_VALIDATEW {
            return if action.is_some() { Ok(()) } else { Err(Error::from_hresult(S_FALSE)) };
        }

        let action = action.ok_or_else(|| Error::from_hresult(E_INVALIDARG))?;
        if cchmax == 0 || !matches!(utype | GCS_UNICODE, GCS_VERBW | GCS_HELPTEXTW) {
            return Err(Error::from_hresult(E_INVALIDARG));
        }

        write_command_string(pszname, cchmax, &classic_verb(action), utype & GCS_UNICODE != 0);
        Ok(())
    }
}

impl ZManagerRootExplorerCommand_Impl {
    /// Build the `ZManager` popup and hang it off Explorer's menu. Returns
    /// false when the shell refuses an insertion, matching 7-Zip's bail-out.
    fn insert_classic_menu(&self, hmenu: HMENU, indexmenu: u32, idcmdfirst: u32, actions: &[ExplorerAction], paths: &[String]) -> bool {
        let Ok(popup) = (unsafe { CreatePopupMenu() }) else {
            return false;
        };

        for (index, action) in actions.iter().enumerate() {
            let title = classic_menu_title(*action, paths);
            let command_id = idcmdfirst as usize + index;
            if unsafe { AppendMenuW(popup, MF_STRING, command_id, PCWSTR(title.as_ptr())) }.is_err() {
                let _ = unsafe { DestroyMenu(popup) };
                return false;
            }
        }

        // The popup itself carries no command identifier, so it does not count
        // toward the number QueryContextMenu reports.
        if unsafe { InsertMenuW(hmenu, indexmenu, MF_BYPOSITION | MF_POPUP, popup.0 as usize, w!("ZManager")) }.is_err() {
            let _ = unsafe { DestroyMenu(popup) };
            return false;
        }

        true
    }
}

fn classic_verb(action: ExplorerAction) -> String {
    format!("{CLASSIC_VERB_PREFIX}{}", action.native_verb())
}

/// The classic menu is drawn once, so the extract-to-folder entry has to name
/// its destination up front the way `IExplorerCommand::GetTitle` does.
fn classic_menu_title(action: ExplorerAction, paths: &[String]) -> Vec<u16> {
    if action == ExplorerAction::ExtractToFolder && paths.len() == 1 {
        let folder_name = base_name_without_archive_extension(&paths[0]);
        return format!("Extract to \"{folder_name}\"\0").encode_utf16().collect();
    }

    let title = unsafe { action.title().to_string() }.unwrap_or_default();
    format!("{title}\0").encode_utf16().collect()
}

fn write_command_string(buffer: PSTR, capacity: u32, text: &str, unicode: bool) {
    if buffer.is_null() {
        return;
    }

    let capacity = capacity as usize;
    if unicode {
        let mut wide: Vec<u16> = text.encode_utf16().take(capacity - 1).collect();
        wide.push(0);
        unsafe { std::ptr::copy_nonoverlapping(wide.as_ptr(), buffer.0.cast::<u16>(), wide.len()) };
    } else {
        let mut narrow: Vec<u8> = text.bytes().take(capacity - 1).collect();
        narrow.push(0);
        unsafe { std::ptr::copy_nonoverlapping(narrow.as_ptr(), buffer.0, narrow.len()) };
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
        // Virtual items (search results, library roots) have no filesystem
        // path. 7-Zip's CF_HDROP selection simply omits them, so we do too
        // instead of failing the whole selection.
        let Ok(display_name) = (unsafe { item.GetDisplayName(SIGDN_FILESYSPATH) }) else {
            continue;
        };
        let path = unsafe { display_name.to_string() };
        unsafe { CoTaskMemFree(Some(display_name.0.cast())) };
        let Ok(path) = path else {
            continue;
        };
        let comparison_key = path.to_lowercase();
        if seen.insert(comparison_key) {
            paths.push(path);
        }
    }

    Ok(paths)
}

fn is_supported_archive_file(path: &str) -> bool {
    let candidate = Path::new(path);
    candidate.is_file() && SUPPORTED_ARCHIVE_SUFFIXES.iter().any(|suffix| path.to_ascii_lowercase().ends_with(suffix))
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
        UI::Shell::{BHID_DataObject, CMF_DEFAULTONLY, Common::ITEMIDLIST, SHCreateShellItemArrayFromIDLists, SHParseDisplayName},
    };
    use windows::core::PCSTR;

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

    #[test]
    fn classic_invoke_reads_the_command_offset_explorer_passes() {
        let handler = ZManagerRootExplorerCommand::new(ExplorerRoot::Create);
        *handler.classic_actions.borrow_mut() = CREATE_EXPLORER_ACTIONS.to_vec();
        let mut command = CMINVOKECOMMANDINFO { cbSize: size_of::<CMINVOKECOMMANDINFO>() as u32, ..Default::default() };

        // Explorer packs the offset as an integer resource, and that offset is
        // already relative to the idCmdFirst it passed to QueryContextMenu.
        command.lpVerb = PCSTR(3 as *const u8);
        assert_eq!(handler.classic_command_index(&command), Some(3));

        // The canonical verb string selects the same command.
        let verb = format!("{}\0", classic_verb(CREATE_EXPLORER_ACTIONS[3]));
        command.lpVerb = PCSTR(verb.as_ptr());
        assert_eq!(handler.classic_command_index(&command), Some(3));

        let unknown = c"ZManager.NoSuchAction";
        command.lpVerb = PCSTR(unknown.as_ptr().cast());
        assert_eq!(handler.classic_command_index(&command), None);
    }

    #[test]
    fn classic_handler_claims_one_command_id_per_supported_action() {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok() }.expect("COM apartment should initialize");
        let directory = std::env::temp_dir().join(format!("zmanager-shell-classic-menu-test-{}", REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)));
        let folder1 = directory.join("folder1");
        let folder2 = directory.join("folder2");
        fs::create_dir_all(&folder1).expect("first folder should be created");
        fs::create_dir_all(&folder2).expect("second folder should be created");

        let selection = shell_item_array(&[&folder1, &folder2]);
        let data_object: IDataObject = unsafe { selection.BindToHandler(None, &BHID_DataObject) }.expect("selection should expose a data object");

        let handler: IContextMenu = ZManagerRootExplorerCommand::new(ExplorerRoot::Create).into();
        let initializer: IShellExtInit = handler.cast().expect("handler should expose IShellExtInit");
        unsafe { initializer.Initialize(None, &data_object, None) }.expect("handler should accept Explorer's selection");

        // Two folders: every create action applies except the single-target
        // Share on LAN entry.
        let expected: Vec<ExplorerAction> = CREATE_EXPLORER_ACTIONS.iter().copied().filter(|action| *action != ExplorerAction::ShareOnLan).collect();

        const FIRST_COMMAND_ID: u32 = 0x1000;
        let claimed = unsafe { handler.QueryContextMenu(HMENU::default(), 0, FIRST_COMMAND_ID, FIRST_COMMAND_ID + 0xFF, CMF_NORMAL) };
        assert_eq!(claimed.0, expected.len() as i32);

        // Command strings are addressed by the same zero-based offset, whatever
        // identifier range Explorer handed out.
        for (offset, action) in expected.iter().enumerate() {
            let mut buffer = [0u16; 128];
            unsafe { handler.GetCommandString(offset, GCS_VERBW, None, PSTR(buffer.as_mut_ptr().cast()), buffer.len() as u32) }
                .expect("every claimed offset should resolve to a verb");
            let verb = String::from_utf16_lossy(&buffer);
            assert_eq!(verb.trim_end_matches('\0'), classic_verb(*action));
        }
        // GCS_VALIDATE answers with S_FALSE rather than an error, so read the
        // raw result instead of the Result wrapper that treats it as success.
        let validate = |offset: usize| unsafe {
            (Interface::vtable(&handler).GetCommandString)(Interface::as_raw(&handler), offset, GCS_VALIDATEW, std::ptr::null(), PSTR::null(), 0)
        };
        assert_eq!(validate(expected.len() - 1), S_OK);
        assert_eq!(validate(expected.len()), S_FALSE);

        // Menus that only want the default verb get nothing.
        assert_eq!(unsafe { handler.QueryContextMenu(HMENU::default(), 0, FIRST_COMMAND_ID, FIRST_COMMAND_ID + 0xFF, CMF_DEFAULTONLY) }.0, 0);

        drop(data_object);
        drop(selection);
        let _ = fs::remove_dir_all(directory);
        unsafe { CoUninitialize() };
    }

    #[test]
    fn classic_handler_offers_extraction_when_every_selected_file_is_an_archive() {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok() }.expect("COM apartment should initialize");
        let directory = std::env::temp_dir().join(format!("zmanager-shell-classic-archive-test-{}", REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&directory).expect("test directory should be created");
        let archive = directory.join("bundle.zip");
        fs::write(&archive, b"not really a zip").expect("archive fixture should be written");
        let plain = directory.join("notes.txt");
        fs::write(&plain, b"plain").expect("text fixture should be written");

        let handler = ZManagerRootExplorerCommand::new(ExplorerRoot::Create);
        let archive_path = archive.to_string_lossy().into_owned();
        let plain_path = plain.to_string_lossy().into_owned();

        let archive_actions = handler.classic_actions_for_paths(std::slice::from_ref(&archive_path));
        assert_eq!(archive_actions.first(), Some(&ExplorerAction::ExtractHere));
        assert!(archive_actions.contains(&ExplorerAction::ExtractToFolder));
        assert!(archive_actions.contains(&ExplorerAction::Open));
        assert!(archive_actions.contains(&ExplorerAction::Compress));

        // One non-archive in the selection drops the extraction actions.
        let mixed_actions = handler.classic_actions_for_paths(&[archive_path, plain_path]);
        assert!(!mixed_actions.contains(&ExplorerAction::ExtractHere));
        assert!(!mixed_actions.contains(&ExplorerAction::Open));
        assert!(mixed_actions.contains(&ExplorerAction::Compress));

        assert!(handler.classic_actions_for_paths(&[]).is_empty());

        let _ = fs::remove_dir_all(directory);
        unsafe { CoUninitialize() };
    }

    #[test]
    fn classic_menu_titles_match_the_explorer_command_titles() {
        let archive = std::env::temp_dir().join("quarterly-report.tar.gz").to_string_lossy().into_owned();
        let title = String::from_utf16_lossy(&classic_menu_title(ExplorerAction::ExtractToFolder, std::slice::from_ref(&archive)));
        assert_eq!(title.trim_end_matches('\0'), "Extract to \"quarterly-report\"");

        // With more than one archive selected there is no single destination to
        // name, so the entry keeps its generic label.
        let generic = String::from_utf16_lossy(&classic_menu_title(ExplorerAction::ExtractToFolder, &[archive.clone(), archive]));
        assert_eq!(generic.trim_end_matches('\0'), "Extract to Archive Folder");

        let compress = String::from_utf16_lossy(&classic_menu_title(ExplorerAction::CompressZip, &[]));
        assert_eq!(compress.trim_end_matches('\0'), "Add to .zip");
    }

    #[test]
    fn command_strings_are_written_as_the_caller_asked() {
        let mut wide = [0u16; 8];
        write_command_string(PSTR(wide.as_mut_ptr().cast()), wide.len() as u32, "ZManager.Open", true);
        assert_eq!(String::from_utf16_lossy(&wide).trim_end_matches('\0'), "ZManage");

        let mut narrow = [0u8; 8];
        write_command_string(PSTR(narrow.as_mut_ptr()), narrow.len() as u32, "ZManager.Open", false);
        assert_eq!(String::from_utf8_lossy(&narrow).trim_end_matches('\0'), "ZManage");
    }
}
