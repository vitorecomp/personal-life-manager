//! UUIDv7 identifier generation and mobile sync scope constants.

use rust_decimal::Decimal;
use uuid::Uuid;

pub const SYSTEM_VERSION: &str = "1.0.0";

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

/// Generate a monotonically ordered RFC 9562 UUIDv7 using the shared process context.
#[inline]
pub fn new_uuid_v7() -> Uuid {
    Uuid::now_v7()
}

/// Check if a UUID is version 7.
#[inline]
pub fn is_uuid_v7(id: &Uuid) -> bool {
    id.get_version_num() == 7
}

/// Validate if an entity table name belongs to the 8 mobile-synced tables.
#[inline]
pub fn is_mobile_sync_table(table: &str) -> bool {
    MOBILE_SYNC_TABLES.contains(&table)
}

/// Convert integer cents (`i64`) to a `Decimal` major currency amount (`cents / 100`).
#[inline]
pub fn cents_to_decimal(cents: i64) -> Decimal {
    Decimal::new(cents, 2)
}
