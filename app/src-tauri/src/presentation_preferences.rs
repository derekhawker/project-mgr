use crate::management::ManagementStore;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PresentationPreferences {
    pub shared: SharedPreferences,
    pub change_review: ChangeReviewPreferences,
    #[serde(flatten)]
    pub other: BTreeMap<String, serde_json::Value>,
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
            other: BTreeMap::new(),
        }
    }
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
