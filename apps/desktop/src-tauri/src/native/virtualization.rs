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
    let firmware_marker = detect_firmware_virtual_machine_marker();

    VirtualizationReport {
        platform: platform::current_platform_name().to_string(),
        signals: vec![
            VirtualizationSignal {
                name: "cpuid.hypervisor_present".to_string(),
                detected: hypervisor_present,
                detail,
            },
            VirtualizationSignal {
                name: "firmware.virtual_machine_marker".to_string(),
                detected: firmware_marker.is_some(),
                detail: firmware_marker.map(|marker| format!("marker={marker}")),
            },
        ],
    }
}

#[cfg(target_os = "windows")]
fn detect_firmware_virtual_machine_marker() -> Option<String> {
    let manufacturer = read_bios_registry_value("SystemManufacturer").unwrap_or_default();
    let product = read_bios_registry_value("SystemProductName").unwrap_or_default();
    let combined = format!("{manufacturer} {product}").to_lowercase();
    [
        "vmware",
        "virtualbox",
        "kvm",
        "qemu",
        "xen",
        "parallels",
        "virtual machine",
    ]
    .into_iter()
    .find(|marker| combined.contains(marker))
    .map(str::to_string)
}

#[cfg(target_os = "windows")]
fn read_bios_registry_value(value_name: &str) -> Option<String> {
    use std::ffi::c_void;
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};

    let subkey = to_wide_null("HARDWARE\\DESCRIPTION\\System\\BIOS");
    let value = to_wide_null(value_name);
    let mut byte_count = 0_u32;
    let first = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            subkey.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_SZ,
            null_mut(),
            null_mut(),
            &mut byte_count,
        )
    };
    if first != ERROR_SUCCESS || byte_count < 2 || byte_count > 4_096 {
        return None;
    }

    let mut buffer = vec![0_u16; (byte_count as usize + 1) / 2];
    let second = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            subkey.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_SZ,
            null_mut(),
            buffer.as_mut_ptr().cast::<c_void>(),
            &mut byte_count,
        )
    };
    if second != ERROR_SUCCESS {
        return None;
    }

    let length = buffer
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(buffer.len());
    let value = String::from_utf16_lossy(&buffer[..length])
        .trim()
        .to_string();
    (!value.is_empty()).then_some(value)
}

#[cfg(target_os = "windows")]
fn to_wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
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
