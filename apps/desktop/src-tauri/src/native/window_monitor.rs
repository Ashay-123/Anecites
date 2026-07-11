use serde::Serialize;

use super::platform;
use super::types::NativeCommandError;

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{HWND, LPARAM, TRUE};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible,
};

const MAX_WINDOW_SCAN_LIMIT: u16 = 500;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub id: String,
    pub title: String,
    pub process_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowScanReport {
    pub platform: String,
    pub windows: Vec<WindowInfo>,
    pub truncated: bool,
}

pub fn validate_window_scan_limit(limit: u16) -> Result<u16, NativeCommandError> {
    if limit == 0 || limit > MAX_WINDOW_SCAN_LIMIT {
        return Err(NativeCommandError::invalid_argument(
            "window scan limit must be between 1 and 500",
        ));
    }

    Ok(limit)
}

pub fn scan_windows(limit: u16) -> Result<WindowScanReport, NativeCommandError> {
    validate_window_scan_limit(limit)?;

    if !platform::current_platform_supported() {
        return Err(NativeCommandError::unsupported_platform());
    }

    scan_windows_for_supported_platform(limit)
}

#[cfg(target_os = "windows")]
fn scan_windows_for_supported_platform(limit: u16) -> Result<WindowScanReport, NativeCommandError> {
    let mut state = WindowEnumerationState {
        limit: limit as usize,
        seen_window_count: 0,
        windows: Vec::new(),
    };

    let result = unsafe {
        EnumWindows(
            Some(enum_window),
            &mut state as *mut WindowEnumerationState as LPARAM,
        )
    };

    if result == 0 {
        return Err(NativeCommandError::os_error("unable to enumerate windows"));
    }

    Ok(WindowScanReport {
        platform: platform::current_platform_name().to_string(),
        truncated: state.seen_window_count > state.windows.len(),
        windows: state.windows,
    })
}

#[cfg(not(target_os = "windows"))]
fn scan_windows_for_supported_platform(
    _limit: u16,
) -> Result<WindowScanReport, NativeCommandError> {
    unreachable!("unsupported platforms return before scanning")
}

#[cfg(target_os = "windows")]
struct WindowEnumerationState {
    limit: usize,
    seen_window_count: usize,
    windows: Vec<WindowInfo>,
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_window(hwnd: HWND, lparam: LPARAM) -> i32 {
    if unsafe { IsWindowVisible(hwnd) } == 0 {
        return TRUE;
    }

    let state = unsafe { &mut *(lparam as *mut WindowEnumerationState) };
    state.seen_window_count += 1;

    if state.windows.len() < state.limit {
        state.windows.push(WindowInfo {
            id: (hwnd as isize).to_string(),
            title: unsafe { read_window_title(hwnd) },
            process_name: None,
        });
    }

    TRUE
}

#[cfg(target_os = "windows")]
unsafe fn read_window_title(hwnd: HWND) -> String {
    let length = unsafe { GetWindowTextLengthW(hwnd) };

    if length <= 0 {
        return String::new();
    }

    let mut buffer = vec![0_u16; length as usize + 1];
    let copied = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };

    if copied <= 0 {
        return String::new();
    }

    String::from_utf16_lossy(&buffer[..copied as usize])
}
