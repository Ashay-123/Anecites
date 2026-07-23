use anecites_desktop::native::{
    capture_affinity, commands, environment, platform, process_scanner, prohibited_applications,
    window_monitor,
};

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
    assert!(capability_names.contains(&"prohibited_application_detection"));
    assert!(capability_names.contains(&"environment_detection"));
}

#[test]
fn prohibited_application_matching_returns_only_rule_ids_and_match_kinds() {
    let rules = vec![prohibited_applications::ProhibitedApplicationRule {
        id: "interview.assistant".to_string(),
        process_names: vec!["assistant.exe".to_string()],
        window_title_contains: vec!["interview helper".to_string()],
    }];
    let process_report = process_scanner::ProcessScanReport {
        platform: "windows".to_string(),
        processes: vec![process_scanner::ProcessInfo {
            pid: 42,
            name: "ASSISTANT.EXE".to_string(),
        }],
        truncated: false,
    };
    let window_report = window_monitor::WindowScanReport {
        platform: "windows".to_string(),
        windows: vec![window_monitor::WindowInfo {
            id: "1001".to_string(),
            title: "Interview Helper - Active".to_string(),
            process_name: Some("assistant.exe".to_string()),
        }],
        truncated: false,
    };

    let matches = prohibited_applications::match_prohibited_applications(
        &rules,
        &process_report,
        &window_report,
    )
    .unwrap();

    assert_eq!(
        matches,
        vec![prohibited_applications::ProhibitedApplicationMatch {
            rule_id: "interview.assistant".to_string(),
            match_kinds: vec!["process_name".to_string(), "window_title".to_string()],
            executable_sha256: None,
        }]
    );
}

#[test]
#[cfg(target_os = "windows")]
fn prohibited_application_detection_hashes_only_a_matched_executable() {
    let executable_name = std::env::current_exe()
        .unwrap()
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string();
    let matches = commands::detect_prohibited_applications(
        vec![prohibited_applications::ProhibitedApplicationRule {
            id: "harmless.test.fixture".to_string(),
            process_names: vec![executable_name],
            window_title_contains: Vec::new(),
        }],
        500,
        50,
    )
    .unwrap();

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].rule_id, "harmless.test.fixture");
    assert_eq!(
        matches[0].executable_sha256.as_ref().map(String::len),
        Some(64)
    );
}

#[test]
fn prohibited_application_matching_rejects_paths_and_empty_rules() {
    let process_report = process_scanner::ProcessScanReport {
        platform: "windows".to_string(),
        processes: Vec::new(),
        truncated: false,
    };
    let window_report = window_monitor::WindowScanReport {
        platform: "windows".to_string(),
        windows: Vec::new(),
        truncated: false,
    };

    let path_rule = prohibited_applications::ProhibitedApplicationRule {
        id: "path-rule".to_string(),
        process_names: vec!["C:\\tools\\assistant.exe".to_string()],
        window_title_contains: Vec::new(),
    };
    assert!(prohibited_applications::match_prohibited_applications(
        &[path_rule],
        &process_report,
        &window_report,
    )
    .is_err());

    let empty_rule = prohibited_applications::ProhibitedApplicationRule {
        id: "empty-rule".to_string(),
        process_names: Vec::new(),
        window_title_contains: Vec::new(),
    };
    assert!(prohibited_applications::match_prohibited_applications(
        &[empty_rule],
        &process_report,
        &window_report,
    )
    .is_err());
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
    match commands::scan_windows(50) {
        Ok(report) => {
            assert_eq!(report.platform, "windows");
            assert!(!report.windows.is_empty());
            assert!(report.windows.len() <= 50);
            assert!(report
                .windows
                .iter()
                .all(|window| !window.id.trim().is_empty()));
        }
        Err(error) => {
            assert_eq!(error.code, "OS_ERROR");
            assert_eq!(error.message, "unable to enumerate windows");
        }
    }
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
    assert!(report
        .signals
        .iter()
        .any(|signal| signal.name == "firmware.virtual_machine_marker"));
}

#[test]
#[cfg(target_os = "windows")]
fn environment_detection_reports_bounded_remote_session_and_monitor_state() {
    let report = commands::detect_environment().unwrap();

    assert_eq!(report.platform, "windows");
    assert!(report.monitor_count >= 1);
    assert_eq!(report.remote_session, environment::is_remote_session());
}
