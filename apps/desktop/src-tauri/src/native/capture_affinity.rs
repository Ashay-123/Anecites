use serde::Serialize;

use super::platform;
use super::types::NativeCommandError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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

    Ok(CaptureAffinityReport {
        platform: platform::current_platform_name().to_string(),
        window_id,
        protected_from_capture: false,
    })
}
