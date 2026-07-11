use serde::Serialize;

use super::platform;
use super::types::NativeCommandError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualizationSignal {
    pub name: String,
    pub detected: bool,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualizationReport {
    pub platform: String,
    pub signals: Vec<VirtualizationSignal>,
}

pub fn detect_virtualization() -> Result<VirtualizationReport, NativeCommandError> {
    if !platform::current_platform_supported() {
        return Err(NativeCommandError::unsupported_platform());
    }

    Ok(detect_virtualization_for_supported_platform())
}

#[cfg(target_os = "windows")]
fn detect_virtualization_for_supported_platform() -> VirtualizationReport {
    let (hypervisor_present, detail) = detect_cpuid_hypervisor();

    VirtualizationReport {
        platform: platform::current_platform_name().to_string(),
        signals: vec![VirtualizationSignal {
            name: "cpuid.hypervisor_present".to_string(),
            detected: hypervisor_present,
            detail,
        }],
    }
}

#[cfg(not(target_os = "windows"))]
fn detect_virtualization_for_supported_platform() -> VirtualizationReport {
    unreachable!("unsupported platforms return before detecting virtualization")
}

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
fn detect_cpuid_hypervisor() -> (bool, Option<String>) {
    use std::arch::x86_64::__cpuid;

    let feature_info = __cpuid(1);
    let hypervisor_present = (feature_info.ecx & (1 << 31)) != 0;

    if !hypervisor_present {
        return (false, None);
    }

    let vendor_info = __cpuid(0x4000_0000);
    let mut vendor_bytes = Vec::new();
    vendor_bytes.extend_from_slice(&vendor_info.ebx.to_le_bytes());
    vendor_bytes.extend_from_slice(&vendor_info.ecx.to_le_bytes());
    vendor_bytes.extend_from_slice(&vendor_info.edx.to_le_bytes());
    let vendor = String::from_utf8_lossy(&vendor_bytes)
        .trim_matches(char::from(0))
        .trim()
        .to_string();

    if vendor.is_empty() {
        (true, None)
    } else {
        (true, Some(format!("vendor={vendor}")))
    }
}

#[cfg(all(target_os = "windows", target_arch = "x86"))]
fn detect_cpuid_hypervisor() -> (bool, Option<String>) {
    use std::arch::x86::__cpuid;

    let feature_info = __cpuid(1);
    let hypervisor_present = (feature_info.ecx & (1 << 31)) != 0;

    if !hypervisor_present {
        return (false, None);
    }

    let vendor_info = __cpuid(0x4000_0000);
    let mut vendor_bytes = Vec::new();
    vendor_bytes.extend_from_slice(&vendor_info.ebx.to_le_bytes());
    vendor_bytes.extend_from_slice(&vendor_info.ecx.to_le_bytes());
    vendor_bytes.extend_from_slice(&vendor_info.edx.to_le_bytes());
    let vendor = String::from_utf8_lossy(&vendor_bytes)
        .trim_matches(char::from(0))
        .trim()
        .to_string();

    if vendor.is_empty() {
        (true, None)
    } else {
        (true, Some(format!("vendor={vendor}")))
    }
}

#[cfg(all(
    target_os = "windows",
    not(any(target_arch = "x86", target_arch = "x86_64"))
))]
fn detect_cpuid_hypervisor() -> (bool, Option<String>) {
    (
        false,
        Some("cpuid unavailable on this architecture".to_string()),
    )
}
