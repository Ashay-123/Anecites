use serde::Serialize;

use super::platform;
use super::types::NativeCommandError;

const MAX_WINDOW_SCAN_LIMIT: u16 = 500;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WindowInfo {
    pub id: String,
    pub title: String,
    pub process_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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

    Ok(WindowScanReport {
        platform: platform::current_platform_name().to_string(),
        windows: Vec::new(),
        truncated: false,
    })
}
