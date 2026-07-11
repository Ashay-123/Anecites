use serde::Serialize;

use super::platform;
use super::types::NativeCommandError;

#[cfg(target_os = "windows")]
use std::mem::size_of;

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

const MAX_PROCESS_SCAN_LIMIT: u16 = 500;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
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

    scan_processes_for_supported_platform(limit)
}

#[cfg(target_os = "windows")]
fn scan_processes_for_supported_platform(
    limit: u16,
) -> Result<ProcessScanReport, NativeCommandError> {
    let mut processes = enumerate_processes()?;
    let truncated = processes.len() > limit as usize;
    processes.truncate(limit as usize);

    Ok(ProcessScanReport {
        platform: platform::current_platform_name().to_string(),
        processes,
        truncated,
    })
}

#[cfg(not(target_os = "windows"))]
fn scan_processes_for_supported_platform(
    _limit: u16,
) -> Result<ProcessScanReport, NativeCommandError> {
    unreachable!("unsupported platforms return before scanning")
}

#[cfg(target_os = "windows")]
fn enumerate_processes() -> Result<Vec<ProcessInfo>, NativeCommandError> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };

    if snapshot == INVALID_HANDLE_VALUE {
        return Err(NativeCommandError::os_error(
            "unable to create process snapshot",
        ));
    }

    let mut entry = PROCESSENTRY32W::default();
    entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;

    let mut processes = Vec::new();
    let has_first_entry = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;

    if has_first_entry {
        loop {
            let name = wide_null_terminated_to_string(&entry.szExeFile);

            if !name.is_empty() {
                processes.push(ProcessInfo {
                    pid: entry.th32ProcessID,
                    name,
                });
            }

            if unsafe { Process32NextW(snapshot, &mut entry) } == 0 {
                break;
            }
        }
    }

    unsafe {
        CloseHandle(snapshot);
    }

    Ok(processes)
}

#[cfg(target_os = "windows")]
fn wide_null_terminated_to_string(value: &[u16]) -> String {
    let length = value
        .iter()
        .position(|code_unit| *code_unit == 0)
        .unwrap_or(value.len());

    String::from_utf16_lossy(&value[..length])
        .trim()
        .to_string()
}
