use serde::Serialize;

use super::platform;
use super::types::NativeCommandError;

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetWindowDisplayAffinity, IsWindow, WDA_EXCLUDEFROMCAPTURE, WDA_MONITOR,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureAffinityReport {
    pub platform: String,
    pub window_id: String,
    pub protected_from_capture: bool,
}

pub fn validate_window_id(window_id: &str) -> Result<String, NativeCommandError> {
    let normalized = window_id.trim();

    if normalized.is_empty() {
        return Err(NativeCommandError::invalid_argument(
            "window ID is required",
        ));
    }

    Ok(normalized.to_string())
}

pub fn check_capture_affinity(
    window_id: String,
) -> Result<CaptureAffinityReport, NativeCommandError> {
    let window_id = validate_window_id(&window_id)?;

    if !platform::current_platform_supported() {
        return Err(NativeCommandError::unsupported_platform());
    }

    check_capture_affinity_for_supported_platform(window_id)
}

#[cfg(target_os = "windows")]
fn check_capture_affinity_for_supported_platform(
    window_id: String,
) -> Result<CaptureAffinityReport, NativeCommandError> {
    let hwnd = parse_window_handle(&window_id)?;

    if unsafe { IsWindow(hwnd) } == 0 {
        return Err(NativeCommandError::invalid_argument(
            "window ID is not a valid window handle",
        ));
    }

    let mut affinity = 0_u32;
    let result = unsafe { GetWindowDisplayAffinity(hwnd, &mut affinity) };

    Ok(CaptureAffinityReport {
        platform: platform::current_platform_name().to_string(),
        window_id,
        protected_from_capture: result != 0
            && (affinity == WDA_EXCLUDEFROMCAPTURE || affinity == WDA_MONITOR),
    })
}

#[cfg(not(target_os = "windows"))]
fn check_capture_affinity_for_supported_platform(
    _window_id: String,
) -> Result<CaptureAffinityReport, NativeCommandError> {
    unreachable!("unsupported platforms return before checking capture affinity")
}

#[cfg(target_os = "windows")]
fn parse_window_handle(window_id: &str) -> Result<HWND, NativeCommandError> {
    let normalized = validate_window_id(window_id)?;
    let trimmed = normalized.trim_start_matches("0x");
    let raw_handle = if trimmed.len() == normalized.len() {
        trimmed.parse::<usize>()
    } else {
        usize::from_str_radix(trimmed, 16)
    }
    .map_err(|_| {
        NativeCommandError::invalid_argument("window ID must be a numeric window handle")
    })?;

    if raw_handle == 0 {
        return Err(NativeCommandError::invalid_argument(
            "window ID must be a non-zero window handle",
        ));
    }

    Ok(raw_handle as HWND)
}
