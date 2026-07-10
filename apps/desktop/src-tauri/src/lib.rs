pub mod native;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            native::commands::get_native_capabilities,
            native::commands::scan_processes,
            native::commands::scan_windows,
            native::commands::check_capture_affinity,
            native::commands::detect_virtualization,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Anecites desktop");
}
