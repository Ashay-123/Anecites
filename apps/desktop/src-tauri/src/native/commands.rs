use super::capture_affinity::{self, CaptureAffinityReport};
use super::environment::{self, EnvironmentReport};
use super::platform;
use super::process_scanner::{self, ProcessScanReport};
use super::prohibited_applications::{self, ProhibitedApplicationMatch, ProhibitedApplicationRule};
use super::types::{NativeCapability, NativeCommandError};
use super::virtualization::{self, VirtualizationReport};
use super::window_monitor::{self, WindowScanReport};

#[tauri::command]
pub fn get_native_capabilities() -> Vec<NativeCapability> {
    let available = platform::current_platform_supported();
    let reason = if available {
        None
    } else {
        Some("Native monitoring is supported only on Windows".to_string())
    };

    [
        "process_scanner",
        "window_monitor",
        "capture_affinity",
        "virtualization_detection",
        "prohibited_application_detection",
        "environment_detection",
    ]
    .into_iter()
    .map(|name| NativeCapability {
        name: name.to_string(),
        available,
        reason: reason.clone(),
    })
    .collect()
}

#[tauri::command]
pub fn scan_processes(limit: u16) -> Result<ProcessScanReport, NativeCommandError> {
    process_scanner::scan_processes(limit)
}

#[tauri::command]
pub fn scan_windows(limit: u16) -> Result<WindowScanReport, NativeCommandError> {
    window_monitor::scan_windows(limit)
}

#[tauri::command]
pub fn check_capture_affinity(
    window_id: String,
) -> Result<CaptureAffinityReport, NativeCommandError> {
    capture_affinity::check_capture_affinity(window_id)
}

#[tauri::command]
pub fn detect_virtualization() -> Result<VirtualizationReport, NativeCommandError> {
    virtualization::detect_virtualization()
}

#[tauri::command]
pub fn detect_environment() -> Result<EnvironmentReport, NativeCommandError> {
    environment::detect_environment()
}

#[tauri::command]
pub fn detect_prohibited_applications(
    rules: Vec<ProhibitedApplicationRule>,
    process_limit: u16,
    window_limit: u16,
) -> Result<Vec<ProhibitedApplicationMatch>, NativeCommandError> {
    prohibited_applications::detect_prohibited_applications(rules, process_limit, window_limit)
}
