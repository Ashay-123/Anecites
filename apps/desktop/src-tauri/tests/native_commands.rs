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

#[test]
#[cfg(target_os = "windows")]
fn process_scan_reports_current_process_on_windows() {
    let report = commands::scan_processes(500).unwrap();
    let current_pid = std::process::id();

    assert_eq!(report.platform, "windows");
    assert!(!report.processes.is_empty());
    assert!(report
        .processes
        .iter()
        .any(|process| process.pid == current_pid));
    assert!(report
        .processes
        .iter()
        .all(|process| !process.name.trim().is_empty()));
}

#[test]
#[cfg(target_os = "windows")]
fn window_scan_reports_bounded_window_records_on_windows() {
    let report = commands::scan_windows(50).unwrap();

    assert_eq!(report.platform, "windows");
    assert!(!report.windows.is_empty());
    assert!(report.windows.len() <= 50);
    assert!(report
        .windows
        .iter()
        .all(|window| !window.id.trim().is_empty()));
}

#[test]
#[cfg(target_os = "windows")]
fn capture_affinity_rejects_invalid_window_handles() {
    let error = commands::check_capture_affinity("0".to_string()).unwrap_err();

    assert_eq!(error.code, "INVALID_ARGUMENT");
}

#[test]
#[cfg(target_os = "windows")]
fn virtualization_detection_reports_cpuid_signal_on_windows() {
    let report = commands::detect_virtualization().unwrap();

    assert_eq!(report.platform, "windows");
    assert!(report
        .signals
        .iter()
        .any(|signal| signal.name == "cpuid.hypervisor_present"));
}
