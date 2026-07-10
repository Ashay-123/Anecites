use serde::Serialize;

use super::platform;
use super::types::NativeCommandError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VirtualizationSignal {
    pub name: String,
    pub detected: bool,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VirtualizationReport {
    pub platform: String,
    pub signals: Vec<VirtualizationSignal>,
}

pub fn detect_virtualization() -> Result<VirtualizationReport, NativeCommandError> {
    if !platform::current_platform_supported() {
        return Err(NativeCommandError::unsupported_platform());
    }

    Ok(VirtualizationReport {
        platform: platform::current_platform_name().to_string(),
        signals: Vec::new(),
    })
}
