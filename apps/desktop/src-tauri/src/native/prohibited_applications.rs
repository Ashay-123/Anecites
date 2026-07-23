use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::process_scanner::{self, ProcessScanReport};
use super::types::NativeCommandError;
use super::window_monitor::{self, WindowScanReport};

const MAX_RULES: usize = 100;
const MAX_MATCHERS_PER_RULE: usize = 20;
const MAX_MATCHER_LENGTH: usize = 128;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProhibitedApplicationRule {
    pub id: String,
    #[serde(default)]
    pub process_names: Vec<String>,
    #[serde(default)]
    pub window_title_contains: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProhibitedApplicationMatch {
    pub rule_id: String,
    pub match_kinds: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_sha256: Option<String>,
}

pub fn detect_prohibited_applications(
    rules: Vec<ProhibitedApplicationRule>,
    process_limit: u16,
    window_limit: u16,
) -> Result<Vec<ProhibitedApplicationMatch>, NativeCommandError> {
    validate_rules(&rules)?;
    if rules.is_empty() {
        return Ok(Vec::new());
    }

    let process_report = if rules.iter().any(|rule| !rule.process_names.is_empty()) {
        process_scanner::scan_processes(process_limit)?
    } else {
        ProcessScanReport {
            platform: super::platform::current_platform_name().to_string(),
            processes: Vec::new(),
            truncated: false,
        }
    };
    let window_report = if rules
        .iter()
        .any(|rule| !rule.window_title_contains.is_empty())
    {
        window_monitor::scan_windows(window_limit)?
    } else {
        WindowScanReport {
            platform: super::platform::current_platform_name().to_string(),
            windows: Vec::new(),
            truncated: false,
        }
    };
    match_prohibited_applications(&rules, &process_report, &window_report)
}

pub fn match_prohibited_applications(
    rules: &[ProhibitedApplicationRule],
    process_report: &ProcessScanReport,
    window_report: &WindowScanReport,
) -> Result<Vec<ProhibitedApplicationMatch>, NativeCommandError> {
    validate_rules(rules)?;

    let window_titles: Vec<String> = window_report
        .windows
        .iter()
        .map(|window| window.title.trim().to_lowercase())
        .filter(|title| !title.is_empty())
        .collect();

    let mut matches = Vec::new();
    for rule in rules {
        let matched_process = rule
            .process_names
            .iter()
            .map(|matcher| matcher.trim().to_lowercase())
            .find_map(|matcher| {
                process_report
                    .processes
                    .iter()
                    .find(|process| process.name.trim().eq_ignore_ascii_case(&matcher))
            });
        let process_name_matched = matched_process.is_some();
        let window_title_matched = rule
            .window_title_contains
            .iter()
            .map(|matcher| matcher.trim().to_lowercase())
            .any(|matcher| window_titles.iter().any(|title| title.contains(&matcher)));

        let mut match_kinds = Vec::new();
        if process_name_matched {
            match_kinds.push("process_name".to_string());
        }
        if window_title_matched {
            match_kinds.push("window_title".to_string());
        }
        if !match_kinds.is_empty() {
            matches.push(ProhibitedApplicationMatch {
                rule_id: rule.id.trim().to_lowercase(),
                match_kinds,
                executable_sha256: matched_process
                    .and_then(|process| process_scanner::executable_sha256(process.pid)),
            });
        }
    }

    Ok(matches)
}

fn validate_rules(rules: &[ProhibitedApplicationRule]) -> Result<(), NativeCommandError> {
    if rules.len() > MAX_RULES {
        return Err(NativeCommandError::invalid_argument(
            "prohibited application rules cannot exceed 100",
        ));
    }

    let mut seen_ids = HashSet::new();
    for rule in rules {
        let id = rule.id.trim().to_lowercase();
        if !valid_rule_id(&id) {
            return Err(NativeCommandError::invalid_argument(
                "prohibited application rule id is invalid",
            ));
        }
        if !seen_ids.insert(id) {
            return Err(NativeCommandError::invalid_argument(
                "prohibited application rule id is duplicated",
            ));
        }
        if rule.process_names.is_empty() && rule.window_title_contains.is_empty() {
            return Err(NativeCommandError::invalid_argument(
                "prohibited application rule must contain at least one matcher",
            ));
        }
        validate_matchers(&rule.process_names, 1, true)?;
        validate_matchers(&rule.window_title_contains, 3, false)?;
    }

    Ok(())
}

fn valid_rule_id(id: &str) -> bool {
    let mut characters = id.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    if !first.is_ascii_lowercase() && !first.is_ascii_digit() {
        return false;
    }
    id.len() <= 64
        && characters.all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '.' | '_' | '-')
        })
}

fn validate_matchers(
    matchers: &[String],
    minimum_length: usize,
    reject_path_separators: bool,
) -> Result<(), NativeCommandError> {
    if matchers.len() > MAX_MATCHERS_PER_RULE {
        return Err(NativeCommandError::invalid_argument(
            "prohibited application matcher count cannot exceed 20",
        ));
    }

    for matcher in matchers {
        let trimmed = matcher.trim();
        if trimmed.len() < minimum_length || trimmed.len() > MAX_MATCHER_LENGTH {
            return Err(NativeCommandError::invalid_argument(
                "prohibited application matcher length is invalid",
            ));
        }
        if trimmed.chars().any(char::is_control) {
            return Err(NativeCommandError::invalid_argument(
                "prohibited application matcher contains control characters",
            ));
        }
        if reject_path_separators && (trimmed.contains('/') || trimmed.contains('\\')) {
            return Err(NativeCommandError::invalid_argument(
                "prohibited process matcher must be an executable basename",
            ));
        }
    }

    Ok(())
}
