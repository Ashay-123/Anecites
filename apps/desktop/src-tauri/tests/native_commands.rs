use anecites_desktop::native::{capture_affinity, commands, platform, process_scanner};

#[test]
fn process_scan_limit_validation_rejects_unsafe_values() {
    let zero = process_scanner::validate_process_scan_limit(0).unwrap_err();
    assert_eq!(zero.code, "INVALID_ARGUMENT");

    let too_large = process_scanner::validate_process_scan_limit(501).unwrap_err();
    assert_eq!(too_large.code, "INVALID_ARGUMENT");
}

#[test]
fn capture_affinity_validation_rejects_blank_window_ids() {
    let error = capture_affinity::validate_window_id("   ").unwrap_err();

    assert_eq!(error.code, "INVALID_ARGUMENT");
}

#[test]
fn platform_guard_supports_windows_only_for_native_monitoring() {
    assert!(platform::is_supported_platform("windows"));
    assert!(!platform::is_supported_platform("linux"));
    assert!(!platform::is_supported_platform("macos"));
}

#[test]
fn native_capabilities_report_all_boundary_modules() {
    let capabilities = commands::get_native_capabilities();
    let capability_names: Vec<&str> = capabilities
        .iter()
        .map(|capability| capability.name.as_str())
        .collect();

    assert!(capability_names.contains(&"process_scanner"));
    assert!(capability_names.contains(&"window_monitor"));
    assert!(capability_names.contains(&"capture_affinity"));
    assert!(capability_names.contains(&"virtualization_detection"));
}
