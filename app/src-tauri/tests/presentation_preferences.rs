use opencode_project_manager_lib::management::ManagementStore;
use opencode_project_manager_lib::presentation_preferences::{
    load, set_change_review_mode, set_navigator_width, ChangeReviewMode,
};

#[test]
fn navigator_width_survives_reopen_and_rejects_invalid_values() {
    let fixture = tempfile::tempdir().unwrap();
    let home = fixture.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    let database = fixture.path().join("settings.sqlite");
    let store = ManagementStore::open_with_paths(&database, &home, fixture.path()).unwrap();
    assert_eq!(load(&store).unwrap().shared.file_navigator.width, 300);
    store.set_setting("presentation_preferences", r#"{"shared":{"fileNavigator":{"width":300},"otherShared":true},"docs":{"theme":"example"}}"#, 1).unwrap();
    set_navigator_width(&store, 420).unwrap();
    assert_eq!(
        load(&store).unwrap().change_review.mode,
        ChangeReviewMode::Unified
    );
    set_change_review_mode(&store, ChangeReviewMode::Split).unwrap();
    assert!(serde_json::from_str::<ChangeReviewMode>("\"invalid\"").is_err());
    assert!(set_navigator_width(&store, 1).is_err());
    drop(store);
    let reopened = ManagementStore::open_with_paths(&database, &home, fixture.path()).unwrap();
    assert_eq!(load(&reopened).unwrap().shared.file_navigator.width, 420);
    let saved = load(&reopened).unwrap();
    assert_eq!(saved.change_review.mode, ChangeReviewMode::Split);
    assert_eq!(saved.other["docs"]["theme"], "example");
    assert_eq!(saved.shared.other["otherShared"], true);
}
