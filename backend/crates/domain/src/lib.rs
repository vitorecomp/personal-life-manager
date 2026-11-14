//! Pure domain models, reconciled enums, and OpenAPI schemas for `HERMES // OS`.

pub const SYSTEM_VERSION: &str = "1.0.0";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_version_matches_contract() {
        assert_eq!(SYSTEM_VERSION, "1.0.0");
    }
}
