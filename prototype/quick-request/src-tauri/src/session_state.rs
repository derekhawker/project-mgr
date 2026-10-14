//! Deterministic session state and routing rules.
//!
//! This module deliberately contains no OpenCode or Tauri calls.  The live
//! adapter supplies evidence, and this code decides what that evidence means.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SessionStatus {
    Starting,
    Running,
    WaitingForInput,
    ReadyForReview,
    Reconnecting,
    Unknown,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActiveStatus {
    Active,
    Inactive,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Outcome {
    None,
    Succeeded,
    Failed,
    Interrupted,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct PendingInput {
    pub permission: bool,
    pub form: bool,
    pub input: bool,
}

impl PendingInput {
    pub const fn any(self) -> bool {
        self.permission || self.form || self.input
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct EventCursor {
    pub last_seen: Option<u64>,
    pub replayed_through: Option<u64>,
    pub disconnected: bool,
}

impl EventCursor {
    pub const fn reconciled(self) -> bool {
        !self.disconnected
            || matches!((self.last_seen, self.replayed_through), (Some(last), Some(replayed)) if replayed >= last)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HistoryEvidence {
    NotChecked,
    Checked {
        has_user_message: bool,
        has_output: bool,
    },
}

impl HistoryEvidence {
    pub const fn checked(self) -> bool {
        !matches!(self, Self::NotChecked)
    }

    pub const fn has_usable_output(self) -> bool {
        matches!(
            self,
            Self::Checked {
                has_output: true,
                ..
            }
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReconciliationResult {
    NotAttempted,
    InProgress,
    Sufficient,
    Insufficient,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SessionEvidence {
    pub starting: bool,
    pub active: ActiveStatus,
    pub outcome: Outcome,
    pub pending: PendingInput,
    pub cursor: EventCursor,
    pub api_status_checked: bool,
    pub history: HistoryEvidence,
    pub reconciliation: ReconciliationResult,
}

impl Default for SessionEvidence {
    fn default() -> Self {
        Self {
            starting: false,
            active: ActiveStatus::Unavailable,
            outcome: Outcome::None,
            pending: PendingInput::default(),
            cursor: EventCursor::default(),
            api_status_checked: false,
            history: HistoryEvidence::NotChecked,
            reconciliation: ReconciliationResult::NotAttempted,
        }
    }
}

/// Classify only from durable/current evidence. In particular, inactive is
/// not completion evidence and cannot produce `ReadyForReview`.
pub fn classify(evidence: SessionEvidence) -> SessionStatus {
    if evidence.outcome == Outcome::Failed
        || evidence.reconciliation == ReconciliationResult::Failed
    {
        return SessionStatus::Failed;
    }
    if evidence.starting {
        return SessionStatus::Starting;
    }
    if evidence.cursor.disconnected {
        return match evidence.reconciliation {
            ReconciliationResult::Sufficient => classify_reconciled(evidence),
            ReconciliationResult::Insufficient => SessionStatus::Unknown,
            _ => SessionStatus::Reconnecting,
        };
    }
    classify_reconciled(evidence)
}

fn classify_reconciled(evidence: SessionEvidence) -> SessionStatus {
    if evidence.pending.any() {
        SessionStatus::WaitingForInput
    } else if evidence.active == ActiveStatus::Active {
        SessionStatus::Running
    } else if evidence.outcome == Outcome::Succeeded
        && matches!(
            evidence.history,
            HistoryEvidence::Checked {
                has_user_message: true,
                has_output: true
            }
        )
        && evidence.reconciliation != ReconciliationResult::Insufficient
    {
        SessionStatus::ReadyForReview
    } else {
        SessionStatus::Unknown
    }
}

/// Begin recovery after an event disconnect. No status inferred from the
/// last event is carried forward as a completion claim.
pub fn begin_event_recovery(mut evidence: SessionEvidence) -> SessionStatus {
    evidence.cursor.disconnected = true;
    evidence.reconciliation = ReconciliationResult::InProgress;
    classify(evidence)
}

/// Finish recovery using all required evidence. The caller must supply history
/// and pending-request checks from the API; this function never invents output.
pub fn reconcile_after_event_loss(
    mut evidence: SessionEvidence,
    api_status_checked: bool,
    pending_checked: bool,
    history: HistoryEvidence,
    replayed_through: Option<u64>,
) -> SessionStatus {
    evidence.api_status_checked = api_status_checked;
    evidence.history = history;
    evidence.cursor.replayed_through = replayed_through;
    if !api_status_checked
        || !pending_checked
        || !history.checked()
        || !evidence.cursor.reconciled()
    {
        // A prior failure/outcome is not enough to close an event-loss gap:
        // the caller has not yet established that it is the current state.
        return SessionStatus::Unknown;
    }
    evidence.reconciliation = ReconciliationResult::Sufficient;
    classify(evidence)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ContextKind {
    Workspace,
    Task,
    QuickRequest,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionAssociation {
    pub kind: ContextKind,
    pub owner_id: String,
    pub session_id: String,
    pub directory: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContextRequest {
    pub kind: ContextKind,
    pub owner_id: String,
    pub session_id: String,
    pub directory: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedContext {
    pub kind: ContextKind,
    pub owner_id: String,
    pub session_id: String,
    pub directory: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ContextError {
    MissingOwner,
    MissingSession,
    MissingDirectory,
    NoExactAssociation,
}

/// Resolve by the complete caller-supplied identity. This intentionally has
/// no fallback to newest session, directory scans, or foreground state.
pub fn resolve_context(
    request: &ContextRequest,
    associations: &[SessionAssociation],
) -> Result<ResolvedContext, ContextError> {
    if request.owner_id.trim().is_empty() {
        return Err(ContextError::MissingOwner);
    }
    if request.session_id.trim().is_empty() {
        return Err(ContextError::MissingSession);
    }
    if request.directory.trim().is_empty() {
        return Err(ContextError::MissingDirectory);
    }
    associations
        .iter()
        .find(|association| {
            association.kind == request.kind
                && association.owner_id == request.owner_id
                && association.session_id == request.session_id
                && association.directory == request.directory
        })
        .map(|association| ResolvedContext {
            kind: association.kind,
            owner_id: association.owner_id.clone(),
            session_id: association.session_id.clone(),
            directory: association.directory.clone(),
        })
        .ok_or(ContextError::NoExactAssociation)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn running() -> SessionEvidence {
        SessionEvidence {
            active: ActiveStatus::Active,
            api_status_checked: true,
            history: HistoryEvidence::Checked {
                has_user_message: true,
                has_output: false,
            },
            reconciliation: ReconciliationResult::Sufficient,
            ..Default::default()
        }
    }

    #[test]
    fn distinguishes_all_statuses_and_never_treats_inactive_as_ready() {
        assert_eq!(
            classify(SessionEvidence {
                starting: true,
                ..Default::default()
            }),
            SessionStatus::Starting
        );
        assert_eq!(classify(running()), SessionStatus::Running);
        assert_eq!(
            classify(SessionEvidence {
                pending: PendingInput {
                    permission: true,
                    ..Default::default()
                },
                ..running()
            }),
            SessionStatus::WaitingForInput
        );
        assert_eq!(
            classify(SessionEvidence {
                active: ActiveStatus::Inactive,
                outcome: Outcome::Succeeded,
                history: HistoryEvidence::Checked {
                    has_user_message: true,
                    has_output: true
                },
                reconciliation: ReconciliationResult::Sufficient,
                ..Default::default()
            }),
            SessionStatus::ReadyForReview
        );
        assert_eq!(
            classify(SessionEvidence {
                active: ActiveStatus::Inactive,
                outcome: Outcome::Succeeded,
                ..Default::default()
            }),
            SessionStatus::Unknown
        );
        let mut disconnected = running();
        disconnected.cursor.disconnected = true;
        disconnected.reconciliation = ReconciliationResult::InProgress;
        assert_eq!(classify(disconnected), SessionStatus::Reconnecting);
        assert_eq!(
            classify(SessionEvidence {
                outcome: Outcome::Failed,
                ..Default::default()
            }),
            SessionStatus::Failed
        );
    }

    #[test]
    fn event_loss_requires_status_pending_history_and_cursor_reconciliation() {
        let mut evidence = running();
        evidence.cursor = EventCursor {
            last_seen: Some(7),
            disconnected: true,
            ..Default::default()
        };
        evidence.outcome = Outcome::Succeeded;
        evidence.active = ActiveStatus::Inactive;
        assert_eq!(begin_event_recovery(evidence), SessionStatus::Reconnecting);
        assert_eq!(
            reconcile_after_event_loss(
                evidence,
                false,
                true,
                HistoryEvidence::Checked {
                    has_user_message: true,
                    has_output: true
                },
                Some(7)
            ),
            SessionStatus::Unknown
        );
        assert_eq!(
            reconcile_after_event_loss(
                evidence,
                true,
                true,
                HistoryEvidence::Checked {
                    has_user_message: true,
                    has_output: true
                },
                Some(7)
            ),
            SessionStatus::ReadyForReview
        );
        assert_eq!(
            reconcile_after_event_loss(
                evidence,
                true,
                true,
                HistoryEvidence::Checked {
                    has_user_message: true,
                    has_output: false
                },
                Some(7)
            ),
            SessionStatus::Unknown
        );
    }

    #[test]
    fn pending_input_remains_waiting_when_terminal_view_is_hidden() {
        let evidence = SessionEvidence {
            pending: PendingInput {
                form: true,
                ..Default::default()
            },
            active: ActiveStatus::Inactive,
            ..Default::default()
        };
        assert_eq!(classify(evidence), SessionStatus::WaitingForInput);
    }

    #[test]
    fn exact_context_identity_prevents_cross_routing_for_shared_directory() {
        let associations = vec![
            SessionAssociation {
                kind: ContextKind::QuickRequest,
                owner_id: "request-a".into(),
                session_id: "ses-a".into(),
                directory: "/shared".into(),
            },
            SessionAssociation {
                kind: ContextKind::QuickRequest,
                owner_id: "request-b".into(),
                session_id: "ses-b".into(),
                directory: "/shared".into(),
            },
        ];
        let request = ContextRequest {
            kind: ContextKind::QuickRequest,
            owner_id: "request-a".into(),
            session_id: "ses-a".into(),
            directory: "/shared".into(),
        };
        assert_eq!(
            resolve_context(&request, &associations).unwrap().session_id,
            "ses-a"
        );
        let wrong_id = ContextRequest {
            session_id: "ses-b".into(),
            ..request.clone()
        };
        assert_eq!(
            resolve_context(&wrong_id, &associations),
            Err(ContextError::NoExactAssociation)
        );
        let missing = ContextRequest {
            session_id: String::new(),
            ..request
        };
        assert_eq!(
            resolve_context(&missing, &associations),
            Err(ContextError::MissingSession)
        );
    }

    #[test]
    fn restore_without_initial_prompt_marker_stays_unclassified_without_output() {
        let evidence = SessionEvidence {
            active: ActiveStatus::Inactive,
            outcome: Outcome::Succeeded,
            history: HistoryEvidence::Checked {
                has_user_message: false,
                has_output: false,
            },
            reconciliation: ReconciliationResult::Sufficient,
            ..Default::default()
        };
        assert_eq!(classify(evidence), SessionStatus::Unknown);
    }
}
