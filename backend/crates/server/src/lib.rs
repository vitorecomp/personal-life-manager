//! Unified `HERMES // OS` HTTP/SSE/MCP server library entrypoint.

pub fn banner() -> String {
    format!(
        "HERMES // OS v{} (gateway default: {})",
        hermes_domain::SYSTEM_VERSION,
        hermes_intelligence::DEFAULT_HERMES_GATEWAY_URL
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn banner_includes_version() {
        assert!(banner().contains("1.0.0"));
    }
}
