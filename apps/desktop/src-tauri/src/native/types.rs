use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NativeCommandError {
    pub code: String,
    pub message: String,
}

impl NativeCommandError {
    pub fn invalid_argument(message: impl Into<String>) -> Self {
        Self {
            code: "INVALID_ARGUMENT".to_string(),
            message: message.into(),
        }
    }

    pub fn unsupported_platform() -> Self {
        Self {
            code: "UNSUPPORTED_PLATFORM".to_string(),
            message: "Native monitoring is supported only on Windows".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NativeCapability {
    pub name: String,
    pub available: bool,
    pub reason: Option<String>,
}
