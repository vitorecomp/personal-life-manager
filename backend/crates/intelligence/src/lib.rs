//! `hermes gateway` SSE/runs client, `/mcp` (`rmcp`) tool server, Knights runner, and Vault watcher.

pub const DEFAULT_HERMES_GATEWAY_URL: &str = "http://127.0.0.1:8642/v1";

pub const MCP_DOMAINS: [&str; 7] = [
    "dashboards",
    "todos",
    "routines",
    "goals",
    "courses",
    "finance",
    "servers",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_exposes_seven_life_ops_domains() {
        assert_eq!(MCP_DOMAINS.len(), 7);
    }
}
