use rusqlite::Connection;
use std::{fs, path::PathBuf, process::Command, time::{SystemTime, UNIX_EPOCH}};

struct Fixture(PathBuf);
impl Drop for Fixture {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}

#[test]
fn binary_indexes_only_selected_profile_into_separate_output() {
    let root = Fixture(std::env::temp_dir().join(format!("jstack-recall-profile-{}-{}",
        std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos())));
    let home = root.0.join("home");
    let alternate = root.0.join("alternate profile");
    for (profile, id) in [(home.join(".claude"), "normal"), (alternate.clone(), "alternate")] {
        let project = profile.join("projects/project");
        fs::create_dir_all(&project).unwrap();
        fs::write(project.join("session.jsonl"), format!(
            "{{\"type\":\"user\",\"sessionId\":\"{id}\",\"timestamp\":\"2026-09-07T00:00:00Z\",\"message\":{{\"content\":\"{id} evidence\"}}}}\n"
        )).unwrap();
    }
    for (label, config, expected) in [
        ("default", None, "normal"),
        ("empty", Some(""), "normal"),
        ("alternate", Some(alternate.to_str().unwrap()), "alternate"),
    ] {
        let vault = root.0.join(format!("output-{label}"));
        let mut command = Command::new(env!("CARGO_BIN_EXE_sync"));
        command.env("HOME", &home).env("CLAUDE_SESSIONS_PATH", &vault)
            .env_remove("CLAUDE_CONFIG_DIR");
        if let Some(value) = config { command.env("CLAUDE_CONFIG_DIR", value); }
        let result = command.output().unwrap();
        assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
        let connection = Connection::open(vault.join(".metadata.db")).unwrap();
        let mut query = connection.prepare("SELECT session_id FROM sessions ORDER BY session_id").unwrap();
        let ids: Vec<String> = query.query_map([], |row| row.get(0)).unwrap().map(Result::unwrap).collect();
        assert_eq!(ids, vec![expected.to_string()]);
        assert!(fs::read_to_string(vault.join(format!("sessions/{expected}.md"))).unwrap()
            .contains(&format!("{expected} evidence")));
    }
}
