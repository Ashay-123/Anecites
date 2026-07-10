use serde::Serialize;

use super::platform;
use super::types::NativeCommandError;

const MAX_PROCESS_SCAN_LIMIT: u16 = 500;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProcessScanReport {
    pub platform: String,
    pub processes: Vec<ProcessInfo>,
    pub truncated: bool,
}

pub fn validate_process_scan_limit(limit: u16) -> Result<u16, NativeCommandError> {
    if limit == 0 || limit > MAX_PROCESS_SCAN_LIMIT {
        return Err(NativeCommandError::invalid_argument(
            "process scan limit must be between 1 and 500",
        ));
    }

    Ok(limit)
}

pub fn scan_processes(limit: u16) -> Result<ProcessScanReport, NativeCommandError> {
    validate_process_scan_limit(limit)?;

    if !platform::current_platform_supported() {
        return Err(NativeCommandError::unsupported_platform());
    }

    Ok(scan_processes_for_supported_platform(limit))
}

#[cfg(target_os = "windows")]
fn scan_processes_for_supported_platform(_limit: u16) -> ProcessScanReport {
    ProcessScanReport {
        platform: platform::current_platform_name().to_string(),
        processes: Vec::new(),
        truncated: false,
    }
}

#[cfg(not(target_os = "windows"))]
fn scan_processes_for_supported_platform(_limit: u16) -> ProcessScanReport {
    unreachable!("unsupported platforms return before scanning")
}
