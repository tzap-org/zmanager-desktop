use std::{ffi::OsStr, mem::size_of, os::windows::ffi::OsStrExt, ptr::null_mut, slice, sync::Arc};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use tauri::{Emitter, Wry};
use windows_sys::Win32::{
    Graphics::Gdi::{
        BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, CreateDIBSection, DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, HBRUSH, HGDIOBJ, ReleaseDC,
        SelectObject,
    },
    Storage::FileSystem::{FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL},
    UI::{
        Shell::{SHFILEINFOW, SHGFI_ICON, SHGFI_USEFILEATTRIBUTES, SHGetFileInfoW},
        WindowsAndMessaging::{DI_NORMAL, DestroyIcon, DrawIconEx, GetWindowThreadProcessId, HICON},
    },
};

use super::windows_drag_path::prepare_windows_drag_items;
use super::{
    CapabilityInspector, DefaultHandlerController, DefaultHandlerEntry, DefaultHandlerRequest, DiagnosticLogPolicy, MainWindowConfigurator,
    NativeCapabilityOperationError, NativeFileDragAdapter, NativeFileDragCandidate, NativeFileDragError, NativeFileDragItem, NativeFileDragJobContext,
    NativeFileDragOutcome, NativeFileDragStart, NativeFileDragStreamProvider, SecureFileProtector, SystemFileIconProvider,
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
        window: &tauri::WebviewWindow<Wry>,
        items: &[NativeFileDragItem],
        stream_provider: NativeFileDragStreamProvider,
        context: NativeFileDragJobContext<'_>,
    ) -> Result<NativeFileDragStart, NativeFileDragError> {
        if items.is_empty() {
            return Err(NativeFileDragError::new("No archive files are available to drag.", None::<String>));
        }

        // Prepare only the empty temporary root before DoDragDrop. Like 7-Zip,
        // the selected entries are extracted when the destination's drop asks
        // for the final names, after the pointer gesture has ended.
        let staged_drag = crate::platform::staged_file_drag::StagedFileDrag::prepare("Windows", items)?;
        let ui_thread_id = window.hwnd().ok().map(|hwnd| unsafe { GetWindowThreadProcessId(hwnd.0 as _, null_mut()) });
        let job_id = context.job_id.to_owned();
        let window = window.clone();
        let outcome = windows_file_drag::start_drag(
            ui_thread_id,
            staged_drag,
            items.to_vec(),
            stream_provider,
            Arc::new(move || {
                let _ = window.emit("native-file-drag-destination", NativeFileDragDestinationEvent { job_id: job_id.clone() });
            }),
        )?;
        Ok(NativeFileDragStart::Settled { outcome })
    }
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeFileDragDestinationEvent {
    job_id: String,
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

    let drawn = unsafe { DrawIconEx(memory_dc, 0, 0, icon, icon_size, icon_size, 0, null_mut::<HBRUSH>() as HBRUSH, DI_NORMAL) } != 0;

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

#[path = "windows_file_drag.rs"]
mod windows_file_drag;
