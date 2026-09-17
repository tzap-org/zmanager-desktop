use std::{
    ffi::OsStr,
    mem::{ManuallyDrop, size_of},
    os::windows::ffi::OsStrExt,
    ptr::null_mut,
    slice,
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use tauri::Wry;
use windows_sys::Win32::{
    Graphics::Gdi::{
        BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, CreateDIBSection, DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, HBRUSH, HGDIOBJ, ReleaseDC,
        SelectObject,
    },
    Storage::FileSystem::{FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL},
    UI::{
        Shell::{SHFILEINFOW, SHGFI_ICON, SHGFI_USEFILEATTRIBUTES, SHGetFileInfoW},
        WindowsAndMessaging::{DI_NORMAL, DestroyIcon, DrawIconEx, HICON},
    },
};

use super::windows_drag_path::prepare_windows_drag_items;
use super::{
    CapabilityInspector, DefaultHandlerController, DefaultHandlerEntry, DefaultHandlerRequest, DiagnosticLogPolicy, MainWindowConfigurator,
    NativeCapabilityOperationError, NativeFileDragAdapter, NativeFileDragCandidate, NativeFileDragError, NativeFileDragItem, NativeFileDragOutcome,
    NativeFileDragStart, NativeFileDragStreamProvider, SecureFileProtector, SystemFileIconProvider,
};
use crate::dto::{SystemFileIconDto, SystemFileIconRequestEntry};

pub struct WindowsPlatform;

impl DiagnosticLogPolicy for WindowsPlatform {
    fn prefer_user_log_directory() -> bool {
        false
    }
}

impl CapabilityInspector for WindowsPlatform {
    fn capability_observations()
    -> std::collections::HashMap<crate::native_integration::NativeCapabilityId, crate::native_integration::NativeCapabilityObservation> {
        use crate::native_integration::{NativeCapabilityId, NativeCapabilityObservation, NativeCapabilityPackageState, NativeCapabilityRuntimeState};
        [NativeCapabilityId::ShellSelectedItemActions, NativeCapabilityId::ShellBackgroundActions]
            .into_iter()
            .map(|id| {
                (
                    id,
                    NativeCapabilityObservation {
                        package_state: Some(NativeCapabilityPackageState::Included),
                        runtime_state: Some(NativeCapabilityRuntimeState::Ready),
                        ..NativeCapabilityObservation::default()
                    },
                )
            })
            .collect()
    }
}

impl MainWindowConfigurator for WindowsPlatform {
    fn configure_main_window(window: &tauri::WebviewWindow<Wry>) -> Result<(), tauri::Error> {
        window.set_decorations(true)
    }
}

impl SystemFileIconProvider for WindowsPlatform {
    fn system_file_icons(entries: &[SystemFileIconRequestEntry]) -> Vec<SystemFileIconDto> {
        entries.iter().map(|entry| SystemFileIconDto { key: entry.key.clone(), data_url: system_file_icon_data_url(entry) }).collect()
    }
}

impl DefaultHandlerController for WindowsPlatform {
    fn default_handlers(_request: &DefaultHandlerRequest) -> Result<Vec<DefaultHandlerEntry>, NativeCapabilityOperationError> {
        Err(NativeCapabilityOperationError::not_applicable("defaultHandlerControl"))
    }
}

impl SecureFileProtector for WindowsPlatform {
    fn set_owner_only_file_permissions(_file: &std::fs::File) -> Result<(), NativeCapabilityOperationError> {
        Err(NativeCapabilityOperationError::unavailable("secureLocalFileProtection", "aclImplementationUnavailable"))
    }
}

impl NativeFileDragAdapter for WindowsPlatform {
    fn prepare_native_file_drag(candidates: &[NativeFileDragCandidate], strip_components: usize) -> Result<Vec<NativeFileDragItem>, NativeFileDragError> {
        prepare_windows_drag_items(candidates, strip_components)
    }

    fn start_native_file_drag(
        _window: &tauri::WebviewWindow<Wry>,
        items: &[NativeFileDragItem],
        stream_provider: NativeFileDragStreamProvider,
        _registry: &crate::native_drag_session::NativeDragSessionRegistry,
        _cancellation: zmanager_core::jobs::CancellationToken,
        _job_id: &str,
        _job_kind: crate::job_dto::JobKindDto,
        _job_registry: &crate::job_registry::JobRegistry,
    ) -> Result<NativeFileDragStart, NativeFileDragError> {
        if items.is_empty() {
            return Err(NativeFileDragError::new("No archive files are available to drag.", None::<String>));
        }

        Ok(NativeFileDragStart::Settled { outcome: windows_file_drag::start_drag(items, stream_provider)? })
    }
}

fn system_file_icon_data_url(entry: &SystemFileIconRequestEntry) -> Option<String> {
    let lookup_path = if entry.is_directory { "folder" } else { entry.path.trim() };
    let lookup_path = if lookup_path.is_empty() { "file" } else { lookup_path };

    let wide_path = wide_null(lookup_path);
    let attributes = if entry.is_directory { FILE_ATTRIBUTE_DIRECTORY } else { FILE_ATTRIBUTE_NORMAL };
    let mut file_info = SHFILEINFOW::default();
    let result =
        unsafe { SHGetFileInfoW(wide_path.as_ptr(), attributes, &mut file_info, size_of::<SHFILEINFOW>() as u32, SHGFI_ICON | SHGFI_USEFILEATTRIBUTES) };

    if result == 0 || file_info.hIcon.is_null() {
        return None;
    }

    let data_url = unsafe { hicon_to_png_data_url(file_info.hIcon) };
    unsafe {
        DestroyIcon(file_info.hIcon);
    }
    data_url
}

#[cfg(test)]
mod system_file_icon_tests {
    use std::io::Cursor;

    use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};

    use super::{reconstruct_rgba_from_composites, system_file_icon_data_url};
    use crate::dto::SystemFileIconRequestEntry;

    #[test]
    fn returns_the_windows_shell_icon_for_an_unknown_extension() {
        let icon = system_file_icon_data_url(&SystemFileIconRequestEntry {
            key: "file:.zmanager-unknown".to_string(),
            path: ".zmanager-unknown".to_string(),
            is_directory: false,
        });

        let data_url = icon.expect("Windows should return its generic shell icon");
        let encoded = data_url.strip_prefix("data:image/png;base64,").expect("system icon should be a PNG data URL");
        let png_bytes = BASE64_STANDARD.decode(encoded).expect("decode system icon PNG");
        let decoder = png::Decoder::new(Cursor::new(png_bytes));
        let reader = decoder.read_info().expect("read system icon PNG");

        assert_eq!((reader.info().width, reader.info().height), (32, 32));
    }

    #[test]
    fn reconstructs_transparent_opaque_and_partially_transparent_pixels() {
        let black = [
            0, 0, 0, 255, // transparent
            0, 0, 0, 255, // opaque black
            30, 20, 10, 255, // opaque RGB(10, 20, 30)
            0, 0, 128, 255, // 50% red
        ];
        let white = [255, 255, 255, 255, 0, 0, 0, 255, 30, 20, 10, 255, 127, 127, 255, 255];

        assert_eq!(reconstruct_rgba_from_composites(&black, &white), Some(vec![0, 0, 0, 0, 0, 0, 0, 255, 10, 20, 30, 255, 255, 0, 0, 128,]));
    }

    #[test]
    fn preserves_opaque_black_right_and_bottom_edges() {
        // A 2x2 icon with a transparent top-left pixel and an opaque black
        // right/bottom border exercises the strokes that previously vanished.
        let black = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];
        let white = [255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];

        assert_eq!(reconstruct_rgba_from_composites(&black, &white), Some(vec![0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,]));
    }

    #[test]
    fn rejects_mismatched_or_incomplete_composite_buffers() {
        assert_eq!(reconstruct_rgba_from_composites(&[0; 4], &[0; 8]), None);
        assert_eq!(reconstruct_rgba_from_composites(&[0; 3], &[0; 3]), None);
    }
}

