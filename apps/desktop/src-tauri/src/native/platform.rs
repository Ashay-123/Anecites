pub fn current_platform_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

pub fn current_platform_supported() -> bool {
    is_supported_platform(current_platform_name())
}

pub fn is_supported_platform(platform: &str) -> bool {
    platform.eq_ignore_ascii_case("windows")
}
