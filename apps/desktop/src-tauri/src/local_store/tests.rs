use super::*;

#[test]
fn current_schema_seeds_one_profile_and_eight_categories() {
    let directory = std::env::temp_dir().join(format!(
        "cadence-local-contract-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("contract.sqlite3");
    let mut connection = db::open(&path).unwrap();
    let profile = execute(&mut connection, Request::ReadProfile {}).unwrap();
    let id = profile["id"].as_str().unwrap().to_owned();
    assert_eq!(profile["timezone"], "America/New_York");
    let categories = execute(
        &mut connection,
        Request::ReadCategories {
            profile_id: id.clone(),
        },
    )
    .unwrap();
    assert_eq!(categories.as_array().unwrap().len(), 8);
    connection
        .execute(
            "DELETE FROM categories WHERE user_id=?1 AND name='Other'",
            [&id],
        )
        .unwrap();
    drop(connection);
    let mut reopened = db::open(&path).unwrap();
    assert_eq!(
        execute(&mut reopened, Request::ReadProfile {}).unwrap(),
        profile
    );
    assert_eq!(
        execute(&mut reopened, Request::ReadCategories { profile_id: id })
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        7
    );
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn local_request_rejects_unknown_operations_and_fields() {
    assert!(serde_json::from_value::<Request>(
        json!({"operation":"readProfile","sql":"DROP TABLE profiles"})
    )
    .is_err());
    assert!(
        serde_json::from_value::<Request>(json!({"operation":"executeSql","sql":"SELECT 1"}))
            .is_err()
    );
}

#[test]
fn travel_settings_commit_reopens_with_consent_and_outbox() {
    let mut fixture = Fixture::new();
    let current = execute(
        &mut fixture.db,
        Request::ReadTravelSettings {
            profile_id: fixture.profile.clone(),
        },
    )
    .unwrap();
    assert_eq!(current["enabled"], false);
    assert_eq!(current["routingConsentAt"], Value::Null);
    let outbox_before = fixture.count("mutation_outbox");
    let expected = current["updatedAt"].as_str().unwrap().to_string();
    let result = fixture
        .run(
            json!({
                "operation":"commitTravelSettings",
                "expectedUpdatedAt":expected,
                "next":{
                    "enabled":true,
                    "baseLocationText":"Home",
                    "mode":"walking",
                    "navigationPreference":"apple_maps",
                    "routingConsentAt":NOW,
                    "onboardingCompletedAt":NOW,
                    "updatedAt":NOW
                }
            }),
            90,
        )
        .unwrap();
    assert_eq!(result["enabled"], true);
    assert_eq!(fixture.count("mutation_outbox"), outbox_before + 1);
    let reopened = Connection::open(fixture.directory.join("data.sqlite3")).unwrap();
    let saved = travel::read_value(&reopened, &fixture.profile).unwrap();
    assert_eq!(saved["baseLocationText"], "Home");
    assert_eq!(saved["routingConsentAt"], NOW);
}

#[test]
fn utc_comparison_preserves_nanoseconds() {
    assert!(
        db::instant_key("2026-08-30T00:00:00Z").unwrap()
            < db::instant_key("2026-08-30T00:00:00.000000001Z").unwrap()
    );
    assert!(db::instant_key("2026-08-30T00:00:00+01:00").is_err());
    assert!(db::valid_date("2026-02-29").is_err());
}

const NOW: &str = "2026-08-30T12:00:00Z";
fn id(value: u32) -> String {
    format!("00000000-0000-4000-a000-{value:012}")
}
struct Fixture {
    directory: std::path::PathBuf,
    db: Connection,
    profile: String,
}
static FIXTURE_SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
impl Fixture {
    fn new() -> Self {
        Self::at_schema(db::MIGRATIONS.len())
    }
    fn at_schema(version: usize) -> Self {
        let directory = std::env::temp_dir().join(format!(
            "cadence-store-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            FIXTURE_SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let mut db = Connection::open(directory.join("data.sqlite3")).unwrap();
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")
            .unwrap();
        db::migrate(&mut db, &db::MIGRATIONS[..version]).unwrap();
        db::seed(&mut db).unwrap();
        let profile = db::profile(&db).unwrap().id;
        Self {
            directory,
            db,
            profile,
        }
    }
    fn run(&mut self, mut request: Value, mutation: u32) -> Result<Value> {
        request["profileId"] = json!(self.profile);
        request["mutationId"] = json!(id(mutation));
        request["now"] = json!(NOW);
        execute(&mut self.db, serde_json::from_value(request).unwrap())
    }
    fn count(&self, table: &str) -> i64 {
        self.db
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap()
    }
    fn create(&mut self) -> Value {
        let request = create_request(&self.profile);
        self.run(request, 100).unwrap()
    }
    fn occurrence(&mut self) -> Occurrence {
        let row = occurrence_row(&self.profile, 10, "exact", None);
        self.run(json!({"operation":"applyOccurrenceGeneration","behaviorId":id(1),"expectedConfigurationEventId":id(5),"create":[row],"update":[],"delete":[]}),101).unwrap();
        db::by_id(&self.db, &self.profile, &id(10)).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

fn configuration() -> Value {
    json!({"categoryId":null,"scheduleGraph":[{"recurrenceRule":{"frequency":"daily","interval":1},"sortOrder":0,"timeEntries":[{"kind":"exact","preset":null,"startTime":"09:00:00","endTime":null,"sortOrder":0}]}],"browserReminderEnabled":true,"emailReminderEnabled":false,"reminderOffsetMinutes":0,"active":true,"timezone":"America/New_York"})
}
fn create_request(profile: &str) -> Value {
    json!({"operation":"createBehaviorGraph","graph":{
        "behavior":{"id":id(1),"user_id":profile,"title":"Walk","description":null,"category_id":null,"recurrence_rule":{"frequency":"daily","interval":1},"scheduled_time":"09:00:00","timezone":"America/New_York","browser_reminder_enabled":true,"email_reminder_enabled":false,"reminder_offset_minutes":0,"default_duration_minutes":null,"end_date":null,"auto_archived_at":null,"active":true,"current_configuration_event_id":id(5),"created_at":NOW,"updated_at":NOW,"archived_at":null},
        "schedules":[{"id":id(2),"user_id":profile,"behavior_id":id(1),"recurrence_rule":{"frequency":"daily","interval":1},"sort_order":0,"created_at":NOW,"updated_at":NOW}],
        "slots":[{"id":id(3),"user_id":profile,"behavior_id":id(1),"behavior_schedule_id":id(2),"kind":"exact","preset":null,"start_time":"09:00:00","end_time":null,"sort_order":0,"created_at":NOW,"updated_at":NOW}]},
        "definitionEvent":{"id":id(4),"user_id":profile,"behavior_id":id(1),"previous_title":null,"previous_description":null,"next_title":"Walk","next_description":null,"changed_fields":["title"],"recorded_at":NOW,"source":"manual","reason":null,"created_at":NOW,"updated_at":NOW},
        "configurationEvent":{"id":id(5),"user_id":profile,"behavior_id":id(1),"event_kind":"baseline","previous_configuration":null,"next_configuration":configuration(),"changed_fields":["category_id","schedule_graph","browser_reminder_enabled","email_reminder_enabled","reminder_offset_minutes","active","timezone"],"recorded_at":NOW,"effective_at":NOW,"effective_local_date":"2026-08-30","timezone":"America/New_York","source":"manual","reason_code":"behavior_created","created_at":NOW}})
}
fn occurrence_row(profile: &str, number: u32, kind: &str, end: Option<&str>) -> Occurrence {
    serde_json::from_value(json!({"id":id(number),"user_id":profile,"behavior_id":id(1),"behavior_configuration_event_id":id(5),"behavior_schedule_slot_id":id(3),"scheduled_for":"2026-08-31T13:00:00Z","local_date":"2026-08-31","schedule_kind":kind,"schedule_preset":null,"schedule_start_time":"09:00:00","schedule_end_time":end,"schedule_range_identity":null,"status":"unresolved","completed_at":null,"status_marked_at":null,"note":null,"created_at":NOW,"updated_at":NOW})).unwrap()
}
fn status_request(
    profile: &str,
    previous: &str,
    latest: Option<u32>,
    next: &str,
    event_id: u32,
    instant: &str,
) -> Value {
    let marked = if next == "unresolved" {
        None
    } else {
        Some(instant)
    };
    let completed = if next == "completed" {
        Some(instant)
    } else {
        None
    };
    json!({"operation":"applyStatusTransition","occurrenceId":id(10),"expectedStatus":previous,"expectedLatestEventId":latest.map(id),"status":next,"completedAt":completed,"statusMarkedAt":marked,"cancelPendingReminders":next!="unresolved","event":{"id":id(event_id),"user_id":profile,"occurrence_id":id(10),"behavior_id":id(1),"previous_status":previous,"status":next,"status_semantics":if previous=="unresolved" && latest.is_none(){"explicit_user_mark"}else{"explicit_user_correction"},"recorded_at":instant,"effective_at":marked,"local_date":"2026-08-31","timezone":"America/New_York","source_capture_method":"manual_tap","source_confidence":"high","revises_event_id":latest.map(id),"reason_code":null,"created_at":instant,"updated_at":instant}})
}

#[test]
fn graph_and_outbox_commit_together_and_exact_retries_are_idempotent() {
    let mut fixture = Fixture::new();
    fixture.db.execute_batch("CREATE TRIGGER reject_outbox BEFORE INSERT ON mutation_outbox WHEN new.operation='createBehaviorGraph' BEGIN SELECT RAISE(ABORT,'test rollback'); END;").unwrap();
    assert!(fixture.run(create_request(&fixture.profile), 100).is_err());
    assert_eq!(fixture.count("behaviors"), 0);
    assert_eq!(fixture.count("behavior_definition_events"), 0);
    assert_eq!(fixture.count("mutation_outbox"), 1);
    fixture
        .db
        .execute_batch("DROP TRIGGER reject_outbox")
        .unwrap();
    let first = fixture.create();
    assert_eq!(first["revision"], 1);
    assert_eq!(
        fixture.run(create_request(&fixture.profile), 100).unwrap(),
        first
    );
    assert_eq!(fixture.count("mutation_outbox"), 2);
    let mut changed = create_request(&fixture.profile);
    changed["graph"]["behavior"]["title"] = json!("Run");
    assert!(fixture
        .run(changed, 100)
        .unwrap_err()
        .contains("different plan"));
    let mut reopened = db::open(&fixture.directory.join("data.sqlite3")).unwrap();
    assert_eq!(
        execute(
            &mut reopened,
            Request::ReadBehaviorGraphs {
                profile_id: fixture.profile.clone()
            }
        )
        .unwrap(),
        json!([first])
    );
}

#[test]
fn graph_revision_rejects_aba_and_foreign_rows() {
    let mut fixture = Fixture::new();
    let mut graph = fixture.create();
    graph.as_object_mut().unwrap().remove("revision");
    let base = create_request(&fixture.profile);
    let mut event = base["definitionEvent"].clone();
    event["id"] = json!(id(6));
    event["previous_title"] = json!("Walk");
    event["next_title"] = json!("Run");
    graph["behavior"]["title"] = json!("Run");
    let request = json!({"operation":"updateBehaviorGraph","graph":graph,"expectedRevision":1,"expectedNormalizedDefinition":{"title":"Walk","description":null},"definitionEvent":event,"configurationEvent":null});
    assert_eq!(fixture.run(request.clone(), 102).unwrap()["revision"], 2);
    assert!(fixture
        .run(request, 103)
        .unwrap_err()
        .contains("Behavior changed"));
    let mut foreign = create_request(&fixture.profile);
    foreign["graph"]["slots"][0]["user_id"] = json!(id(999));
    assert!(fixture.run(foreign, 104).is_err());
    assert_eq!(fixture.count("behavior_definition_events"), 2);
}

#[test]
fn archive_history_validates_and_roundtrips_each_cycle() {
    let mut fixture = Fixture::new();
    fixture.create();
    let original: Behavior = db::by_id(&fixture.db, &fixture.profile, &id(1)).unwrap();
    let first = BehaviorArchiveNote {
        id: id(6),
        archived_at: "2026-08-30T12:01:00Z".into(),
        note: Some("First cycle".into()),
        updated_at: "2026-08-30T12:01:00Z".into(),
    };
    let mut archived = original.clone();
    archived.active = false;
    archived.archived_at = Some(first.archived_at.clone());
    archived.archive_notes.push(first.clone());
    behavior::validate_archive_history(&original, &archived).unwrap();
    db::update(&fixture.db, &fixture.profile, &archived.id, &archived).unwrap();

    let mut restored = archived.clone();
    restored.active = true;
    restored.archived_at = None;
    behavior::validate_archive_history(&archived, &restored).unwrap();
    let mut rearchived = restored.clone();
    rearchived.active = false;
    rearchived.archived_at = Some("2026-08-30T12:02:00Z".into());
    rearchived.archive_notes.push(BehaviorArchiveNote {
        id: id(7),
        archived_at: "2026-08-30T12:02:00Z".into(),
        note: None,
        updated_at: "2026-08-30T12:02:00Z".into(),
    });
    behavior::validate_archive_history(&restored, &rearchived).unwrap();
    assert!(behavior::validate_archive_history(&rearchived, &archived).is_err());

    let mut invalid = rearchived.clone();
    invalid.archive_notes[1].id = first.id;
    assert!(db::validate_row(&fixture.profile, &invalid).is_err());
    invalid = rearchived.clone();
    invalid.archive_notes[1].note = Some(" untrimmed ".into());
    assert!(db::validate_row(&fixture.profile, &invalid).is_err());
    invalid.archive_notes[1].note = Some("x".repeat(2_001));
    assert!(db::validate_row(&fixture.profile, &invalid).is_err());
    invalid.archive_notes[1].note = Some("😀".repeat(1_001));
    assert!(db::validate_row(&fixture.profile, &invalid).is_err());

    db::update(&fixture.db, &fixture.profile, &rearchived.id, &rearchived).unwrap();
    let reopened = db::open(&fixture.directory.join("data.sqlite3")).unwrap();
    assert_eq!(
        db::by_id::<Behavior>(&reopened, &fixture.profile, &id(1))
            .unwrap()
            .archive_notes,
        rearchived.archive_notes
    );
}

#[test]
fn behavior_duration_and_archive_boundary_validate_and_roundtrip() {
    let mut fixture = Fixture::new();
    fixture.create();
    let mut behavior: Behavior = db::by_id(&fixture.db, &fixture.profile, &id(1)).unwrap();
    behavior.default_duration_minutes = Some(45);
    behavior.end_date = Some("2026-10-01".into());
    db::update(&fixture.db, &fixture.profile, &behavior.id, &behavior).unwrap();
    let stored: Behavior = db::by_id(&fixture.db, &fixture.profile, &behavior.id).unwrap();
    assert_eq!(stored.default_duration_minutes, Some(45));
    assert_eq!(stored.end_date.as_deref(), Some("2026-10-01"));

    let mut invalid = stored.clone();
    invalid.default_duration_minutes = Some(0);
    assert!(db::validate_row(&fixture.profile, &invalid).is_err());
    invalid = stored.clone();
    invalid.end_date = Some("2026-02-30".into());
    assert!(db::validate_row(&fixture.profile, &invalid).is_err());
    invalid = stored;
    invalid.auto_archived_at = Some("2026-10-01T04:00:00Z".into());
    assert!(db::validate_row(&fixture.profile, &invalid).is_err());
}

#[test]
fn occurrence_identity_keeps_exact_and_different_ranges_and_rejects_stale_batch() {
    let mut fixture = Fixture::new();
    fixture.create();
    let exact = occurrence_row(&fixture.profile, 10, "exact", None);
    let range = occurrence_row(&fixture.profile, 11, "range", Some("10:00:00"));
    let longer = occurrence_row(&fixture.profile, 12, "range", Some("11:00:00"));
    fixture.run(json!({"operation":"applyOccurrenceGeneration","behaviorId":id(1),"expectedConfigurationEventId":id(5),"create":[exact,range,longer],"update":[],"delete":[]}),101).unwrap();
    let rows = db::owned::<Occurrence>(&fixture.db, &fixture.profile).unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].schedule_range_identity, Some(-1));
    assert_eq!(rows[1].schedule_range_identity, Some(36_000_000_000));
    assert_eq!(rows[2].schedule_range_identity, Some(39_600_000_000));
    let mut fresh = occurrence_row(&fixture.profile, 13, "exact", None);
    fresh.local_date = "2026-09-01".into();
    fresh.scheduled_for = "2026-09-01T13:00:00Z".into();
    let duplicate = occurrence_row(&fixture.profile, 14, "exact", None);
    assert!(fixture.run(json!({"operation":"applyOccurrenceGeneration","behaviorId":id(1),"expectedConfigurationEventId":id(5),"create":[fresh,duplicate],"update":[],"delete":[]}),102).is_err());
    assert_eq!(fixture.count("occurrences"), 3);
    assert_eq!(fixture.count("mutation_outbox"), 3);
}

#[test]
fn end_date_only_edit_rejects_a_stale_generation_insert() {
    let mut fixture = Fixture::new();
    fixture.create();
    let planned = occurrence_row(&fixture.profile, 10, "exact", None);
    let mut behavior: Behavior = db::by_id(&fixture.db, &fixture.profile, &id(1)).unwrap();
    let configuration_id = behavior.current_configuration_event_id.clone();
    behavior.end_date = Some(planned.local_date.clone());
    db::update(&fixture.db, &fixture.profile, &behavior.id, &behavior).unwrap();
    let result = fixture.run(json!({"operation":"applyOccurrenceGeneration","behaviorId":id(1),"expectedConfigurationEventId":configuration_id,"create":[planned],"update":[],"delete":[]}),101);
    assert_eq!(
        result.unwrap_err(),
        "Behavior end date changed after occurrence planning."
    );
    assert_eq!(fixture.count("occurrences"), 0);
}

#[test]
fn end_date_cleanup_can_delete_elapsed_bare_rows_but_preserves_notes() {
    let mut fixture = Fixture::new();
    fixture.create();
    let mut row = fixture.occurrence();
    row.local_date = "2026-08-29".into();
    row.scheduled_for = "2026-08-29T13:00:00Z".into();
    row.note = Some("Keep this note".into());
    db::update(&fixture.db, &fixture.profile, &row.id, &row).unwrap();
    let mut behavior: Behavior = db::by_id(&fixture.db, &fixture.profile, &id(1)).unwrap();
    behavior.end_date = Some("2026-08-28".into());
    db::update(&fixture.db, &fixture.profile, &behavior.id, &behavior).unwrap();
    let request = |row: &Occurrence| json!({"operation":"applyOccurrenceGeneration","behaviorId":id(1),"expectedConfigurationEventId":id(5),"create":[],"update":[],"delete":[row]});
    assert!(fixture.run(request(&row), 102).is_err());
    row.note = None;
    db::update(&fixture.db, &fixture.profile, &row.id, &row).unwrap();
    fixture.run(request(&row), 103).unwrap();
    assert_eq!(fixture.count("occurrences"), 0);
}

#[test]
fn status_history_snapshot_reminders_and_outbox_are_atomic_with_aba_guard() {
    let mut fixture = Fixture::new();
    fixture.create();
    fixture.occurrence();
    fixture.db.execute("INSERT INTO native_reminder_state (user_id,id,occurrence_id,request_id,fire_at,title,body,status,created_at,updated_at) VALUES (?1,?2,?3,'cadence.test','2026-08-31T13:00:00Z','Test','Synthetic','scheduled',?4,?4)",params![fixture.profile,id(80),id(10),NOW]).unwrap();
    let first = status_request(
        &fixture.profile,
        "unresolved",
        None,
        "completed",
        20,
        "2026-08-30T12:01:00Z",
    );
    let result = fixture.run(first.clone(), 102).unwrap();
    assert_eq!(result["statusChanged"], true);
    let cancelled: String = fixture
        .db
        .query_row("SELECT status FROM native_reminder_state", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(cancelled, "cancelled");
    assert_eq!(
        fixture.run(first, 103).unwrap()["concurrentDuplicate"],
        true
    );
    assert_eq!(fixture.count("occurrence_status_events"), 1);
    fixture
        .run(
            status_request(
                &fixture.profile,
                "completed",
                Some(20),
                "not_completed",
                21,
                "2026-08-30T12:02:00Z",
            ),
            104,
        )
        .unwrap();
    fixture
        .run(
            status_request(
                &fixture.profile,
                "not_completed",
                Some(21),
                "completed",
                22,
                "2026-08-30T12:03:00Z",
            ),
            105,
        )
        .unwrap();
    let count = fixture.count("mutation_outbox");
    assert!(fixture
        .run(
            status_request(
                &fixture.profile,
                "completed",
                Some(20),
                "unresolved",
                23,
                "2026-08-30T12:04:00Z"
            ),
            106
        )
        .unwrap_err()
        .contains("history changed"));
    assert_eq!(fixture.count("occurrence_status_events"), 3);
    assert_eq!(fixture.count("mutation_outbox"), count);
    fixture.db.execute_batch("CREATE TRIGGER reject_status_outbox BEFORE INSERT ON mutation_outbox WHEN new.operation='applyStatusTransition' BEGIN SELECT RAISE(ABORT,'test rollback'); END;").unwrap();
    assert!(fixture
        .run(
            status_request(
                &fixture.profile,
                "completed",
                Some(22),
                "unresolved",
                24,
                "2026-08-30T12:05:00Z"
            ),
            107
        )
        .is_err());
    assert_eq!(fixture.count("occurrence_status_events"), 3);
    assert_eq!(
        db::by_id::<Occurrence>(&fixture.db, &fixture.profile, &id(10))
            .unwrap()
            .status,
        "completed"
    );
}

#[test]
fn generation_preserves_notes_and_configuration_lineage() {
    let mut fixture = Fixture::new();
    fixture.create();
    let before = fixture.occurrence();
    fixture.run(json!({"operation":"updateOccurrenceNote","occurrenceId":id(10),"expectedNote":null,"note":"Keep history"}),102).unwrap();
    assert!(fixture.run(json!({"operation":"updateOccurrenceNote","occurrenceId":id(10),"expectedNote":null,"note":"Stale overwrite"}),103).is_err());
    let noted: Occurrence = db::by_id(&fixture.db, &fixture.profile, &id(10)).unwrap();
    assert_eq!(
        noted.behavior_configuration_event_id,
        before.behavior_configuration_event_id
    );
    assert!(fixture.run(json!({"operation":"applyOccurrenceGeneration","behaviorId":id(1),"expectedConfigurationEventId":id(5),"create":[],"update":[],"delete":[noted]}),104).is_err());
    assert_eq!(fixture.count("occurrences"), 1);
}

#[test]
fn note_shortcuts_commit_with_notes_atomically_and_survive_restart() {
    let mut fixture = Fixture::new();
    fixture.create();
    fixture.occurrence();

    let global_context = note_shortcut::read_context(&fixture.db, &fixture.profile, None).unwrap();
    let global_state = NoteShortcutState {
        id: "global".into(),
        user_id: fixture.profile.clone(),
        behavior_id: None,
        enabled: true,
        entries: vec![],
        excluded_occurrence_ids: vec![],
        revision: 1,
        updated_at: NOW.into(),
    };
    fixture.run(json!({"operation":"commitNoteShortcutState","expected":global_context,"next":global_state,"requireEnabled":false}),102).unwrap();

    fixture
        .db
        .execute(
            "UPDATE occurrences SET note='Source corpus secret' WHERE user_id=?1 AND id=?2",
            params![fixture.profile, id(10)],
        )
        .unwrap();
    let behavior_context =
        note_shortcut::read_context(&fixture.db, &fixture.profile, Some(&id(1))).unwrap();
    let behavior_state = NoteShortcutState {
        id: id(1),
        user_id: fixture.profile.clone(),
        behavior_id: Some(id(1)),
        enabled: true,
        entries: vec![NoteShortcut {
            key: "a".repeat(64),
            text: Some("Accepted shortcut secret".into()),
            status: "accepted".into(),
            source: "repeated_text".into(),
            evidence: vec![],
            created_at: NOW.into(),
            expires_at: None,
        }],
        excluded_occurrence_ids: vec![],
        revision: 1,
        updated_at: NOW.into(),
    };
    let behavior_request = json!({"operation":"commitNoteShortcutState","expected":behavior_context,"next":behavior_state,"requireEnabled":false});
    assert_eq!(
        fixture.run(behavior_request.clone(), 103).unwrap(),
        json!(behavior_state)
    );
    let (journal_request, journal_result): (String, String) = fixture.db.query_row(
        "SELECT request_json,result_json FROM mutation_outbox WHERE user_id=?1 AND mutation_id=?2",
        params![fixture.profile,id(103)],
        |row| Ok((row.get(0)?,row.get(1)?)),
    ).unwrap();
    let journal_hash: String = serde_json::from_str(&journal_request).unwrap();
    assert_eq!(journal_hash.len(), 64);
    assert!(journal_hash.bytes().all(|byte| byte.is_ascii_hexdigit()));
    assert_eq!(journal_result, "null");
    assert!(!journal_request.contains("Source corpus secret"));
    assert!(!journal_request.contains("Accepted shortcut secret"));
    let committed_outbox = fixture.count("mutation_outbox");
    assert_eq!(
        fixture.run(behavior_request.clone(), 103).unwrap(),
        json!(behavior_state)
    );
    assert_eq!(fixture.count("mutation_outbox"), committed_outbox);
    let mut changed_request = behavior_request;
    changed_request["next"]["enabled"] = json!(false);
    assert!(fixture
        .run(changed_request, 103)
        .unwrap_err()
        .contains("different plan"));
    assert_eq!(fixture.count("mutation_outbox"), committed_outbox);
    fixture
        .db
        .execute(
            "UPDATE occurrences SET note=NULL WHERE user_id=?1 AND id=?2",
            params![fixture.profile, id(10)],
        )
        .unwrap();

    let outbox = fixture.count("mutation_outbox");
    fixture.db.execute_batch("CREATE TRIGGER reject_shortcut_note_outbox BEFORE INSERT ON mutation_outbox WHEN new.operation='updateOccurrenceNote' BEGIN SELECT RAISE(ABORT,'test rollback'); END;").unwrap();
    assert!(fixture.run(json!({"operation":"updateOccurrenceNote","occurrenceId":id(10),"expectedNote":null,"note":"Routine note","usedShortcut":true}),104).is_err());
    assert_eq!(fixture.count("mutation_outbox"), outbox);
    assert_eq!(
        db::by_id::<Occurrence>(&fixture.db, &fixture.profile, &id(10))
            .unwrap()
            .note,
        None
    );
    assert!(
        db::by_id::<NoteShortcutState>(&fixture.db, &fixture.profile, &id(1))
            .unwrap()
            .excluded_occurrence_ids
            .is_empty()
    );
    fixture
        .db
        .execute_batch("DROP TRIGGER reject_shortcut_note_outbox")
        .unwrap();

    fixture.run(json!({"operation":"updateOccurrenceNote","occurrenceId":id(10),"expectedNote":null,"note":"Routine note","usedShortcut":true}),105).unwrap();
    fixture.run(json!({"operation":"updateOccurrenceNote","occurrenceId":id(10),"expectedNote":"Routine note","note":"Edited later"}),106).unwrap();
    let saved = db::by_id::<NoteShortcutState>(&fixture.db, &fixture.profile, &id(1)).unwrap();
    assert_eq!(saved.revision, 2);
    assert_eq!(saved.excluded_occurrence_ids, vec![id(10)]);

    let stale_context =
        note_shortcut::read_context(&fixture.db, &fixture.profile, Some(&id(1))).unwrap();
    fixture.run(json!({"operation":"updateOccurrenceNote","occurrenceId":id(10),"expectedNote":"Edited later","note":"Source changed"}),107).unwrap();
    let mut stale_next = saved.clone();
    stale_next.revision += 1;
    stale_next.updated_at = NOW.into();
    assert!(fixture.run(json!({"operation":"commitNoteShortcutState","expected":stale_context,"next":stale_next,"requireEnabled":false}),108).unwrap_err().contains("sources or settings changed"));

    let mut foreign = saved.clone();
    foreign.user_id = id(999);
    foreign.revision += 1;
    let current_context =
        note_shortcut::read_context(&fixture.db, &fixture.profile, Some(&id(1))).unwrap();
    assert!(fixture.run(json!({"operation":"commitNoteShortcutState","expected":current_context,"next":foreign,"requireEnabled":false}),109).is_err());
    assert_eq!(
        db::by_id::<NoteShortcutState>(&fixture.db, &fixture.profile, &id(1)).unwrap(),
        saved
    );

    let reopened = db::open(&fixture.directory.join("data.sqlite3")).unwrap();
    assert_eq!(
        db::by_id::<NoteShortcutState>(&reopened, &fixture.profile, &id(1)).unwrap(),
        saved
    );
    assert_eq!(
        db::by_id::<Occurrence>(&reopened, &fixture.profile, &id(10))
            .unwrap()
            .note
            .as_deref(),
        Some("Source changed")
    );
}

#[test]
fn shortcut_note_save_creates_disabled_state_when_settings_changed() {
    let mut fixture = Fixture::new();
    fixture.create();
    fixture.occurrence();
    fixture.run(json!({"operation":"updateOccurrenceNote","occurrenceId":id(10),"expectedNote":null,"note":"Reviewed draft","usedShortcut":true}),102).unwrap();
    let state: NoteShortcutState = db::by_id(&fixture.db, &fixture.profile, &id(1)).unwrap();
    assert!(!state.enabled);
    assert_eq!(state.revision, 1);
    assert_eq!(state.excluded_occurrence_ids, vec![id(10)]);
}

#[test]
fn note_shortcut_validation_rejects_nfkc_duplicate_accepted_text() {
    let profile_id = id(50);
    let state = NoteShortcutState {
        id: id(51),
        user_id: profile_id.clone(),
        behavior_id: Some(id(51)),
        enabled: true,
        entries: vec![
            NoteShortcut {
                key: "a".repeat(64),
                text: Some("Shortcut text".into()),
                status: "accepted".into(),
                source: "repeated_text".into(),
                evidence: vec![],
                created_at: NOW.into(),
                expires_at: None,
            },
            NoteShortcut {
                key: "b".repeat(64),
                text: Some("Ｓｈｏｒｔｃｕｔ   ｔｅｘｔ".into()),
                status: "accepted".into(),
                source: "model".into(),
                evidence: vec![],
                created_at: NOW.into(),
                expires_at: None,
            },
        ],
        excluded_occurrence_ids: vec![],
        revision: 1,
        updated_at: NOW.into(),
    };
    assert!(db::validate_row(&profile_id, &state)
        .unwrap_err()
        .contains("duplicated text"));
}

#[test]
fn note_shortcut_revision_ceiling_is_readable_and_overflow_writes_no_journal() {
    let mut fixture = Fixture::new();
    let max_revision = i64::from(i32::MAX);
    fixture
        .db
        .execute(
            "INSERT INTO note_shortcut_states(id,user_id,behavior_id,enabled,entries,excluded_occurrence_ids,revision,updated_at) VALUES('global',?1,NULL,0,'[]','[]',?2,'2026-08-29T12:00:00Z')",
            params![fixture.profile, max_revision - 1],
        )
        .unwrap();

    let context = note_shortcut::read_context(&fixture.db, &fixture.profile, None).unwrap();
    let mut at_ceiling = context.state.clone().unwrap();
    at_ceiling.enabled = true;
    at_ceiling.revision = max_revision;
    at_ceiling.updated_at = NOW.into();
    fixture
        .run(
            json!({"operation":"commitNoteShortcutState","expected":context,"next":at_ceiling,"requireEnabled":false}),
            102,
        )
        .unwrap();

    let current = note_shortcut::read_context(&fixture.db, &fixture.profile, None).unwrap();
    assert_eq!(current.state.as_ref().unwrap().revision, max_revision);
    assert_eq!(
        note_shortcut::read_states(&fixture.db, &fixture.profile).unwrap()[0].revision,
        max_revision
    );
    let before_outbox = fixture.count("mutation_outbox");
    let mut overflow = current.state.clone().unwrap();
    overflow.revision = max_revision + 1;
    let error = fixture
        .run(
            json!({"operation":"commitNoteShortcutState","expected":current,"next":overflow,"requireEnabled":false}),
            103,
        )
        .unwrap_err();

    assert!(error.contains("revision is invalid"));
    assert_eq!(fixture.count("mutation_outbox"), before_outbox);
    assert_eq!(
        note_shortcut::read_states(&fixture.db, &fixture.profile).unwrap()[0].revision,
        max_revision
    );
}

#[test]
fn note_shortcut_validation_reserves_capacity_for_accepted_removal_history() {
    let profile_id = id(50);
    let dismissed = |index: usize| NoteShortcut {
        key: format!("{index:064x}"),
        text: None,
        status: "dismissed".into(),
        source: "repeated_text".into(),
        evidence: vec![],
        created_at: NOW.into(),
        expires_at: Some(NOW.into()),
    };
    let accepted = NoteShortcut {
        key: "f".repeat(64),
        text: Some("Accepted shortcut".into()),
        status: "accepted".into(),
        source: "model".into(),
        evidence: vec![],
        created_at: NOW.into(),
        expires_at: None,
    };
    let state = |entries| NoteShortcutState {
        id: id(51),
        user_id: profile_id.clone(),
        behavior_id: Some(id(51)),
        enabled: true,
        entries,
        excluded_occurrence_ids: vec![],
        revision: 1,
        updated_at: NOW.into(),
    };

    let mut with_one_reserved_slot = (0..126).map(dismissed).collect::<Vec<_>>();
    with_one_reserved_slot.push(accepted.clone());
    db::validate_row(&profile_id, &state(with_one_reserved_slot)).unwrap();

    let mut without_reserved_slot = (0..127).map(dismissed).collect::<Vec<_>>();
    without_reserved_slot.push(accepted);
    assert!(db::validate_row(&profile_id, &state(without_reserved_slot))
        .unwrap_err()
        .contains("limits"));

    let removal_result = (0..128).map(dismissed).collect::<Vec<_>>();
    db::validate_row(&profile_id, &state(removal_result)).unwrap();
}

#[test]
fn note_shortcut_context_does_not_materialize_oversized_notes() {
    let mut fixture = Fixture::new();
    fixture.create();
    fixture.occurrence();
    let oversized = "😀".repeat(2_001);
    fixture
        .run(
            json!({"operation":"updateOccurrenceNote","occurrenceId":id(10),"expectedNote":null,"note":oversized}),
            102,
        )
        .unwrap();
    let context = note_shortcut::read_context(&fixture.db, &fixture.profile, Some(&id(1))).unwrap();
    assert!(context.notes.is_empty());
    assert_eq!(
        db::by_id::<Occurrence>(&fixture.db, &fixture.profile, &id(10))
            .unwrap()
            .note
            .unwrap()
            .chars()
            .count(),
        2_001
    );
}

#[test]
fn timing_survives_restart_and_reset_requires_exact_sessions_and_writes_tombstones() {
    let mut fixture = Fixture::new();
    fixture.create();
    fixture.occurrence();
    let session:OccurrenceTimeSession=serde_json::from_value(json!({"id":id(30),"user_id":fixture.profile,"behavior_id":id(1),"occurrence_id":id(10),"started_at":NOW,"stopped_at":null,"created_at":NOW,"updated_at":NOW})).unwrap();
    fixture
        .run(
            json!({"operation":"startTimeSession","session":session}),
            102,
        )
        .unwrap();
    let mut duplicate = session.clone();
    duplicate.id = id(31);
    assert!(fixture
        .run(
            json!({"operation":"startTimeSession","session":duplicate}),
            103
        )
        .unwrap()
        .is_null());
    let reopened = db::open(&fixture.directory.join("data.sqlite3")).unwrap();
    assert_eq!(
        db::by_id::<OccurrenceTimeSession>(&reopened, &fixture.profile, &id(30))
            .unwrap()
            .stopped_at,
        None
    );
    fixture.run(json!({"operation":"stopTimeSession","occurrenceId":id(10),"sessionId":id(30),"stoppedAt":"2026-08-30T12:01:00Z"}),104).unwrap();
    assert!(fixture.run(json!({"operation":"resetTimeSessions","occurrenceId":id(10),"expectedSessions":[session]}),105).is_err());
    let stopped: OccurrenceTimeSession = db::by_id(&fixture.db, &fixture.profile, &id(30)).unwrap();
    fixture.run(json!({"operation":"resetTimeSessions","occurrenceId":id(10),"expectedSessions":[stopped]}),106).unwrap();
    assert_eq!(fixture.count("occurrence_time_sessions"), 0);
    assert_eq!(fixture.count("tombstones"), 1);
    assert_eq!(
        db::by_id::<Occurrence>(&fixture.db, &fixture.profile, &id(10))
            .unwrap()
            .status,
        "unresolved"
    );
}

#[test]
fn failed_migration_rolls_back_ddl_and_ledger_without_changing_profile() {
    let mut fixture = Fixture::new();
    let original = db::profile(&fixture.db).unwrap();
    let mut migrations = db::MIGRATIONS.to_vec();
    migrations.push((
        db::MIGRATIONS.last().unwrap().0 + 1,
        "broken",
        "CREATE TABLE must_rollback(id INTEGER); INSERT INTO no_such_table VALUES (1);",
    ));
    assert!(db::migrate(&mut fixture.db, &migrations).is_err());
    assert_eq!(
        fixture.count("schema_migrations"),
        db::MIGRATIONS.len() as i64
    );
    assert_eq!(db::profile(&fixture.db).unwrap(), original);
    let exists: bool = fixture
        .db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='must_rollback')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!exists);
}

#[test]
fn graph_edits_swap_times_and_relocate_retained_slots_without_losing_occurrence_links() {
    let mut fixture = Fixture::new();
    let mut initial = create_request(&fixture.profile);
    let mut second = initial["graph"]["slots"][0].clone();
    second["id"] = json!(id(7));
    second["start_time"] = json!("10:00:00");
    second["sort_order"] = json!(1);
    initial["graph"]["slots"]
        .as_array_mut()
        .unwrap()
        .push(second);
    let second_entry =
        json!({"kind":"exact","preset":null,"startTime":"10:00:00","endTime":null,"sortOrder":1});
    initial["configurationEvent"]["next_configuration"]["scheduleGraph"][0]["timeEntries"]
        .as_array_mut()
        .unwrap()
        .push(second_entry);
    let mut graph = fixture.run(initial.clone(), 100).unwrap();
    graph.as_object_mut().unwrap().remove("revision");
    fixture.occurrence();
    let old_configuration = initial["configurationEvent"]["next_configuration"].clone();
    let mut next_configuration = old_configuration.clone();
    next_configuration["scheduleGraph"][0]["timeEntries"][0]["startTime"] = json!("10:00:00");
    next_configuration["scheduleGraph"][0]["timeEntries"][1]["startTime"] = json!("09:00:00");
    graph["slots"][0]["start_time"] = json!("10:00:00");
    graph["slots"][1]["start_time"] = json!("09:00:00");
    graph["behavior"]["scheduled_time"] = json!("10:00:00");
    graph["behavior"]["current_configuration_event_id"] = json!(id(6));
    let mut event = initial["configurationEvent"].clone();
    event["id"] = json!(id(6));
    event["event_kind"] = json!("revision");
    event["previous_configuration"] = old_configuration;
    event["next_configuration"] = next_configuration;
    event["changed_fields"] = json!(["schedule_graph"]);
    let update = json!({"operation":"updateBehaviorGraph","graph":graph,"expectedRevision":1,"expectedNormalizedDefinition":{"title":"Walk","description":null},"definitionEvent":null,"configurationEvent":event});
    let mut changed = fixture.run(update, 102).unwrap();
    assert_eq!(changed["revision"], 2);
    changed.as_object_mut().unwrap().remove("revision");
    changed["schedules"][0]["id"] = json!(id(8));
    for slot in changed["slots"].as_array_mut().unwrap() {
        slot["behavior_schedule_id"] = json!(id(8));
    }
    fixture.run(json!({"operation":"updateBehaviorGraph","graph":changed,"expectedRevision":2,"expectedNormalizedDefinition":{"title":"Walk","description":null},"definitionEvent":null,"configurationEvent":null}),103).unwrap();
    let occurrence: Occurrence = db::by_id(&fixture.db, &fixture.profile, &id(10)).unwrap();
    assert_eq!(occurrence.behavior_schedule_slot_id, Some(id(3)));
    assert_eq!(occurrence.behavior_configuration_event_id, Some(id(5)));
    assert_eq!(occurrence.schedule_start_time, "09:00:00");
    assert_eq!(fixture.count("behavior_schedule_slots"), 2);
    assert_eq!(fixture.count("behavior_schedules"), 1);
    assert_eq!(fixture.count("tombstones"), 1);
}

#[test]
fn sync_freshness_cas_rejects_a_graph_mutation_during_generation() {
    let mut fixture = Fixture::new();
    let mut state = db::owned::<OccurrenceSyncState>(&fixture.db, &fixture.profile)
        .unwrap()
        .remove(0);
    fixture.create();
    assert!(fixture
        .run(
            json!({"operation":"commitSyncState","expectedVersion":0,"state":state}),
            101
        )
        .is_err());
    state = db::owned::<OccurrenceSyncState>(&fixture.db, &fixture.profile)
        .unwrap()
        .remove(0);
    assert_eq!(state.state_version, 1);
    fixture.occurrence();
    assert_eq!(
        db::owned::<OccurrenceSyncState>(&fixture.db, &fixture.profile).unwrap()[0].state_version,
        1
    );
    state.stale = false;
    state.stale_reason = None;
    state.last_synced_local_date = Some("2026-08-30".into());
    state.synced_through_local_date = Some("2026-09-29".into());
    state.last_successful_sync_at = Some(NOW.into());
    assert_eq!(
        fixture
            .run(
                json!({"operation":"commitSyncState","expectedVersion":1,"state":state}),
                102
            )
            .unwrap()["state_version"],
        2
    );
}

#[test]
fn timezone_commits_profile_graph_history_and_one_invalidation_atomically() {
    let mut fixture = Fixture::new();
    let original_graph = fixture.create();
    let original_occurrence = fixture.occurrence();
    let mut graph = original_graph.clone();
    graph.as_object_mut().unwrap().remove("revision");
    graph["behavior"]["timezone"] = json!("Europe/London");
    graph["behavior"]["current_configuration_event_id"] = json!(id(6));
    let mut configuration = create_request(&fixture.profile)["configurationEvent"].clone();
    configuration["id"] = json!(id(6));
    configuration["event_kind"] = json!("revision");
    configuration["previous_configuration"] = configuration["next_configuration"].clone();
    configuration["next_configuration"]["timezone"] = json!("Europe/London");
    configuration["timezone"] = json!("Europe/London");
    configuration["changed_fields"] = json!(["timezone"]);
    configuration["reason_code"] = json!("timezone_changed");
    let request = json!({"operation":"updateProfileTimezone","expectedTimezone":"America/New_York","expectedSyncVersion":1,"timezone":"Europe/London","updates":[{"graph":graph,"expectedRevision":1,"configurationEvent":configuration}]});
    let mut incomplete = request.clone();
    incomplete["updates"] = json!([]);
    assert!(fixture.run(incomplete, 102).is_err());
    let mut stale = request.clone();
    stale["updates"][0]["expectedRevision"] = json!(0);
    assert!(fixture.run(stale, 102).is_err());
    fixture.db.execute_batch("CREATE TRIGGER fail_timezone_outbox BEFORE INSERT ON mutation_outbox WHEN NEW.operation='updateProfileTimezone' BEGIN SELECT RAISE(ABORT,'forced outbox failure'); END;").unwrap();
    assert!(fixture.run(request.clone(), 102).is_err());
    assert_eq!(
        db::profile(&fixture.db).unwrap().timezone,
        "America/New_York"
    );
    assert_eq!(fixture.count("behavior_configuration_events"), 1);
    assert_eq!(
        behavior::read_graphs(&fixture.db, &fixture.profile).unwrap()[0],
        original_graph
    );
    fixture
        .db
        .execute_batch("DROP TRIGGER fail_timezone_outbox")
        .unwrap();
    assert_eq!(
        fixture.run(request, 102).unwrap()["timezone"],
        "Europe/London"
    );
    assert_eq!(fixture.count("behavior_configuration_events"), 2);
    assert_eq!(
        db::owned::<OccurrenceSyncState>(&fixture.db, &fixture.profile).unwrap()[0].state_version,
        2
    );
    assert_eq!(
        db::by_id::<Occurrence>(&fixture.db, &fixture.profile, &id(10)).unwrap(),
        original_occurrence
    );
    // A previously changed active Behavior remains untouched by a profile-only timezone update.
    fixture
        .db
        .execute(
            "UPDATE profiles SET timezone='America/New_York' WHERE id=?1",
            [&fixture.profile],
        )
        .unwrap();
    let mut unchanged = behavior::read_graphs(&fixture.db, &fixture.profile).unwrap()[0].clone();
    unchanged.as_object_mut().unwrap().remove("revision");
    fixture.run(json!({"operation":"updateProfileTimezone","expectedTimezone":"America/New_York","expectedSyncVersion":2,"timezone":"Europe/London","updates":[{"graph":unchanged,"expectedRevision":2,"configurationEvent":null}]}),103).unwrap();
    assert_eq!(fixture.count("behavior_configuration_events"), 2);
    assert_eq!(
        behavior::read_graphs(&fixture.db, &fixture.profile).unwrap()[0]["revision"],
        2
    );
}

fn native_reminder(profile: &str) -> Value {
    json!({"user_id":profile,"id":id(40),"occurrence_id":id(10),"request_id":format!("cadence.local.{}",id(10)),"fire_at":"2026-08-31T13:00:00Z","title":"Walk","body":"Test reminder","status":"planned","error":null,"verified_at":null,"created_at":NOW,"updated_at":NOW})
}

fn limited_coverage() -> Value {
    json!({"status":"limited","target_through":"2026-09-29T12:00:00Z","scheduled_through":"2026-08-31T13:00:00Z","first_unscheduled_at":"2026-09-01T13:00:00Z","expected_count":2,"scheduled_count":1,"missing_ids":[format!("cadence.local.{}",id(11))],"reason":"os_capacity","verified_at":NOW})
}

#[test]
fn reminder_intent_receipts_and_dataset_cas_preserve_failed_cancellation() {
    let mut fixture = Fixture::new();
    fixture.create();
    fixture.occurrence();
    let revision = reminder::revision(&fixture.db, &fixture.profile).unwrap();
    let plan = json!({"operation":"commitNativeReminderPlan","expectedRevision":revision,"reminders":[native_reminder(&fixture.profile)],"cancelIds":[]});
    let planned = fixture.run(plan.clone(), 102).unwrap();
    assert_eq!(planned["revision"], revision + 1);
    assert_eq!(planned["reminders"][0]["status"], "planned");
    assert!(planned["coverage"].is_null());
    assert_eq!(fixture.run(plan, 102).unwrap(), planned);
    let receipt = json!({"operation":"recordNativeReminderCoverage","expectedRevision":planned["revision"],"coverage":limited_coverage(),"observed":[{"id":id(40),"status":"scheduled","error":null}]});
    let verified = fixture.run(receipt.clone(), 103).unwrap();
    assert_eq!(verified["coverage"]["status"], "limited");
    assert_eq!(
        verified["coverage"]["dataset_revision"],
        verified["revision"]
    );
    assert_eq!(verified["reminders"][0]["status"], "scheduled");
    fixture
        .run(
            status_request(&fixture.profile, "unresolved", None, "completed", 20, NOW),
            104,
        )
        .unwrap();
    let current = reminder::read(&fixture.db, &fixture.profile).unwrap();
    assert_eq!(current["coverage"]["status"], "unverified");
    assert!(current["coverage"]["verified_at"].is_null());
    assert_eq!(current["reminders"][0]["status"], "cancelled");
    assert!(fixture.run(receipt, 105).is_err());
    let mut unverified = limited_coverage();
    unverified["status"] = json!("unverified");
    unverified["verified_at"] = Value::Null;
    unverified["reason"] = json!("OS cancellation failed");
    let failure = json!({"operation":"recordNativeReminderCoverage","expectedRevision":current["revision"],"coverage":unverified,"observed":[{"id":id(40),"status":"failed","error":"OS timeout"}]});
    let failed = fixture.run(failure, 106).unwrap();
    assert_eq!(failed["reminders"][0]["status"], "cancelled");
    assert_eq!(failed["reminders"][0]["error"], "OS timeout");
    assert!(failed["reminders"][0]["verified_at"].is_null());
    let reopened = db::open(&fixture.directory.join("data.sqlite3")).unwrap();
    assert_eq!(reminder::read(&reopened, &fixture.profile).unwrap(), failed);
    // Cancellation is idempotent, including a valid unknown UUID.
    fixture.run(json!({"operation":"commitNativeReminderPlan","expectedRevision":failed["revision"],"reminders":[],"cancelIds":[id(40),id(999)]}),107).unwrap();
    assert_eq!(fixture.count("native_reminder_state"), 1);
}

#[test]
fn reminder_receipt_and_outbox_failure_roll_back_together() {
    let mut fixture = Fixture::new();
    fixture.create();
    fixture.occurrence();
    let revision = reminder::revision(&fixture.db, &fixture.profile).unwrap();
    let planned=fixture.run(json!({"operation":"commitNativeReminderPlan","expectedRevision":revision,"reminders":[native_reminder(&fixture.profile)],"cancelIds":[]}),102).unwrap();
    fixture.db.execute_batch("CREATE TRIGGER fail_receipt_outbox BEFORE INSERT ON mutation_outbox WHEN NEW.operation='recordNativeReminderCoverage' BEGIN SELECT RAISE(ABORT,'forced outbox failure'); END;").unwrap();
    assert!(fixture.run(json!({"operation":"recordNativeReminderCoverage","expectedRevision":planned["revision"],"coverage":limited_coverage(),"observed":[{"id":id(40),"status":"scheduled","error":null}]}),103).is_err());
    assert_eq!(
        reminder::read(&fixture.db, &fixture.profile).unwrap(),
        planned
    );
    // Native writes cannot manufacture successful scheduling while accepting a desired plan.
    let mut invalid = native_reminder(&fixture.profile);
    invalid["status"] = json!("scheduled");
    assert!(fixture.run(json!({"operation":"commitNativeReminderPlan","expectedRevision":planned["revision"],"reminders":[invalid],"cancelIds":[]}),104).is_err());
    assert!(fixture.run(json!({"operation":"commitNativeReminderPlan","expectedRevision":planned["revision"],"reminders":[],"cancelIds":[]}),104).is_err());
}

#[test]
fn exact_os_delivery_corrects_expiry_history_but_rejects_stale_requests() {
    let mut fixture = Fixture::new();
    fixture.create();
    fixture.occurrence();
    let revision = reminder::revision(&fixture.db, &fixture.profile).unwrap();
    let planned = fixture.run(json!({"operation":"commitNativeReminderPlan","expectedRevision":revision,"reminders":[native_reminder(&fixture.profile)],"cancelIds":[]}),102).unwrap();
    let cancelled = fixture.run(json!({"operation":"commitNativeReminderPlan","expectedRevision":planned["revision"],"reminders":[],"cancelIds":[id(40)]}),103).unwrap();
    let proof = json!({"requestId":format!("cadence.local.{}",id(10)),"fireAt":"2026-08-31T13:00:00Z","title":"Walk","body":"Test reminder","deliveredAt":"2026-08-31T13:00:01Z"});
    let mut coverage = limited_coverage();
    coverage["status"] = json!("unverified");
    coverage["verified_at"] = Value::Null;
    let request = json!({"operation":"recordNativeReminderCoverage","profileId":fixture.profile,"mutationId":id(104),"now":"2026-08-31T13:02:00Z","expectedRevision":cancelled["revision"],"coverage":coverage,
        "observed":[{"id":id(40),"status":"delivered","error":null,"delivery":proof}]});
    for (field, value) in [
        ("requestId", format!("cadence.local.{}", id(11))),
        ("title", "Old title".into()),
        ("body", "Old body".into()),
        ("fireAt", "2026-08-31T12:59:00Z".into()),
        ("deliveredAt", "2026-08-31T12:59:59Z".into()),
        ("deliveredAt", "2026-08-31T13:02:01Z".into()),
    ] {
        let mut invalid = request.clone();
        invalid["observed"][0]["delivery"][field] = json!(value);
        assert!(execute(&mut fixture.db, serde_json::from_value(invalid).unwrap()).is_err());
        assert_eq!(
            reminder::read(&fixture.db, &fixture.profile).unwrap(),
            cancelled
        );
    }
    let mut missing = request.clone();
    missing["observed"][0]["delivery"] = Value::Null;
    assert!(execute(&mut fixture.db, serde_json::from_value(missing).unwrap()).is_err());
    let mut extraneous = request.clone();
    extraneous["observed"][0]["status"] = json!("cancelled");
    assert!(execute(&mut fixture.db, serde_json::from_value(extraneous).unwrap()).is_err());
    let observed = execute(&mut fixture.db, serde_json::from_value(request).unwrap()).unwrap();
    assert_eq!(observed["reminders"][0]["status"], "delivered");
    assert_eq!(
        observed["reminders"][0]["verified_at"],
        "2026-08-31T13:02:00Z"
    );
    let reopened = db::open(&fixture.directory.join("data.sqlite3")).unwrap();
    assert_eq!(
        reminder::read(&reopened, &fixture.profile).unwrap(),
        observed
    );
}

#[test]
fn export_reads_complete_histories_and_filters_sessions_at_nanosecond_boundary() {
    let mut fixture = Fixture::new();
    fixture.create();
    fixture.occurrence();
    for (number, start) in [(30, NOW), (31, "2026-08-30T12:00:00.000000001Z")] {
        let session:OccurrenceTimeSession=serde_json::from_value(json!({"id":id(number),"user_id":fixture.profile,"behavior_id":id(1),"occurrence_id":id(10),"started_at":start,"stopped_at":"2026-08-30T12:01:00Z","created_at":NOW,"updated_at":NOW})).unwrap();
        db::insert(&fixture.db, &fixture.profile, &session).unwrap();
    }
    let request = json!({"operation":"readExportSnapshot","profileId":fixture.profile,"startLocalDate":"2026-08-31","endLocalDate":"2026-08-31","includeTimeTracking":true,"throughStartedAt":NOW});
    let result = execute(
        &mut fixture.db,
        serde_json::from_value(request.clone()).unwrap(),
    )
    .unwrap();
    assert_eq!(result["occurrences"].as_array().unwrap().len(), 1);
    assert_eq!(result["timeSessions"].as_array().unwrap().len(), 1);
    assert_eq!(result["timeSessions"][0]["id"], id(30));
    let mut request = request;
    request["endLocalDate"] = json!("2026-08-30");
    request["startLocalDate"] = Value::Null;
    let before = execute(
        &mut fixture.db,
        serde_json::from_value(request.clone()).unwrap(),
    )
    .unwrap();
    assert!(before["occurrences"].as_array().unwrap().is_empty());
    assert_eq!(
        before["behaviorDefinitionEvents"].as_array().unwrap().len(),
        1
    );
    assert_eq!(
        before["behaviorConfigurationEvents"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    request["endLocalDate"] = json!("2026-08-31");
    request["includeTimeTracking"] = json!(false);
    let no_time = execute(&mut fixture.db, serde_json::from_value(request).unwrap()).unwrap();
    assert!(no_time["timeSessions"].as_array().unwrap().is_empty());
}

fn import_run(profile: &str, number: u32, mode: &str) -> Value {
    json!({"id":id(number),"user_id":profile,"accepted_preview_fingerprint":null,"accepted_preview_run_id":null,"bundle_fingerprint":"b".repeat(64),"bundle_format":"behaviorlog-bundle","completed_at":null,"created_at":NOW,"dry_run_summary":{"valid":true,"previewFingerprint":"a".repeat(64),"localDataFingerprint":"c".repeat(64),"bundleFingerprint":"b".repeat(64),"mergePreview":{"conflictCount":0}},"failure_message":null,"import_mode":mode,"manifest_sha256":null,"privacy_redaction_level":null,"producer_name":null,"producer_version":null,"schema_version":"1.0","started_at":NOW,"status":"previewed","subject_id_strategy":null,"updated_at":NOW})
}

#[test]
fn import_ledgers_allow_aggregate_previews_but_keep_bounded_rows() {
    let mut fixture = Fixture::new();
    let mut preview = import_run(&fixture.profile, 60, "merge_preview");
    preview["dry_run_summary"]["warnings"] = json!([{"message":"x".repeat(10 * 1_048_576)}]);
    let revision = import::domain_revision(&fixture.db, &fixture.profile).unwrap();
    fixture.run(json!({"operation":"prepareBehaviorLogImport","expectedRevision":revision,"previewRun":preview,"plan":null}), 100).unwrap();
    let stored: BehaviorLogImportRun = db::by_id(&fixture.db, &fixture.profile, &id(60)).unwrap();
    assert_eq!(serde_json::to_value(stored).unwrap(), preview);

    let mut oversized: BehaviorLogImportRun = serde_json::from_value(preview).unwrap();
    oversized.dry_run_summary = json!({"warnings":[{"message":"x".repeat(32 * 1_048_576)}]});
    assert_eq!(
        db::validate_row(&fixture.profile, &oversized).unwrap_err(),
        "A local row exceeds its allowed size."
    );
    let mut category = db::owned::<Category>(&fixture.db, &fixture.profile)
        .unwrap()
        .remove(0);
    category.description = Some("x".repeat(1_048_576));
    assert_eq!(
        db::validate_row(&fixture.profile, &category).unwrap_err(),
        "A local row exceeds its allowed size."
    );
}

#[test]
fn oversized_import_requests_fail_before_writing_a_preview() {
    let mut fixture = Fixture::new();
    let mut preview = import_run(&fixture.profile, 60, "merge_preview");
    preview["dry_run_summary"]["padding"] = json!("x".repeat(64 * 1_048_576));
    let revision = import::domain_revision(&fixture.db, &fixture.profile).unwrap();
    let error = fixture.run(json!({"operation":"prepareBehaviorLogImport","expectedRevision":revision,"previewRun":preview,"plan":null}), 100).unwrap_err();
    assert_eq!(error, "The local mutation exceeds its allowed size.");
    assert!(
        db::owned::<BehaviorLogImportRun>(&fixture.db, &fixture.profile)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        import::domain_revision(&fixture.db, &fixture.profile).unwrap(),
        revision
    );
}

#[test]
fn import_history_filters_before_limit_and_keeps_nanosecond_order() {
    let mut fixture = Fixture::new();
    for (number, mode, started) in [
        (60, "restore_preview", "2026-08-30T12:00:00Z"),
        (61, "restore_preview", "2026-08-30T12:00:00.000000001Z"),
        (62, "merge_preview", "2026-08-30T12:00:01Z"),
    ] {
        let mut row = import_run(&fixture.profile, number, mode);
        row["started_at"] = json!(started);
        db::insert(
            &fixture.db,
            &fixture.profile,
            &serde_json::from_value::<BehaviorLogImportRun>(row).unwrap(),
        )
        .unwrap();
    }
    let read = |kind: Option<&str>| {
        let mut request =
            json!({"operation":"readImportRuns","profileId":fixture.profile,"limit":1});
        if let Some(kind) = kind {
            request["kind"] = json!(kind);
        }
        serde_json::from_value(request).unwrap()
    };
    let restore = read(Some("restore"));
    let import = read(Some("import"));
    let all = read(None);
    assert_eq!(execute(&mut fixture.db, restore).unwrap()[0]["id"], id(61));
    assert_eq!(execute(&mut fixture.db, import).unwrap()[0]["id"], id(62));
    assert_eq!(execute(&mut fixture.db, all).unwrap()[0]["id"], id(62));
    assert!(serde_json::from_value::<Request>(json!({"operation":"readImportRuns","profileId":fixture.profile,"limit":1,"kind":"arbitrary"})).is_err());
}

#[test]
fn preview_rejects_ambiguous_archive_binding_and_malformed_validation_summary() {
    let mut fixture = Fixture::new();
    let profile = fixture.profile.clone();
    let revision = import::domain_revision(&fixture.db, &profile).unwrap();
    for changes in [
        json!({"archiveFingerprint":"d".repeat(64),"bundlePayloadFingerprint":"e".repeat(64)}),
        json!({"archiveFingerprint":false}),
        json!({"errorCount":"0"}),
        json!({"errors":{}}),
    ] {
        let mut preview = import_run(&profile, 60, "merge_preview");
        preview["dry_run_summary"]
            .as_object_mut()
            .unwrap()
            .extend(changes.as_object().unwrap().clone());
        assert!(fixture.run(json!({"operation":"prepareBehaviorLogImport","expectedRevision":revision,"previewRun":preview,"plan":import_plan(&profile)}),100).is_err());
        assert_eq!(fixture.count("behaviorlog_import_runs"), 0);
        assert_eq!(fixture.count("mutation_outbox"), 1);
    }
}

#[test]
fn accepted_archive_cannot_replace_definition_or_schedule() {
    let mut fixture = Fixture::new();
    fixture.create();
    let profile = fixture.profile.clone();
    let mut preview = import_run(&profile, 60, "restore_preview");
    preview["dry_run_summary"]["archiveFingerprint"] = json!("d".repeat(64));
    preview["dry_run_summary"]["statusHistoryPolicy"] =
        json!({"selected":"preserve_append_only_history","applySupportedInThisTicket":true});
    preview["dry_run_summary"]["summary"] = json!({"unsupportedActionCount":0,"skippedCount":0});
    preview["dry_run_summary"]["actions"] =
        json!({"behaviors":[{"localId":id(1),"externalId":null,"action":"archive"}]});
    let mut plan = import_plan(&profile);
    plan["mode"] = json!("restore_apply");
    plan["applyRun"]["import_mode"] = json!("restore_apply");
    plan["definitionEvents"] = json!([]);
    plan["occurrenceWrites"] = json!([]);
    plan["mappings"] = json!([]);
    let graph = &mut plan["graphWrites"][0];
    graph["expectedRevision"] = json!(1);
    graph["graph"]["behavior"]["active"] = json!(false);
    graph["graph"]["behavior"]["archived_at"] = json!(NOW);
    graph["graph"]["behavior"]["current_configuration_event_id"] = json!(id(6));
    let event = &mut graph["configurationEvents"][0];
    event["id"] = json!(id(6));
    event["event_kind"] = json!("revision");
    event["previous_configuration"] = configuration();
    event["next_configuration"]["active"] = json!(false);
    event["changed_fields"] = json!(["active"]);
    event["reason_code"] = json!("behaviorlog_restore");
    let revision = import::domain_revision(&fixture.db, &profile).unwrap();
    for field in ["title", "schedule"] {
        let mut invalid = plan.clone();
        if field == "title" {
            invalid["graphWrites"][0]["graph"]["behavior"]["title"] = json!("Unreviewed title");
        } else {
            invalid["graphWrites"][0]["graph"]["slots"][0]["start_time"] = json!("10:00:00");
        }
        let error = fixture.run(json!({"operation":"prepareBehaviorLogImport","expectedRevision":revision,"previewRun":preview,"plan":invalid}),101).unwrap_err();
        assert!(error.contains("archive action"), "{error}");
        assert_eq!(fixture.count("behaviorlog_import_runs"), 0);
    }
    fixture.run(json!({"operation":"prepareBehaviorLogImport","expectedRevision":revision,"previewRun":preview,"plan":plan}),101).unwrap();
    let mut apply = apply_import_request();
    apply["importMode"] = json!("restore_apply");
    apply["bundlePayloadFingerprint"] = json!("d".repeat(64));
    let result = fixture.run(apply, 102).unwrap();
    assert_eq!(result["status"], "applied", "{result}");
    let archived = behavior::graph(&fixture.db, &profile, &id(1)).unwrap();
    assert!(!archived.behavior.active);
    assert!(archived.behavior.archive_notes.is_empty());
    assert_eq!(archived.behavior.title, "Walk");
    assert_eq!(archived.slots[0].start_time, "09:00:00");
}
fn import_plan(profile: &str) -> Value {
    let mut run = import_run(profile, 61, "create_missing_only");
    run["accepted_preview_fingerprint"] = json!("a".repeat(64));
    run["accepted_preview_run_id"] = json!(id(60));
    let create = create_request(profile);
    let mut definition = create["definitionEvent"].clone();
    definition["source"] = json!("import");
    let mut configuration = create["configurationEvent"].clone();
    configuration["source"] = json!("import");
    json!({"mode":"create_missing_only","applyRun":run,"categoryCreates":[],"graphWrites":[{"expectedRevision":null,"graph":create["graph"],"configurationEvents":[configuration]}],"definitionEvents":[definition],"statusEvents":[],"occurrenceWrites":[{"expected":null,"next":occurrence_row(profile,10,"exact",None)}],"occurrenceDeletes":[],"timeSessionWrites":[],"importedNoteWrites":[],"importedNoteDeletes":[],"importedInterventionWrites":[],"importedInterventionDeletes":[],"mappings":[{"id":id(62),"user_id":profile,"import_run_id":id(61),"record_type":"behavior","external_id":"behavior.walk","local_id":id(1),"created_at":NOW}],"result":{"created":{"behaviors":1,"occurrences":1}}})
}
fn prepare_import(fixture: &mut Fixture, plan: Value) -> Value {
    let revision = import::domain_revision(&fixture.db, &fixture.profile).unwrap();
    fixture.run(json!({"operation":"prepareBehaviorLogImport","expectedRevision":revision,"previewRun":import_run(&fixture.profile,60,"merge_preview"),"plan":plan}),100).unwrap()
}
fn apply_import_request() -> Value {
    json!({"operation":"applyBehaviorLogImport","importMode":"create_missing_only","previewRunId":id(60),"previewFingerprint":"a".repeat(64),"localDataFingerprint":"c".repeat(64),"bundleFingerprint":"b".repeat(64),"bundlePayloadFingerprint":null})
}

fn imported_intervention(
    profile: &str,
    number: u32,
    channel: &str,
    status: &str,
) -> ImportedIntervention {
    serde_json::from_value(json!({
        "id":id(number),"user_id":profile,"import_run_id":id(61),
        "external_id":format!("intervention.{number}"),"intervention_type":"reminder",
        "behavior_external_id":"behavior.walk","behavior_id":id(1),
        "occurrence_external_id":"occurrence.walk","occurrence_id":id(10),
        "channel":channel,"delivery_status":status,"scheduled_send_at":NOW,
        "sent_at":null,"failure_reason":null,"metadata":{"preserved":true},
        "redacted_sensitivity_indicators":[],"source_capture_method":"import",
        "source_confidence":"high","source_original_id":format!("original.{number}"),
        "created_at":NOW,"updated_at":NOW
    }))
    .unwrap()
}

#[test]
fn passive_intervention_import_accepts_standard_channels_without_scheduling_reminders() {
    let mut fixture = Fixture::new();
    let channels = [
        "browser_push",
        "email",
        "sms",
        "mobile_push",
        "in_app",
        "calendar_notification",
        "voice_assistant",
        "webhook",
        "other",
        "none",
    ];
    let statuses = [
        "pending",
        "sent",
        "delivered",
        "failed",
        "cancelled",
        "suppressed",
        "unknown",
    ];
    let mut plan = import_plan(&fixture.profile);
    let mut writes = Vec::new();
    for (index, (channel, status)) in channels
        .iter()
        .flat_map(|channel| statuses.iter().map(move |status| (channel, status)))
        .enumerate()
    {
        writes.push(json!({"expected":null,"next":imported_intervention(&fixture.profile, 200 + index as u32, channel, status)}));
    }
    plan["importedInterventionWrites"] = json!(writes);
    prepare_import(&mut fixture, plan);
    let result = fixture.run(apply_import_request(), 101).unwrap();
    assert_eq!(result["status"], "applied", "{result}");
    assert_eq!(fixture.count("imported_interventions"), 70);
    assert_eq!(fixture.count("reminder_deliveries"), 0);
    assert_eq!(fixture.count("native_reminder_state"), 0);
    let reopened = db::open(&fixture.directory.join("data.sqlite3")).unwrap();
    assert_eq!(
        db::owned::<ImportedIntervention>(&reopened, &fixture.profile)
            .unwrap()
            .len(),
        70
    );
}

#[test]
fn passive_intervention_migration_preserves_history_provenance_and_revision_after_rollback() {
    let mut fixture = Fixture::at_schema(5);
    // Let the current Row type seed the older migration fixture without advancing its ledger.
    fixture.db.execute_batch(db::MIGRATIONS[11].2).unwrap();
    fixture.db.execute_batch(db::MIGRATIONS[14].2).unwrap();
    fixture.db.execute_batch(db::MIGRATIONS[15].2).unwrap();
    fixture.db.execute_batch(db::MIGRATIONS[17].2).unwrap();
    fixture.db.execute_batch(db::MIGRATIONS[18].2).unwrap();
    let mut plan = import_plan(&fixture.profile);
    let intervention = imported_intervention(&fixture.profile, 200, "browser_push", "sent");
    plan["importedInterventionWrites"] = json!([{"expected":null,"next":intervention}]);
    prepare_import(&mut fixture, plan);
    let applied = fixture.run(apply_import_request(), 101).unwrap();
    assert_eq!(applied["status"], "applied", "{applied}");
    let reminder: ReminderDelivery = serde_json::from_value(json!({
        "id":id(201),"user_id":fixture.profile,"occurrence_id":id(10),
        "channel":"browser_push","status":"pending","scheduled_send_at":NOW,
        "sent_at":null,"error":null,"processing_started_at":null,
        "import_run_id":id(61),"imported_intervention_id":id(200),
        "created_at":NOW,"updated_at":NOW
    }))
    .unwrap();
    db::insert(&fixture.db, &fixture.profile, &reminder).unwrap();
    // Canonicalize configuration history up front; the full migrate below re-runs 0017 as a no-op.
    fixture.db.execute_batch(db::MIGRATIONS[16].2).unwrap();
    let before = import::snapshot(&fixture.db, &fixture.profile).unwrap();
    let outbox = |db: &Connection| -> String {
        db.query_row("SELECT json_group_array(json_array(sequence,mutation_id,user_id,operation,request_json,result_json,created_at,synced_at)) FROM (SELECT * FROM mutation_outbox ORDER BY sequence)", [], |row| row.get(0)).unwrap()
    };
    let previous_outbox = outbox(&fixture.db);
    // Fail after rebuilding the table and restoring links. The enclosing
    // migration must roll all DDL, provenance changes, and ledger writes back.
    let broken = format!(
        "{}\nINSERT INTO missing_migration_test_table VALUES(1);",
        db::MIGRATIONS[5].2
    );
    let mut failed_migrations = db::MIGRATIONS[..5].to_vec();
    failed_migrations.push((6, "passive_intervention_channels", &broken));
    assert!(db::migrate(&mut fixture.db, &failed_migrations).is_err());
    assert_eq!(fixture.count("schema_migrations"), 5);
    assert_eq!(
        import::snapshot(&fixture.db, &fixture.profile).unwrap(),
        before
    );
    assert_eq!(outbox(&fixture.db), previous_outbox);
    assert!(db::insert(
        &fixture.db,
        &fixture.profile,
        &imported_intervention(&fixture.profile, 202, "other", "delivered")
    )
    .is_err());

    let mut before = before;
    for category in before["categories"].as_array_mut().unwrap() {
        category["description"] = Value::Null;
    }
    fixture
        .db
        .execute_batch(
            "ALTER TABLE behaviors DROP COLUMN auto_archived_at;
             ALTER TABLE behaviors DROP COLUMN end_date;
             ALTER TABLE behaviors DROP COLUMN default_duration_minutes;
             ALTER TABLE behaviors DROP COLUMN archive_notes;
             DROP TRIGGER profiles_create_default_travel_settings;
             DROP TABLE travel_settings;
             DROP TRIGGER behaviors_where_place_text_insert;
             DROP TRIGGER behaviors_where_place_text_update;
             ALTER TABLE behaviors DROP COLUMN where_kind;
             ALTER TABLE behaviors DROP COLUMN location_text;
             DROP TABLE completion_place_labels;
             DROP TABLE where_suggestion_dismissals;
             DROP TABLE place_markers;
             DROP TABLE place_label_settings;",
        )
        .unwrap();
    db::migrate(&mut fixture.db, db::MIGRATIONS).unwrap();
    assert_eq!(
        fixture.count("schema_migrations"),
        db::MIGRATIONS.len() as i64
    );
    assert_eq!(
        import::snapshot(&fixture.db, &fixture.profile).unwrap(),
        before
    );
    assert_eq!(outbox(&fixture.db), previous_outbox);
    assert_eq!(
        fixture
            .db
            .query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        fixture
            .db
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        0
    );
    let reopened = db::open(&fixture.directory.join("data.sqlite3")).unwrap();
    assert_eq!(
        import::snapshot(&reopened, &fixture.profile).unwrap(),
        before
    );
    db::insert(
        &reopened,
        &fixture.profile,
        &imported_intervention(&fixture.profile, 202, "other", "delivered"),
    )
    .unwrap();
    assert_eq!(
        import::domain_revision(&reopened, &fixture.profile).unwrap(),
        before["revision"].as_i64().unwrap() + 1
    );
    // These values remain passive. They must never widen operational delivery.
    let mut invalid_reminder = reminder.clone();
    invalid_reminder.id = id(203);
    invalid_reminder.channel = "other".into();
    assert!(db::insert(&reopened, &fixture.profile, &invalid_reminder).is_err());
    invalid_reminder.channel = "email".into();
    invalid_reminder.status = "delivered".into();
    assert!(db::insert(&reopened, &fixture.profile, &invalid_reminder).is_err());
    assert_eq!(
        db::owned::<ReminderDelivery>(&reopened, &fixture.profile).unwrap(),
        vec![reminder]
    );
}

#[test]
fn invalid_passive_intervention_enums_roll_back_the_entire_import() {
    for (channel, status) in [
        ("arbitrary", "sent"),
        ("other", "arbitrary"),
        ("other", "planned"),
    ] {
        let mut fixture = Fixture::new();
        let mut plan = import_plan(&fixture.profile);
        plan["importedInterventionWrites"] = json!([{"expected":null,"next":imported_intervention(&fixture.profile, 200, channel, status)}]);
        prepare_import(&mut fixture, plan);
        assert_eq!(
            fixture.run(apply_import_request(), 101).unwrap()["status"],
            "failed"
        );
        assert_eq!(fixture.count("behaviors"), 0);
        assert_eq!(fixture.count("occurrences"), 0);
        assert_eq!(fixture.count("imported_interventions"), 0);
        assert_eq!(fixture.count("reminder_deliveries"), 0);
        assert_eq!(fixture.count("native_reminder_state"), 0);
    }
}

#[test]
fn reviewed_import_plan_writes_nothing_until_apply_and_replays_one_result() {
    let mut fixture = Fixture::new();
    let profile = fixture.profile.clone();
    let prepared = prepare_import(&mut fixture, import_plan(&profile));
    assert_eq!(fixture.count("behaviors"), 0);
    assert_eq!(fixture.count("occurrences"), 0);
    assert_eq!(fixture.count("behaviorlog_import_runs"), 1);
    let mut wrong_mode = apply_import_request();
    wrong_mode["importMode"] = json!("restore_apply");
    assert!(fixture.run(wrong_mode, 101).is_err());
    assert_eq!(fixture.count("behaviorlog_import_runs"), 1);
    assert_eq!(fixture.count("behaviors"), 0);
    assert_eq!(
        prepared["revision"],
        import::domain_revision(&fixture.db, &profile).unwrap()
    );
    let mut substituted = apply_import_request();
    substituted["plan"] = import_plan(&profile);
    substituted["profileId"] = json!(profile);
    substituted["mutationId"] = json!(id(101));
    substituted["now"] = json!(NOW);
    assert!(serde_json::from_value::<Request>(substituted).is_err());
    let applied = fixture.run(apply_import_request(), 101).unwrap();
    assert_eq!(applied["status"], "applied");
    assert_eq!(fixture.count("behaviors"), 1);
    assert_eq!(fixture.count("occurrences"), 1);
    assert_eq!(fixture.count("behavior_definition_events"), 1);
    assert_eq!(fixture.count("behavior_configuration_events"), 1);
    assert_eq!(fixture.count("behaviorlog_import_runs"), 2);
    assert_eq!(fixture.count("behaviorlog_import_record_mappings"), 1);
    let repeated = fixture.run(apply_import_request(), 102).unwrap();
    assert_eq!(repeated["alreadyApplied"], true);
    assert_eq!(fixture.count("behaviorlog_import_record_mappings"), 1);
    let mut wrong = apply_import_request();
    wrong["bundleFingerprint"] = json!("f".repeat(64));
    assert!(fixture.run(wrong, 103).is_err());
    let reopened = db::open(&fixture.directory.join("data.sqlite3")).unwrap();
    assert_eq!(
        import::snapshot(&reopened, &profile).unwrap()["occurrences"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn identity_adoption_preserves_committed_wal_history_provenance_and_outbox() {
    let mut fixture = Fixture::new();
    let support = fixture.directory.join("Application Support");
    let previous = support.join("app.cadence.desktop-spike");
    let current = support.join("app.cadence.desktop");
    std::fs::create_dir_all(&previous).unwrap();
    std::fs::create_dir_all(&current).unwrap();
    let source_path = previous.join("cadence.sqlite3");
    fixture.db = db::open(&source_path).unwrap();
    fixture
        .db
        .execute_batch("PRAGMA wal_autocheckpoint=0;")
        .unwrap();
    fixture.profile = db::profile(&fixture.db).unwrap().id;
    let profile = fixture.profile.clone();
    prepare_import(&mut fixture, import_plan(&profile));
    assert_eq!(
        fixture.run(apply_import_request(), 101).unwrap()["status"],
        "applied"
    );
    fixture
        .run(
            status_request(&profile, "unresolved", None, "completed", 20, NOW),
            102,
        )
        .unwrap();
    fixture.run(json!({"operation":"updateOccurrenceNote","occurrenceId":id(10),"expectedNote":null,"note":"Retain this imported history"}),103).unwrap();
    let session = json!({"id":id(30),"user_id":profile,"behavior_id":id(1),"occurrence_id":id(10),"started_at":NOW,"stopped_at":null,"created_at":NOW,"updated_at":NOW});
    fixture
        .run(
            json!({"operation":"startTimeSession","session":session}),
            104,
        )
        .unwrap();
    let stored: OccurrenceTimeSession = db::by_id(&fixture.db, &profile, &id(30)).unwrap();
    fixture.run(json!({"operation":"resetTimeSessions","occurrenceId":id(10),"expectedSessions":[stored]}),105).unwrap();
    let mut retained_session = session;
    retained_session["id"] = json!(id(31));
    fixture
        .run(
            json!({"operation":"startTimeSession","session":retained_session}),
            106,
        )
        .unwrap();
    let snapshot = import::snapshot(&fixture.db, &profile).unwrap();
    let ledger = |db: &Connection| -> Vec<String> {
        db.prepare("SELECT json_array(sequence,mutation_id,user_id,operation,request_json,result_json,created_at) FROM mutation_outbox ORDER BY sequence").unwrap().query_map([],|row|row.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap()
    };
    let outbox = ledger(&fixture.db);
    let tombstones: Vec<String> = fixture.db.prepare("SELECT json_array(user_id,entity_type,entity_id,mutation_id,deleted_at) FROM tombstones ORDER BY entity_id").unwrap().query_map([],|row|row.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap();
    assert!(
        std::fs::metadata(previous.join("cadence.sqlite3-wal"))
            .unwrap()
            .len()
            > 0
    );
    adopt_previous_identity(&current).unwrap();
    let adopted = db::open(&current.join("cadence.sqlite3")).unwrap();
    assert_eq!(import::snapshot(&adopted, &profile).unwrap(), snapshot);
    assert_eq!(ledger(&adopted), outbox);
    let copied_tombstones: Vec<String> = adopted.prepare("SELECT json_array(user_id,entity_type,entity_id,mutation_id,deleted_at) FROM tombstones ORDER BY entity_id").unwrap().query_map([],|row|row.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap();
    assert_eq!(copied_tombstones, tombstones);
    assert_eq!(import::snapshot(&fixture.db, &profile).unwrap(), snapshot);
    assert!(source_path.exists());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(current.join("cadence.sqlite3"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    adopted
        .execute(
            "UPDATE profiles SET display_name='Final identity writes'",
            [],
        )
        .unwrap();
    adopt_previous_identity(&current).unwrap();
    assert_eq!(
        db::profile(&adopted).unwrap().display_name.as_deref(),
        Some("Final identity writes")
    );
    assert_eq!(db::profile(&fixture.db).unwrap().display_name, None);
}

#[test]
fn import_late_failure_rolls_back_products_but_keeps_failed_ledger_and_outbox() {
    let mut fixture = Fixture::new();
    let profile = fixture.profile.clone();
    let mut plan = import_plan(&profile);
    plan["mappings"][0]["local_id"] = json!(id(999));
    prepare_import(&mut fixture, plan);
    let failed = fixture.run(apply_import_request(), 101).unwrap();
    assert_eq!(failed["status"], "failed");
    assert!(failed["error"].as_str().unwrap().contains("provenance"));
    assert_eq!(fixture.count("behaviors"), 0);
    assert_eq!(fixture.count("occurrences"), 0);
    assert_eq!(fixture.count("behavior_definition_events"), 0);
    assert_eq!(fixture.count("behavior_configuration_events"), 0);
    assert_eq!(fixture.count("behaviorlog_import_record_mappings"), 0);
    assert_eq!(fixture.count("behaviorlog_import_runs"), 2);
    assert_eq!(fixture.count("mutation_outbox"), 3);
    assert_eq!(
        db::by_id::<BehaviorLogImportRun>(&fixture.db, &profile, &id(61))
            .unwrap()
            .status,
        "failed"
    );
}

#[test]
fn stale_import_preview_refuses_data_changes_and_retains_failed_attempt() {
    let mut fixture = Fixture::new();
    let profile = fixture.profile.clone();
    prepare_import(&mut fixture, import_plan(&profile));
    fixture.run(json!({"operation":"updateProfileTimezone","expectedTimezone":"America/New_York","expectedSyncVersion":0,"timezone":"Europe/London","updates":[]}),102).unwrap();
    let failed = fixture.run(apply_import_request(), 103).unwrap();
    assert_eq!(failed["status"], "failed");
    assert!(failed["error"].as_str().unwrap().contains("changed"));
    assert_eq!(fixture.count("behaviors"), 0);
}

#[test]
fn an_empty_preview_can_bind_one_mode_without_accepting_plan_substitution() {
    let mut fixture = Fixture::new();
    let profile = fixture.profile.clone();
    let prepared = prepare_import(&mut fixture, Value::Null);
    let before_outbox = fixture.count("mutation_outbox");
    assert_eq!(
        fixture.run(apply_import_request(), 101).unwrap_err(),
        "The preview has no applicable write plan."
    );
    assert_eq!(fixture.count("mutation_outbox"), before_outbox);
    let bound=fixture.run(json!({"operation":"prepareBehaviorLogImport","expectedRevision":prepared["revision"],"previewRun":prepared["previewRun"],"plan":import_plan(&profile)}),101).unwrap();
    assert_eq!(fixture.count("behaviors"), 0);
    let mut replacement = import_plan(&profile);
    replacement["graphWrites"][0]["graph"]["behavior"]["title"] = json!("Substituted title");
    assert!(fixture.run(json!({"operation":"prepareBehaviorLogImport","expectedRevision":bound["revision"],"previewRun":bound["previewRun"],"plan":replacement}),102).is_err());
    assert_eq!(
        fixture.run(apply_import_request(), 103).unwrap()["status"],
        "applied"
    );
    assert_eq!(
        db::by_id::<Behavior>(&fixture.db, &profile, &id(1))
            .unwrap()
            .title,
        "Walk"
    );
}

#[test]
fn accepted_restore_deletion_records_history_tombstones_without_partial_changes() {
    let mut fixture = Fixture::new();
    fixture.create();
    fixture.occurrence();
    let profile = fixture.profile.clone();
    fixture
        .run(
            status_request(&profile, "unresolved", None, "completed", 20, NOW),
            102,
        )
        .unwrap();
    fixture
        .run(
            status_request(
                &profile,
                "completed",
                Some(20),
                "unresolved",
                21,
                "2026-08-30T12:01:00Z",
            ),
            103,
        )
        .unwrap();
    let occurrence: Occurrence = db::by_id(&fixture.db, &profile, &id(10)).unwrap();
    assert!(fixture
        .db
        .execute(
            "UPDATE occurrence_status_events SET previous_status=NULL WHERE id=?1",
            [id(21)]
        )
        .is_err());
    let mut preview = import_run(&profile, 60, "restore_preview");
    preview["dry_run_summary"]["archiveFingerprint"] = json!("d".repeat(64));
    preview["dry_run_summary"]["statusHistoryPolicy"] =
        json!({"selected":"preserve_append_only_history","applySupportedInThisTicket":true});
    preview["dry_run_summary"]["summary"] = json!({"unsupportedActionCount":0,"skippedCount":0});
    preview["dry_run_summary"]["actions"] =
        json!({"occurrences":[{"localId":id(10),"externalId":null,"action":"delete"}]});
    let mut plan = import_plan(&profile);
    plan["mode"] = json!("restore_apply");
    plan["applyRun"]["import_mode"] = json!("restore_apply");
    plan["graphWrites"] = json!([]);
    plan["definitionEvents"] = json!([]);
    plan["occurrenceWrites"] = json!([]);
    plan["occurrenceDeletes"] = json!([occurrence]);
    plan["mappings"] = json!([]);
    let revision = import::domain_revision(&fixture.db, &profile).unwrap();
    let mut unreviewed = preview.clone();
    unreviewed["dry_run_summary"]["actions"] = json!({});
    assert!(fixture.run(json!({"operation":"prepareBehaviorLogImport","expectedRevision":revision,"previewRun":unreviewed,"plan":plan}),104).is_err());
    fixture.run(json!({"operation":"prepareBehaviorLogImport","expectedRevision":revision,"previewRun":preview,"plan":plan}),104).unwrap();
    let mut apply = apply_import_request();
    apply["importMode"] = json!("restore_apply");
    apply["bundlePayloadFingerprint"] = json!("d".repeat(64));
    let result = fixture.run(apply, 105).unwrap();
    assert_eq!(result["status"], "applied", "{result}");
    assert_eq!(fixture.count("occurrences"), 0);
    assert_eq!(fixture.count("occurrence_status_events"), 0);
    assert_eq!(fixture.count("tombstones"), 3);
    assert_eq!(fixture.count("behaviors"), 1);
}

#[test]
fn reminder_reconciliation_and_sync_metadata_do_not_stale_import_preview() {
    let mut fixture = Fixture::new();
    let profile = fixture.profile.clone();
    let prepared = prepare_import(&mut fixture, import_plan(&profile));
    let global = reminder::revision(&fixture.db, &profile).unwrap();
    let intent=fixture.run(json!({"operation":"commitNativeReminderPlan","expectedRevision":global,"reminders":[],"cancelIds":[]}),101).unwrap();
    fixture.run(json!({"operation":"recordNativeReminderCoverage","expectedRevision":intent["revision"],"coverage":{"status":"complete","target_through":"2026-09-29T12:00:00Z","scheduled_through":"2026-09-29T12:00:00Z","first_unscheduled_at":null,"expected_count":0,"scheduled_count":0,"missing_ids":[],"reason":null,"verified_at":NOW},"observed":[]}),102).unwrap();
    let mut state = db::owned::<OccurrenceSyncState>(&fixture.db, &profile)
        .unwrap()
        .remove(0);
    state.stale = false;
    state.stale_reason = None;
    state.last_synced_local_date = Some("2026-08-30".into());
    state.synced_through_local_date = Some("2026-09-29".into());
    state.last_successful_sync_at = Some(NOW.into());
    fixture
        .run(
            json!({"operation":"commitSyncState","expectedVersion":0,"state":state}),
            103,
        )
        .unwrap();
    assert_eq!(
        import::domain_revision(&fixture.db, &profile).unwrap(),
        prepared["revision"]
    );
    assert_eq!(
        fixture.run(apply_import_request(), 104).unwrap()["status"],
        "applied"
    );
}

#[test]
fn category_management_preserves_history_and_rolls_back_stale_deletion() {
    let mut fixture = Fixture::new();
    let categories: Vec<Category> = db::owned(&fixture.db, &fixture.profile).unwrap();
    let target = categories[0].id.clone();
    let snapshot = |rows: &[Category]| {
        rows.iter().map(|row| json!({"id":row.id,"name":row.name,"description":row.description,"sort_order":row.sort_order,"updated_at":row.updated_at})).collect::<Vec<_>>()
    };
    let mut initial = create_request(&fixture.profile);
    initial["graph"]["behavior"]["category_id"] = json!(target);
    initial["configurationEvent"]["next_configuration"]["categoryId"] = json!(target);
    let mut graph = fixture.run(initial.clone(), 500).unwrap();
    graph.as_object_mut().unwrap().remove("revision");
    fixture.occurrence();
    let outbox = fixture.count("mutation_outbox");
    let mut event = initial["configurationEvent"].clone();
    event["id"] = json!(id(501));
    event["event_kind"] = json!("revision");
    event["previous_configuration"] = initial["configurationEvent"]["next_configuration"].clone();
    event["next_configuration"]["categoryId"] = Value::Null;
    event["changed_fields"] = json!(["category_id"]);
    event["reason_code"] = json!("category_changed");
    graph["behavior"]["category_id"] = Value::Null;
    graph["behavior"]["current_configuration_event_id"] = json!(id(501));
    let next = snapshot(&categories)
        .into_iter()
        .filter(|row| row["id"] != target)
        .collect::<Vec<_>>();
    let request = json!({"operation":"manageCategories","expectedCategories":snapshot(&categories),"nextCategories":next,
      "updates":[{"graph":graph,"expectedRevision":1,"configurationEvent":event}]});
    let mut stale = request.clone();
    stale["updates"][0]["expectedRevision"] = json!(999);
    assert!(fixture.run(stale, 502).is_err());
    assert_eq!(fixture.count("mutation_outbox"), outbox);
    fixture.run(request, 503).unwrap();
    assert_eq!(fixture.count("categories"), 7);
    assert_eq!(fixture.count("behavior_configuration_events"), 2);
    assert_eq!(fixture.count("occurrences"), 1);
    assert_eq!(fixture.count("tombstones"), 1);
    let retained: BehaviorConfigurationEvent = db::by_id(
        &fixture.db,
        &fixture.profile,
        &initial["configurationEvent"]["id"]
            .as_str()
            .unwrap()
            .to_string(),
    )
    .unwrap();
    assert_eq!(retained.next_configuration["categoryId"], target);
}

#[test]
fn category_upgrade_preserves_duplicate_ids_and_rejects_invalid_new_names() {
    let mut fixture = Fixture::at_schema(10);
    fixture.db.execute("INSERT INTO categories(id,user_id,name,sort_order,created_at,updated_at) VALUES(?1,?2,'home',40,?3,?3)", params![id(601),fixture.profile,NOW]).unwrap();
    db::migrate(&mut fixture.db, db::MIGRATIONS).unwrap();
    let category = db::by_id::<Category>(&fixture.db, &fixture.profile, &id(601)).unwrap();
    assert_eq!(category.name, format!("home [{}]", id(601)));
    assert_eq!(category.description, None);
    assert_eq!(fixture.count("categories"), 9);
    for name in ["", " HOME ", "Home", "Invalid\nName"] {
        assert!(fixture.db.execute("INSERT INTO categories(id,user_id,name,sort_order,created_at,updated_at) VALUES(?1,?2,?3,50,?4,?4)",params![id(602),fixture.profile,name,NOW]).is_err());
    }
    let reopened = db::open(&fixture.directory.join("data.sqlite3")).unwrap();
    assert_eq!(
        db::by_id::<Category>(&reopened, &fixture.profile, &id(601)).unwrap(),
        category
    );
}

#[test]
fn configuration_location_migration_canonicalizes_pre_travel_history() {
    // Schema 16 predates 0017; the current Behavior row needs a temporary where_kind column.
    let mut fixture = Fixture::at_schema(16);
    fixture
        .db
        .execute_batch("ALTER TABLE behaviors ADD COLUMN where_kind TEXT;")
        .unwrap();
    fixture.create();
    fixture
        .db
        .execute_batch(
            "ALTER TABLE behaviors DROP COLUMN where_kind;
             DROP TRIGGER behavior_configuration_events_append_only;
             UPDATE behavior_configuration_events SET
               next_configuration = json_remove(next_configuration, '$.location_text', '$.locationText', '$.whereKind'),
               changed_fields = (SELECT json_group_array(value) FROM json_each(changed_fields) WHERE value NOT IN ('location_text'));
             INSERT INTO behavior_configuration_events
               SELECT behavior_id, '[\"active\"]', created_at, effective_at, effective_local_date, 'revision',
                 'revision-event', next_configuration, json_set(next_configuration, '$.active', json('false')), reason_code, recorded_at, source, timezone, user_id
               FROM behavior_configuration_events WHERE event_kind = 'baseline';
             CREATE TRIGGER behavior_configuration_events_append_only BEFORE UPDATE ON behavior_configuration_events BEGIN SELECT RAISE(ABORT, 'History rows are append-only.'); END;",
        )
        .unwrap();
    db::migrate(&mut fixture.db, db::MIGRATIONS).unwrap();
    let rows: Vec<(String, Option<String>, String, String)> = fixture
        .db
        .prepare("SELECT event_kind, previous_configuration, next_configuration, changed_fields FROM behavior_configuration_events ORDER BY event_kind")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
        .unwrap()
        .map(|row| row.unwrap())
        .collect();
    assert_eq!(rows.len(), 2);
    for (kind, previous, next, fields) in rows {
        let next: Value = serde_json::from_str(&next).unwrap();
        assert_eq!(next["location_text"], Value::Null);
        assert!(next.as_object().unwrap().contains_key("location_text"));
        let fields: Vec<String> = serde_json::from_str(&fields).unwrap();
        if kind == "baseline" {
            assert_eq!(fields.last().map(String::as_str), Some("location_text"));
            assert_eq!(fields.iter().filter(|field| *field == "location_text").count(), 1);
        } else {
            assert_eq!(fields, vec!["active".to_string()]);
            let previous: Value = serde_json::from_str(&previous.unwrap()).unwrap();
            assert!(previous.as_object().unwrap().contains_key("location_text"));
        }
    }
}

#[test]
fn behavior_where_migration_backfills_place_without_rewriting_history() {
    // Schema 17 predates 0018; the current Behavior row needs a temporary where_kind column.
    let mut fixture = Fixture::at_schema(17);
    fixture
        .db
        .execute_batch("ALTER TABLE behaviors ADD COLUMN where_kind TEXT;")
        .unwrap();
    fixture.create();
    fixture
        .db
        .execute_batch(
            "UPDATE behaviors SET location_text = '1 Example Street';
             ALTER TABLE behaviors DROP COLUMN where_kind;",
        )
        .unwrap();
    let history = |db: &Connection| -> String {
        db.query_row("SELECT json_group_array(json_array(id, previous_configuration, next_configuration, changed_fields)) FROM (SELECT * FROM behavior_configuration_events ORDER BY id)", [], |row| row.get(0)).unwrap()
    };
    let before = history(&fixture.db);
    db::migrate(&mut fixture.db, db::MIGRATIONS).unwrap();
    let where_kind: Option<String> = fixture
        .db
        .query_row("SELECT where_kind FROM behaviors", [], |row| row.get(0))
        .unwrap();
    assert_eq!(where_kind.as_deref(), Some("place"));
    assert_eq!(history(&fixture.db), before);
    assert!(fixture
        .db
        .execute("UPDATE behaviors SET where_kind = 'home'", [])
        .is_err());
    assert!(fixture
        .db
        .execute("UPDATE behaviors SET location_text = NULL", [])
        .is_err());
    fixture
        .db
        .execute("UPDATE behaviors SET where_kind = 'home', location_text = NULL", [])
        .unwrap();
    assert!(fixture
        .db
        .execute("UPDATE behaviors SET where_kind = 'elsewhere', location_text = NULL", [])
        .is_err());
}

fn place_settings(profile: &str, enabled: bool) -> Value {
    json!({"user_id":profile,"id":"place_labels","enabled":enabled,"retention":"90_days",
        "enabled_at":if enabled { json!(NOW) } else { Value::Null },"marker_prompt_dismissed_at":null,"updated_at":NOW})
}
fn place_mutation(mutation: Value) -> Value {
    json!({"operation":"commitPlaceLabels","mutation":mutation})
}

#[test]
fn place_labels_follow_opt_in_completion_and_opt_out() {
    let mut fixture = Fixture::new();
    fixture.create();
    fixture.occurrence();
    let profile = fixture.profile.clone();
    let marker = json!({"user_id":profile,"id":"home","place_key":"k".repeat(43),"latitude_e6":41878100,
        "longitude_e6":-87629800,"accuracy_meters":20,"rule_version":"place-label-rules@1","recorded_at":NOW});
    let label = json!({"id":id(10),"user_id":profile,"behavior_id":id(1),"local_date":"2026-08-31","label":"home",
        "rule_version":"place-label-rules@1","recorded_at":NOW});
    let upsert_marker = place_mutation(json!({"kind":"upsertMarker","marker":marker}));
    let insert_label = place_mutation(json!({"kind":"insertLabel","label":label}));
    // Off by default: nothing location-derived can be stored.
    assert!(fixture.run(upsert_marker.clone(), 300).unwrap_err().contains("constraint"));
    fixture.run(place_mutation(json!({"kind":"saveSettings","expectedUpdatedAt":null,
        "next":place_settings(&profile, true),"retentionCutoff":null})), 301).unwrap();
    fixture.run(upsert_marker.clone(), 302).unwrap();
    assert!(fixture.run(insert_label.clone(), 303).unwrap_err().contains("constraint"));
    fixture.run(status_request(&profile, "unresolved", None, "completed", 20, "2026-08-31T13:05:00Z"), 304).unwrap();
    fixture.run(insert_label.clone(), 305).unwrap();
    assert_eq!(fixture.count("completion_place_labels"), 1);
    // Leaving Completed deletes the label in the same transaction.
    fixture.run(status_request(&profile, "completed", Some(20), "not_completed", 21, "2026-08-31T13:06:00Z"), 306).unwrap();
    assert_eq!(fixture.count("completion_place_labels"), 0);
    fixture.run(status_request(&profile, "not_completed", Some(21), "completed", 22, "2026-08-31T13:07:00Z"), 307).unwrap();
    fixture.run(insert_label.clone(), 308).unwrap();
    // A shorter retention deletes older labels in the same save.
    fixture.run(place_mutation(json!({"kind":"saveSettings","expectedUpdatedAt":NOW,
        "next":place_settings(&profile, true),"retentionCutoff":"2026-09-01"})), 309).unwrap();
    assert_eq!(fixture.count("completion_place_labels"), 0);
    fixture.run(insert_label, 310).unwrap();
    let state = place_labels::read(&fixture.db, &profile).unwrap();
    assert_eq!(state["markers"].as_array().unwrap().len(), 1);
    assert_eq!(state["labels"][0]["label"], "home");
    // Turning labels off deletes labels and markers; settings must match the stored revision.
    assert!(fixture.run(place_mutation(json!({"kind":"saveSettings","expectedUpdatedAt":null,
        "next":place_settings(&profile, false),"retentionCutoff":null})), 311).unwrap_err().contains("changed"));
    fixture.run(place_mutation(json!({"kind":"saveSettings","expectedUpdatedAt":NOW,
        "next":place_settings(&profile, false),"retentionCutoff":null})), 312).unwrap();
    assert_eq!(fixture.count("completion_place_labels"), 0);
    assert_eq!(fixture.count("place_markers"), 0);
    assert!(fixture.run(upsert_marker, 313).unwrap_err().contains("constraint"));
}

#[test]
fn place_label_migration_adds_constrained_tables_without_touching_tracking() {
    let mut fixture = Fixture::at_schema(18);
    fixture.create();
    let before: i64 = fixture.db.query_row("SELECT count(*) FROM behaviors", [], |row| row.get(0)).unwrap();
    db::migrate(&mut fixture.db, db::MIGRATIONS).unwrap();
    assert_eq!(fixture.count("behaviors"), before);
    assert_eq!(fixture.count("place_label_settings"), 0);
    let profile = fixture.profile.clone();
    fixture.db.execute("INSERT INTO place_label_settings(user_id,enabled,retention,enabled_at,updated_at) VALUES(?1,1,'90_days',?2,?2)", params![profile, NOW]).unwrap();
    for (id, key, accuracy) in [("saved_place:".to_string() + &"a".repeat(43), "b".repeat(43), 10), ("home".into(), "c".repeat(43), 101), ("home".into(), "bad key".into(), 10)] {
        assert!(fixture.db.execute("INSERT INTO place_markers VALUES(?1,?2,?3,0,0,?4,'place-label-rules@1',?5)", params![profile, id, key, accuracy, NOW]).is_err());
    }
    fixture.db.execute("INSERT INTO place_markers VALUES(?1,'home',?2,0,0,100,'place-label-rules@1',?3)", params![profile, "c".repeat(43), NOW]).unwrap();
    assert!(fixture.db.execute("INSERT INTO where_suggestion_dismissals VALUES(?1,?2,'nearby','where-suggestion-rules@1',?3)", params![id(1), profile, NOW]).is_err());
    fixture.db.execute("INSERT INTO where_suggestion_dismissals VALUES(?1,?2,'anywhere','where-suggestion-rules@1',?3)", params![id(1), profile, NOW]).unwrap();
}

#[test]
fn account_sync_applies_place_label_rows_in_dependency_order() {
    use super::sync_apply::{AccountSyncEntityKind as Kind, AccountSyncOperation as Op};
    let mut fixture = Fixture::new();
    fixture.create();
    let occurrence = fixture.occurrence();
    let profile = fixture.profile.clone();
    let mut completed = serde_json::to_value(&occurrence).unwrap();
    let expected_occurrence = {
        let mut value = completed.clone();
        value.as_object_mut().unwrap().remove("user_id");
        value.as_object_mut().unwrap().remove("schedule_range_identity");
        for key in ["created_at", "updated_at", "scheduled_for"] {
            value[key] = json!(value[key].as_str().unwrap().replace("Z", ".000000Z"));
        }
        value
    };
    completed.as_object_mut().unwrap().remove("user_id");
    completed.as_object_mut().unwrap().remove("schedule_range_identity");
    completed["status"] = json!("completed");
    completed["completed_at"] = json!("2026-08-31T13:05:00.000000Z");
    completed["status_marked_at"] = json!("2026-08-31T13:05:00.000000Z");
    let event = json!({"id":id(20),"occurrence_id":id(10),"behavior_id":id(1),"previous_status":"unresolved","status":"completed",
        "status_semantics":"explicit_user_mark","recorded_at":"2026-08-31T13:05:00.000000Z","effective_at":"2026-08-31T13:05:00.000000Z",
        "local_date":"2026-08-31","timezone":"America/New_York","source_capture_method":"manual_tap","source_confidence":"high",
        "revises_event_id":null,"reason_code":null,"created_at":"2026-08-31T13:05:00.000000Z","updated_at":"2026-08-31T13:05:00.000000Z"});
    let write = |kind: Kind, id: &str, value: Value| AccountSyncWrite { kind, id: id.into(), operation: Op::Upsert, expected: None, value: Some(value) };
    let settings = {
        let mut value = place_settings(&profile, true);
        value.as_object_mut().unwrap().remove("user_id");
        value
    };
    let label = json!({"id":id(10),"behavior_id":id(1),"local_date":"2026-08-31","label":"elsewhere","rule_version":"place-label-rules@1","recorded_at":NOW});
    let marker_id = format!("saved_place:{}", "a".repeat(43));
    let marker = json!({"id":marker_id,"place_key":"a".repeat(43),"latitude_e6":1,"longitude_e6":2,"accuracy_meters":3,"rule_version":"place-label-rules@1","recorded_at":NOW});
    let mut occurrence_write = write(Kind::Occurrence, &id(10), completed);
    occurrence_write.expected = Some(expected_occurrence);
    execute(&mut fixture.db, Request::ApplyAccountSync { profile_id: profile.clone(), writes: vec![
        write(Kind::CompletionPlaceLabel, &id(10), label),
        write(Kind::PlaceMarker, &marker_id, marker),
        write(Kind::StatusEvent, &id(20), event),
        occurrence_write,
        write(Kind::PlaceLabelSettings, "place_labels", settings),
    ] }).unwrap();
    assert_eq!(fixture.count("completion_place_labels"), 1);
    assert_eq!(fixture.count("place_markers"), 1);
    assert!(sync_apply::validate_snapshot(&profile, &[]).is_ok());
    // An unknown marker name is rejected before any write.
    let failure = execute(&mut fixture.db, Request::ApplyAccountSync { profile_id: profile, writes: vec![
        write(Kind::PlaceMarker, "office", json!({"id":"office"})),
    ] }).unwrap_err();
    assert!(!failure.is_empty());
}