unsafe fn hicon_to_png_data_url(icon: HICON) -> Option<String> {
    const ICON_SIZE: i32 = 32;

    let black_composite = unsafe { draw_hicon_bgra(icon, ICON_SIZE, [0, 0, 0]) }?;
    let white_composite = unsafe { draw_hicon_bgra(icon, ICON_SIZE, [255, 255, 255]) }?;
    let rgba = reconstruct_rgba_from_composites(&black_composite, &white_composite)?;
    encode_rgba_png_data_url(&rgba, ICON_SIZE as u32, ICON_SIZE as u32)
}

unsafe fn draw_hicon_bgra(icon: HICON, icon_size: i32, background_bgr: [u8; 3]) -> Option<Vec<u8>> {
    const BYTES_PER_PIXEL: usize = 4;

    let screen_dc = unsafe { GetDC(null_mut()) };
    if screen_dc.is_null() {
        return None;
    }

    let memory_dc = unsafe { CreateCompatibleDC(screen_dc) };
    if memory_dc.is_null() {
        unsafe {
            ReleaseDC(null_mut(), screen_dc);
        }
        return None;
    }

    let bitmap_info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: icon_size,
            biHeight: -icon_size,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            biSizeImage: (icon_size * icon_size * BYTES_PER_PIXEL as i32) as u32,
            ..BITMAPINFOHEADER::default()
        },
        ..BITMAPINFO::default()
    };
    let mut bits = null_mut();
    let bitmap = unsafe { CreateDIBSection(screen_dc, &bitmap_info, DIB_RGB_COLORS, &mut bits, null_mut(), 0) };

    if bitmap.is_null() || bits.is_null() {
        unsafe {
            DeleteDC(memory_dc);
            ReleaseDC(null_mut(), screen_dc);
        }
        return None;
    }

    let previous_object = unsafe { SelectObject(memory_dc, bitmap as HGDIOBJ) };
    let pixel_count = icon_size as usize * icon_size as usize;
    let bgra = unsafe { slice::from_raw_parts_mut(bits as *mut u8, pixel_count * BYTES_PER_PIXEL) };
    for pixel in bgra.chunks_exact_mut(BYTES_PER_PIXEL) {
        pixel.copy_from_slice(&[background_bgr[0], background_bgr[1], background_bgr[2], u8::MAX]);
    }

    let drawn = unsafe { DrawIconEx(memory_dc, 0, 0, icon, icon_size, icon_size, 0, null_mut::<HBRUSH__>() as HBRUSH, DI_NORMAL) } != 0;

    let rendered = drawn.then(|| bgra.to_vec());

    if !previous_object.is_null() {
        unsafe {
            SelectObject(memory_dc, previous_object);
        }
    }
    unsafe {
        DeleteObject(bitmap as HGDIOBJ);
        DeleteDC(memory_dc);
        ReleaseDC(null_mut(), screen_dc);
    }

    rendered
}

