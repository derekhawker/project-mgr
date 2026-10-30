use crate::management::ManagementStore;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PresentationPreferences {
    pub shared: SharedPreferences,
    pub change_review: ChangeReviewPreferences,
    pub ports: PortPreferences,
    #[serde(flatten)]
    pub other: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PortPreferences {
    pub selection: String,
    #[serde(flatten)]
    pub other: BTreeMap<String, serde_json::Value>,
}

impl Default for PortPreferences {
    fn default() -> Self {
        Self {
            selection:
                "3000-3010,4200,4321,5000-5010,5173-5180,5432,6379,8000-8010,8080-8090,9229,27017"
                    .into(),
            other: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeReviewMode {
    #[default]
    Unified,
    Split,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChangeReviewPreferences {
    pub mode: ChangeReviewMode,
    #[serde(flatten)]
    pub other: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SharedPreferences {
    pub file_navigator: FileNavigatorPreferences,
    #[serde(flatten)]
    pub other: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FileNavigatorPreferences {
    pub width: u32,
    #[serde(flatten)]
    pub other: BTreeMap<String, serde_json::Value>,
}

impl Default for FileNavigatorPreferences {
    fn default() -> Self {
        Self {
            width: 300,
            other: BTreeMap::new(),
        }
    }
}

impl Default for PresentationPreferences {
    fn default() -> Self {
        Self {
            shared: SharedPreferences::default(),
            change_review: ChangeReviewPreferences::default(),
            ports: PortPreferences::default(),
            other: BTreeMap::new(),
        }
    }
}

pub fn set_port_selection(
    store: &ManagementStore,
    selection: String,
) -> Result<PresentationPreferences, String> {
    let trimmed = selection.trim();
    if trimmed.len() > 2048 {
        return Err("Port selection is too long.".into());
    }
    if !trimmed.is_empty() {
        for token in trimmed.split(',').map(str::trim) {
            let parts: Vec<_> = token.split('-').collect();
            if parts.len() > 2 {
                return Err(format!("Invalid port range: {token}"));
            }
            let start = parts[0]
                .parse::<u16>()
                .map_err(|_| format!("Invalid port: {token}"))?;
            let end = if parts.len() == 2 {
                parts[1]
                    .parse::<u16>()
                    .map_err(|_| format!("Invalid port range: {token}"))?
            } else {
                start
            };
            if start == 0 || end < start {
                return Err(format!("Invalid port range: {token}"));
            }
        }
    }
    let mut preferences = load(store)?;
    preferences.ports.selection = trimmed.to_owned();
    save(store, preferences)
}

pub fn load(store: &ManagementStore) -> Result<PresentationPreferences, String> {
    match store
        .get_setting("presentation_preferences")
        .map_err(|e| e.to_string())?
    {
        Some(setting) => serde_json::from_str(&setting.value).map_err(|e| e.to_string()),
        None => Ok(PresentationPreferences::default()),
    }
}

pub fn set_navigator_width(
    store: &ManagementStore,
    width: u32,
) -> Result<PresentationPreferences, String> {
    if !(120..=640).contains(&width) {
        return Err("Navigator width must be between 120 and 640 pixels.".into());
    }
    let mut preferences = load(store)?;
    preferences.shared.file_navigator.width = width;
    save(store, preferences)
}

pub fn set_change_review_mode(
    store: &ManagementStore,
    mode: ChangeReviewMode,
) -> Result<PresentationPreferences, String> {
    let mut preferences = load(store)?;
    preferences.change_review.mode = mode;
    save(store, preferences)
}

fn save(
    store: &ManagementStore,
    preferences: PresentationPreferences,
) -> Result<PresentationPreferences, String> {
    let value = serde_json::to_string(&preferences).map_err(|e| e.to_string())?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    store
        .set_setting("presentation_preferences", &value, now)
        .map_err(|e| e.to_string())?;
    Ok(preferences)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_selection_defaults_persists_and_rejects_invalid_ranges_without_overwriting() {
        let store = ManagementStore::in_memory().unwrap();
        let default = load(&store).unwrap();
        assert_eq!(
            default.ports.selection,
            PortPreferences::default().selection
        );
        set_port_selection(&store, "3001-3003,5173".into()).unwrap();
        assert_eq!(load(&store).unwrap().ports.selection, "3001-3003,5173");
        assert!(set_port_selection(&store, "3005-3001".into()).is_err());
        assert_eq!(load(&store).unwrap().ports.selection, "3001-3003,5173");
    }

    #[test]
    fn old_preference_records_load_with_default_port_selection() {
        let store = ManagementStore::in_memory().unwrap();
        store
            .set_setting(
                "presentation_preferences",
                r#"{"shared":{"fileNavigator":{"width":300}},"changeReview":{"mode":"unified"}}"#,
                1,
            )
            .unwrap();
        assert_eq!(
            load(&store).unwrap().ports.selection,
            PortPreferences::default().selection
        );
    }
}
