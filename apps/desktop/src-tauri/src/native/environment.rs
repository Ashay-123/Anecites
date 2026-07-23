use serde::Serialize;

use super::platform;
use super::types::NativeCommandError;

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CMONITORS, SM_REMOTESESSION,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentReport {
    pub platform: String,
    pub remote_session: bool,
    pub monitor_count: u16,
}

pub fn detect_environment() -> Result<EnvironmentReport, NativeCommandError> {
    if !platform::current_platform_supported() {
        return Err(NativeCommandError::unsupported_platform());
    }

    detect_environment_for_supported_platform()
}

#[cfg(target_os = "windows")]
fn detect_environment_for_supported_platform() -> Result<EnvironmentReport, NativeCommandError> {
    let monitor_count = normalize_monitor_count(unsafe { GetSystemMetrics(SM_CMONITORS) })?;

    Ok(EnvironmentReport {
        platform: platform::current_platform_name().to_string(),
        remote_session: is_remote_session(),
        monitor_count,
    })
}

#[cfg(target_os = "windows")]
fn normalize_monitor_count(value: i32) -> Result<u16, NativeCommandError> {
    if !(1..=32).contains(&value) {
        return Err(NativeCommandError::os_error(
            "Windows did not report a supported desktop monitor count",
        ));
    }

    Ok(value as u16)
}

#[cfg(target_os = "windows")]
pub fn is_remote_session() -> bool {
    unsafe { GetSystemMetrics(SM_REMOTESESSION) != 0 }
}

#[cfg(not(target_os = "windows"))]
fn detect_environment_for_supported_platform() -> Result<EnvironmentReport, NativeCommandError> {
    unreachable!("unsupported platforms return before detecting the environment")
}

#[cfg(not(target_os = "windows"))]
pub fn is_remote_session() -> bool {
    false
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::normalize_monitor_count;

    #[test]
    fn monitor_count_rejects_unknown_or_unbounded_desktops() {
        assert!(normalize_monitor_count(0).is_err());
        assert!(normalize_monitor_count(33).is_err());
        assert_eq!(normalize_monitor_count(1).unwrap(), 1);
    }
}