fn reconstruct_rgba_from_composites(black: &[u8], white: &[u8]) -> Option<Vec<u8>> {
    if black.len() != white.len() || !black.len().is_multiple_of(4) {
        return None;
    }

    let mut rgba = Vec::with_capacity(black.len());
    for (black_pixel, white_pixel) in black.chunks_exact(4).zip(white.chunks_exact(4)) {
        let transparency = (0..3).map(|channel| white_pixel[channel].saturating_sub(black_pixel[channel]) as u16).sum::<u16>().div_ceil(3) as u8;
        let alpha = u8::MAX - transparency;

        for channel in [2, 1, 0] {
            let color =
                if alpha == 0 { 0 } else { ((black_pixel[channel] as u32 * u8::MAX as u32 + alpha as u32 / 2) / alpha as u32).min(u8::MAX as u32) as u8 };
            rgba.push(color);
        }
        rgba.push(alpha);
    }

    Some(rgba)
}

fn encode_rgba_png_data_url(rgba: &[u8], width: u32, height: u32) -> Option<String> {
    if rgba.len() != width as usize * height as usize * 4 {
        return None;
    }

    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
    }

    Some(format!("data:image/png;base64,{}", BASE64_STANDARD.encode(png_bytes)))
}

fn wide_null(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

type HBRUSH__ = core::ffi::c_void;

mod windows_file_drag {
    use std::io::{self, Write};

    use super::*;

    use ::windows::{
        Win32::{
            Foundation::{
                DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS, DV_E_FORMATETC, DV_E_LINDEX, DV_E_TYMED, E_FAIL, E_NOTIMPL, FILETIME,
                OLE_E_ADVISENOTSUPPORTED, S_OK,
            },
            System::{
                Com::StructuredStorage::CreateStreamOnHGlobal,
                Com::{
                    DATADIR_GET, DVASPECT_CONTENT, FORMATETC, IAdviseSink, IDataObject, IDataObject_Impl, IEnumFORMATETC, IEnumSTATDATA, IStream, STGMEDIUM,
                    STGMEDIUM_0, STREAM_SEEK_SET, TYMED_HGLOBAL, TYMED_ISTREAM,
                },
                Memory::{GMEM_MOVEABLE, GMEM_ZEROINIT, GlobalAlloc, GlobalLock, GlobalUnlock},
                Ole::{DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE, DoDragDrop, IDropSource, IDropSource_Impl, OleInitialize, OleUninitialize},
                SystemServices::{MK_LBUTTON, MODIFIERKEYS_FLAGS},
            },
            UI::Shell::{FD_ATTRIBUTES, FD_FILESIZE, FD_WRITESTIME, FILEDESCRIPTORW, SHCreateStdEnumFmtEtc},
        },
        core::{BOOL, Error as WindowsError, HRESULT, Ref, Result as WindowsResult, implement},
    };
    use windows_sys::Win32::{
        System::DataExchange::RegisterClipboardFormatW,
        UI::Shell::{CFSTR_FILECONTENTS, CFSTR_FILEDESCRIPTORW},
    };

    const WINDOWS_TICK: u64 = 10_000_000;
    const UNIX_EPOCH_AS_WINDOWS_FILETIME_SECONDS: u64 = 11_644_473_600;

    pub fn start_drag(items: &[NativeFileDragItem], stream_provider: NativeFileDragStreamProvider) -> Result<NativeFileDragOutcome, NativeFileDragError> {
        let _ole = OleApartment::initialize()?;
        let data_object: IDataObject = VirtualFileDragDataObject { items: items.to_vec(), stream_provider }.into();
        let drop_source: IDropSource = FileDropSource.into();
        let mut effect = DROPEFFECT(0);
        let result = unsafe { DoDragDrop(&data_object, &drop_source, DROPEFFECT_COPY, &mut effect as *mut DROPEFFECT) };

        if result == DRAGDROP_S_CANCEL {
            return Ok(NativeFileDragOutcome::Cancelled);
        }
        if result.is_err() {
            return Err(NativeFileDragError::new(
                format!("Windows native drag failed: 0x{:08X}", result.0 as u32),
                Some("Try extracting normally while native drag-out is being checked."),
            ));
        }

        if result == DRAGDROP_S_DROP && effect != DROPEFFECT_NONE { Ok(NativeFileDragOutcome::Dropped) } else { Ok(NativeFileDragOutcome::NoDrop) }
    }

    struct OleApartment;

    impl OleApartment {
        fn initialize() -> Result<Self, NativeFileDragError> {
            unsafe { OleInitialize(None) }.map_err(|error| {
                NativeFileDragError::new(format!("Unable to initialize Windows OLE drag/drop: {error}"), Some("Restart ZManager and try the drag again."))
            })?;
            Ok(Self)
        }
    }

    impl Drop for OleApartment {
        fn drop(&mut self) {
            unsafe {
                OleUninitialize();
            }
        }
    }

    #[implement(IDataObject)]
    struct VirtualFileDragDataObject {
        items: Vec<NativeFileDragItem>,
        stream_provider: NativeFileDragStreamProvider,
    }

    impl IDataObject_Impl for VirtualFileDragDataObject_Impl {
        fn GetData(&self, pformatetcin: *const FORMATETC) -> WindowsResult<STGMEDIUM> {
            let format = unsafe { pformatetcin.as_ref() }.ok_or_else(|| WindowsError::from_hresult(DV_E_FORMATETC))?;

            if is_file_descriptor_format(format) {
                return file_group_descriptor_medium(&self.items);
            }
            if is_file_contents_format(format) {
                let index = item_index(format, self.items.len())?;
                return file_contents_medium(&self.items[index], &self.stream_provider);
            }

            Err(WindowsError::from_hresult(DV_E_FORMATETC))
        }

        fn GetDataHere(&self, _pformatetc: *const FORMATETC, _pmedium: *mut STGMEDIUM) -> WindowsResult<()> {
            Err(WindowsError::from_hresult(E_NOTIMPL))
        }

        fn QueryGetData(&self, pformatetc: *const FORMATETC) -> HRESULT {
            let Some(format) = (unsafe { pformatetc.as_ref() }) else {
                return DV_E_FORMATETC;
            };

            if is_file_descriptor_format(format) {
                return S_OK;
            }
            if format.cfFormat == file_contents_format() {
                if (format.tymed & TYMED_ISTREAM.0 as u32) == 0 {
                    return DV_E_TYMED;
                }
                if format.lindex == -1 {
                    return S_OK;
                }
                if format.lindex < 0 || format.lindex as usize >= self.items.len() {
                    return DV_E_LINDEX;
                }
                return S_OK;
            }

            DV_E_FORMATETC
        }

        fn GetCanonicalFormatEtc(&self, _pformatectin: *const FORMATETC, pformatetcout: *mut FORMATETC) -> HRESULT {
            if let Some(output) = unsafe { pformatetcout.as_mut() } {
                output.ptd = null_mut();
            }
            E_NOTIMPL
        }

        fn SetData(&self, _pformatetc: *const FORMATETC, _pmedium: *const STGMEDIUM, _frelease: BOOL) -> WindowsResult<()> {
            Err(WindowsError::from_hresult(E_NOTIMPL))
        }

        fn EnumFormatEtc(&self, dwdirection: u32) -> WindowsResult<IEnumFORMATETC> {
            if dwdirection != DATADIR_GET.0 as u32 {
                return Err(WindowsError::from_hresult(E_NOTIMPL));
            }

            unsafe { SHCreateStdEnumFmtEtc(&[file_descriptor_format(), file_contents_formatetc()]) }
        }

        fn DAdvise(&self, _pformatetc: *const FORMATETC, _advf: u32, _padvsink: Ref<'_, IAdviseSink>) -> WindowsResult<u32> {
            Err(WindowsError::from_hresult(OLE_E_ADVISENOTSUPPORTED))
        }

        fn DUnadvise(&self, _dwconnection: u32) -> WindowsResult<()> {
            Err(WindowsError::from_hresult(OLE_E_ADVISENOTSUPPORTED))
        }

        fn EnumDAdvise(&self) -> WindowsResult<IEnumSTATDATA> {
            Err(WindowsError::from_hresult(OLE_E_ADVISENOTSUPPORTED))
        }
    }

    #[implement(IDropSource)]
    struct FileDropSource;

    impl IDropSource_Impl for FileDropSource_Impl {
        fn QueryContinueDrag(&self, fescapepressed: BOOL, grfkeystate: MODIFIERKEYS_FLAGS) -> HRESULT {
            if fescapepressed.as_bool() {
                return DRAGDROP_S_CANCEL;
            }

            if (grfkeystate & MK_LBUTTON).0 == 0 {
                return DRAGDROP_S_DROP;
            }

            S_OK
        }

        fn GiveFeedback(&self, _dweffect: DROPEFFECT) -> HRESULT {
            DRAGDROP_S_USEDEFAULTCURSORS
        }
    }

    fn file_descriptor_format() -> FORMATETC {
        FORMATETC { cfFormat: file_descriptor_clipboard_format(), ptd: null_mut(), dwAspect: DVASPECT_CONTENT.0, lindex: -1, tymed: TYMED_HGLOBAL.0 as u32 }
    }

    fn file_contents_formatetc() -> FORMATETC {
        FORMATETC { cfFormat: file_contents_format(), ptd: null_mut(), dwAspect: DVASPECT_CONTENT.0, lindex: -1, tymed: TYMED_ISTREAM.0 as u32 }
    }

    fn is_file_descriptor_format(format: &FORMATETC) -> bool {
        format.cfFormat == file_descriptor_clipboard_format() && format.dwAspect == DVASPECT_CONTENT.0 && (format.tymed & TYMED_HGLOBAL.0 as u32) != 0
    }

    fn is_file_contents_format(format: &FORMATETC) -> bool {
        format.cfFormat == file_contents_format() && format.dwAspect == DVASPECT_CONTENT.0 && (format.tymed & TYMED_ISTREAM.0 as u32) != 0
    }

    fn item_index(format: &FORMATETC, item_count: usize) -> WindowsResult<usize> {
        if format.lindex < 0 {
            return Err(WindowsError::from_hresult(DV_E_LINDEX));
        }
        let index = format.lindex as usize;
        if index >= item_count {
            return Err(WindowsError::from_hresult(DV_E_LINDEX));
        }
        Ok(index)
    }

    fn file_descriptor_clipboard_format() -> u16 {
        unsafe { RegisterClipboardFormatW(CFSTR_FILEDESCRIPTORW) as u16 }
    }

    fn file_contents_format() -> u16 {
        unsafe { RegisterClipboardFormatW(CFSTR_FILECONTENTS) as u16 }
    }

    fn file_group_descriptor_medium(items: &[NativeFileDragItem]) -> WindowsResult<STGMEDIUM> {
        let descriptor_size = size_of::<FILEDESCRIPTORW>();
        let header_size = size_of::<u32>();
        let allocation_size = header_size + descriptor_size * items.len();

        let hglobal = unsafe { GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, allocation_size)? };
        let locked = unsafe { GlobalLock(hglobal) };
        if locked.is_null() {
            return Err(WindowsError::from_win32());
        }

        unsafe {
            (locked as *mut u32).write(items.len() as u32);
            let descriptors = (locked as *mut u8).add(header_size) as *mut FILEDESCRIPTORW;
            for (index, item) in items.iter().enumerate() {
                descriptors.add(index).write(file_descriptor(item));
            }
            let _ = GlobalUnlock(hglobal);
        }

        Ok(STGMEDIUM { tymed: TYMED_HGLOBAL.0 as u32, u: STGMEDIUM_0 { hGlobal: hglobal }, pUnkForRelease: ManuallyDrop::new(None) })
    }

    fn file_descriptor(item: &NativeFileDragItem) -> FILEDESCRIPTORW {
        let name = wide_drag_file_name(&item.display_path);
        let mut file_name = [0u16; 260];
        let copy_len = name.len().min(file_name.len().saturating_sub(1));
        file_name[..copy_len].copy_from_slice(&name[..copy_len]);

        let mut descriptor =
            FILEDESCRIPTORW { dwFlags: FD_ATTRIBUTES.0 as u32, dwFileAttributes: FILE_ATTRIBUTE_NORMAL, cFileName: file_name, ..FILEDESCRIPTORW::default() };

        if let Some(size) = item.size {
            descriptor.dwFlags |= FD_FILESIZE.0 as u32;
            descriptor.nFileSizeHigh = (size >> 32) as u32;
            descriptor.nFileSizeLow = (size & 0xFFFF_FFFF) as u32;
        }
        if let Some(modified) = item.modified_unix_seconds {
            descriptor.dwFlags |= FD_WRITESTIME.0 as u32;
            descriptor.ftLastWriteTime = filetime_from_unix_seconds(modified);
        }

        descriptor
    }

    fn filetime_from_unix_seconds(seconds: u64) -> FILETIME {
        let ticks = seconds.saturating_add(UNIX_EPOCH_AS_WINDOWS_FILETIME_SECONDS).saturating_mul(WINDOWS_TICK);
        FILETIME { dwLowDateTime: ticks as u32, dwHighDateTime: (ticks >> 32) as u32 }
    }

    fn wide_drag_file_name(path: &str) -> Vec<u16> {
        path.encode_utf16().filter(|value| *value != 0).collect()
    }

    fn file_contents_medium(item: &NativeFileDragItem, stream_provider: &NativeFileDragStreamProvider) -> WindowsResult<STGMEDIUM> {
        let stream = unsafe { CreateStreamOnHGlobal(Default::default(), true)? };
        {
            let mut writer = ComStreamWriter { stream: stream.clone() };
            (stream_provider)(&item.entry_path, &mut writer).map_err(|_| WindowsError::from_hresult(E_FAIL))?;
            writer.flush().map_err(|_| WindowsError::from_hresult(E_FAIL))?;
        }
        unsafe {
            stream.Seek(0, STREAM_SEEK_SET, None).map_err(|_| WindowsError::from_hresult(E_FAIL))?;
        }

        Ok(STGMEDIUM { tymed: TYMED_ISTREAM.0 as u32, u: STGMEDIUM_0 { pstm: ManuallyDrop::new(Some(stream)) }, pUnkForRelease: ManuallyDrop::new(None) })
    }

    struct ComStreamWriter {
        stream: IStream,
    }

    impl Write for ComStreamWriter {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            let chunk_len = buffer.len().min(u32::MAX as usize);
            if chunk_len == 0 {
                return Ok(0);
            }

            let mut written = 0u32;
            let result = unsafe { self.stream.Write(buffer.as_ptr().cast(), chunk_len as u32, Some(&mut written as *mut u32)) };
            if result.is_err() {
                return Err(io::Error::other(format!("COM stream write failed: 0x{:08X}", result.0 as u32)));
            }
            Ok(written as usize)
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[cfg(test)]
    mod tests {
        use std::{
            collections::HashMap,
            fs,
            path::{Path, PathBuf},
            sync::Arc,
            thread,
            time::{Duration, SystemTime, UNIX_EPOCH},
        };

        use super::*;
        use ::windows::{
            Win32::{
                Foundation::POINTL,
                System::{
                    Com::IBindCtx,
                    Ole::{DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE, IDropTarget},
                    SystemServices::MODIFIERKEYS_FLAGS,
                },
                UI::Shell::{BHID_SFUIObject, IShellItem, SHCreateItemFromParsingName},
            },
            core::PCWSTR,
        };

        const KEEP_VIRTUAL_DROP_PROOF_DIR_ENV: &str = "ZMANAGER_KEEP_VIRTUAL_DROP_PROOF_DIR";

        fn drag_item(display_path: &str, size: Option<u64>, modified_unix_seconds: Option<u64>) -> NativeFileDragItem {
            NativeFileDragItem { entry_path: display_path.replace('\\', "/"), display_path: display_path.to_string(), size, modified_unix_seconds }
        }

        #[test]
        fn file_descriptor_preserves_utf16_name_large_size_and_timestamp() {
            let size = 0x1234_5678_9ABC_DEF0;
            let modified = 1_700_000_000;
            let descriptor = file_descriptor(&drag_item("folder\\資料📦.txt", Some(size), Some(modified)));
            let c_file_name = descriptor.cFileName;
            let name_end = c_file_name.iter().position(|value| *value == 0).expect("descriptor file name terminator");

            assert_eq!(String::from_utf16(&c_file_name[..name_end]).expect("UTF-16 file name"), "folder\\資料📦.txt");
            let dw_file_attributes = descriptor.dwFileAttributes;
            assert_eq!(dw_file_attributes, FILE_ATTRIBUTE_NORMAL);
            let dw_flags = descriptor.dwFlags;
            assert_ne!(dw_flags & FD_ATTRIBUTES.0 as u32, 0);
            assert_ne!(dw_flags & FD_FILESIZE.0 as u32, 0);
            assert_ne!(dw_flags & FD_WRITESTIME.0 as u32, 0);
            let n_file_size_high = descriptor.nFileSizeHigh;
            let n_file_size_low = descriptor.nFileSizeLow;
            assert_eq!(n_file_size_high, 0x1234_5678);
            assert_eq!(n_file_size_low, 0x9ABC_DEF0);

            let expected_ticks = (modified + UNIX_EPOCH_AS_WINDOWS_FILETIME_SECONDS) * WINDOWS_TICK;
            let last_write_time = descriptor.ftLastWriteTime;
            let actual_ticks = u64::from(last_write_time.dwHighDateTime) << 32 | u64::from(last_write_time.dwLowDateTime);
            assert_eq!(actual_ticks, expected_ticks);
        }

        #[test]
        fn file_descriptor_omits_unknown_optional_metadata() {
            let descriptor = file_descriptor(&drag_item("report.txt", None, None));
            let dw_flags = descriptor.dwFlags;
            let n_file_size_high = descriptor.nFileSizeHigh;
            let n_file_size_low = descriptor.nFileSizeLow;
            let last_write_time = descriptor.ftLastWriteTime;

            assert_ne!(dw_flags & FD_ATTRIBUTES.0 as u32, 0);
            assert_eq!(dw_flags & FD_FILESIZE.0 as u32, 0);
            assert_eq!(dw_flags & FD_WRITESTIME.0 as u32, 0);
            assert_eq!(n_file_size_high, 0);
            assert_eq!(n_file_size_low, 0);
            assert_eq!(last_write_time.dwHighDateTime, 0);
            assert_eq!(last_write_time.dwLowDateTime, 0);
        }

        #[test]
        fn windows_filetime_conversion_saturates_instead_of_wrapping() {
            let filetime = filetime_from_unix_seconds(u64::MAX);

            assert_eq!(filetime.dwHighDateTime, u32::MAX);
            assert_eq!(filetime.dwLowDateTime, u32::MAX);
        }

        #[test]
        fn drag_file_name_filters_embedded_nuls_without_losing_unicode() {
            let wide = wide_drag_file_name("a\0b📦.txt");

            assert!(!wide.contains(&0));
            assert_eq!(String::from_utf16(&wide).expect("UTF-16 file name"), "ab📦.txt");
        }

        #[test]
        fn file_content_indices_must_select_an_existing_item() {
            let mut format = file_contents_formatetc();
            format.lindex = 0;
            assert_eq!(item_index(&format, 2).expect("first item"), 0);
            format.lindex = 1;
            assert_eq!(item_index(&format, 2).expect("second item"), 1);

            for invalid_index in [-1, 2, i32::MAX] {
                format.lindex = invalid_index;
                assert_eq!(item_index(&format, 2).expect_err("invalid drag item index").code(), DV_E_LINDEX);
            }
        }

        #[test]
        fn shell_folder_accepts_virtual_file_drag_data_object() {
            let kept_drop_target = std::env::var_os(KEEP_VIRTUAL_DROP_PROOF_DIR_ENV).map(PathBuf::from);
            let drop_target = kept_drop_target.clone().unwrap_or_else(|| unique_temp_dir("zmanager-virtual-drop-target"));
            fs::create_dir_all(&drop_target).expect("create shell drop target");

            let result = run_shell_virtual_file_drop(&drop_target);

            if kept_drop_target.is_none() {
                let _ = fs::remove_dir_all(&drop_target);
            }
            result.expect("shell folder should accept virtual file drag data object");
        }

        fn run_shell_virtual_file_drop(drop_target: &Path) -> Result<(), Box<dyn std::error::Error>> {
            let payloads = Arc::new(HashMap::from([
                ("folder/alpha.txt".to_string(), b"alpha from virtual drag".to_vec()),
                ("folder/beta.txt".to_string(), b"beta from virtual drag".to_vec()),
                ("folder/nested/deep/gamma.txt".to_string(), b"gamma from virtual drag".to_vec()),
            ]));
            let provider_payloads = Arc::clone(&payloads);
            let stream_provider: NativeFileDragStreamProvider = Arc::new(move |entry_path, writer| {
                let bytes = provider_payloads
                    .get(entry_path)
                    .ok_or_else(|| NativeFileDragError::new(format!("missing test payload for {entry_path}"), None::<String>))?;
                writer.write_all(bytes).map_err(|error| NativeFileDragError::new(format!("failed to write test payload: {error}"), None::<String>))?;
                Ok(bytes.len() as u64)
            });

            let items = vec![
                NativeFileDragItem {
                    entry_path: "folder/alpha.txt".to_string(),
                    display_path: "folder\\alpha.txt".to_string(),
                    size: Some(payloads["folder/alpha.txt"].len() as u64),
                    modified_unix_seconds: None,
                },
                NativeFileDragItem {
                    entry_path: "folder/beta.txt".to_string(),
                    display_path: "folder\\beta.txt".to_string(),
                    size: Some(payloads["folder/beta.txt"].len() as u64),
                    modified_unix_seconds: None,
                },
                NativeFileDragItem {
                    entry_path: "folder/nested/deep/gamma.txt".to_string(),
                    display_path: "folder\\nested\\deep\\gamma.txt".to_string(),
                    size: Some(payloads["folder/nested/deep/gamma.txt"].len() as u64),
                    modified_unix_seconds: None,
                },
            ];

            let _ole = OleApartment::initialize().map_err(|error| error.message)?;
            let data_object: IDataObject = VirtualFileDragDataObject { items, stream_provider }.into();
            let shell_drop_target = shell_folder_drop_target(drop_target)?;
            let point = POINTL { x: 0, y: 0 };
            let mut effect = DROPEFFECT_COPY;

            unsafe {
                shell_drop_target.DragEnter(&data_object, MODIFIERKEYS_FLAGS(0), point, &mut effect as *mut DROPEFFECT)?;
            }
            assert_ne!(effect, DROPEFFECT_NONE, "shell folder rejected the virtual-file data object on DragEnter");

            effect = DROPEFFECT_COPY;
            unsafe {
                shell_drop_target.Drop(&data_object, MODIFIERKEYS_FLAGS(0), point, &mut effect as *mut DROPEFFECT)?;
            }
            assert_ne!(effect, DROPEFFECT_NONE, "shell folder rejected the virtual-file data object on Drop");

            wait_for_file_contents(&drop_target.join("folder").join("alpha.txt"), payloads["folder/alpha.txt"].as_slice())?;
            wait_for_file_contents(&drop_target.join("folder").join("beta.txt"), payloads["folder/beta.txt"].as_slice())?;
            wait_for_file_contents(
                &drop_target.join("folder").join("nested").join("deep").join("gamma.txt"),
                payloads["folder/nested/deep/gamma.txt"].as_slice(),
            )?;

            Ok(())
        }

        fn shell_folder_drop_target(path: &Path) -> ::windows::core::Result<IDropTarget> {
            let wide_path = wide_null(&path.to_string_lossy());
            let folder: IShellItem = unsafe { SHCreateItemFromParsingName(PCWSTR(wide_path.as_ptr()), None::<&IBindCtx>)? };
            unsafe { folder.BindToHandler(None::<&IBindCtx>, &BHID_SFUIObject) }
        }

        fn wait_for_file_contents(path: &Path, expected: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
            for _ in 0..20 {
                if path.exists() && fs::read(path)? == expected {
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(100));
            }

            Err(format!("expected dropped file contents were not written to {}", path.display()).into())
        }

        fn unique_temp_dir(prefix: &str) -> PathBuf {
            let nanos = SystemTime::now().duration_since(UNIX_EPOCH).expect("system time before unix epoch").as_nanos();
            std::env::temp_dir().join(format!("{prefix}-{nanos}"))
        }
    }
}
