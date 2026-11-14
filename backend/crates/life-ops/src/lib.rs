//! SQLx repositories and Life Operations engines (`03`, `07`–`11`, Auth, Sync, Server Prober).

pub use hermes_domain::SYSTEM_VERSION;

pub const MOBILE_SYNC_TABLES: [&str; 8] = [
    "projects",
    "tasks",
    "time_sessions",
    "routines",
    "routine_items",
    "routine_logs",
    "daily_checkins",
    "companion_offline_phrases",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mobile_sync_scope_has_eight_tables() {
        assert_eq!(MOBILE_SYNC_TABLES.len(), 8);
    }
}
