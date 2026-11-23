//! Configuration for `hermes-life-ops` repositories and engines.

use std::path::PathBuf;

use crate::test_support::TestDb;

#[derive(Debug, Clone)]
pub struct LifeOpsConfig {
    pub database_url: String,
    pub redis_url: Option<String>,
    pub second_brain_dir: PathBuf,
    pub youtube_lists_db: PathBuf,
    pub youtube_lists_notes_dir: PathBuf,
    pub admin_user: String,
    pub admin_password: String,
    pub bootstrap_pat: Option<String>,
    pub require_web_login: bool,
    pub public_base_url: String,
    pub fx_api_url: Option<String>,
    pub quote_api_url: Option<String>,
    pub hermes_gateway_url: String,
}

impl Default for LifeOpsConfig {
    fn default() -> Self {
        Self::from_env()
    }
}

impl LifeOpsConfig {
    pub fn from_env() -> Self {
        let database_url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://hermes:hermes@127.0.0.1:5432/hermes_os".to_string());
        let redis_url = std::env::var("REDIS_URL")
            .ok()
            .or_else(|| Some("redis://127.0.0.1:6379".to_string()));
        let manifest_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .unwrap_or_else(|| std::path::Path::new("."));
        let repo_root = if manifest_root.join("data").exists() {
            manifest_root
        } else {
            manifest_root.parent().unwrap_or(manifest_root)
        };
        let second_brain_dir = std::env::var("SECOND_BRAIN_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| repo_root.join("data/second-brain"));
        let youtube_lists_db = std::env::var("YOUTUBE_LISTS_DB")
            .map(PathBuf::from)
            .unwrap_or_else(|_| repo_root.join("data/database/youtube-lists.sqlite"));
        let youtube_lists_notes_dir = std::env::var("YOUTUBE_LISTS_NOTES_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| repo_root.join("data/knowledge-data/youtube"));
        let admin_user = std::env::var("HERMES_ADMIN_USER")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "operator".to_string());
        let admin_password = std::env::var("HERMES_ADMIN_PASSWORD")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "hermes-os-local".to_string());
        let bootstrap_pat = std::env::var("HERMES_BOOTSTRAP_PAT")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let require_web_login = std::env::var("REQUIRE_WEB_LOGIN")
            .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(false);
        let public_base_url = std::env::var("PUBLIC_BASE_URL")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "http://127.0.0.1:8080".to_string());
        let fx_api_url = std::env::var("FX_API_URL").ok().filter(|v| !v.trim().is_empty());
        let quote_api_url = std::env::var("QUOTE_API_URL").ok().filter(|v| !v.trim().is_empty());
        let hermes_gateway_url = std::env::var("HERMES_GATEWAY_URL")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "http://127.0.0.1:8642/v1".to_string());

        Self {
            database_url,
            redis_url,
            second_brain_dir,
            youtube_lists_db,
            youtube_lists_notes_dir,
            admin_user,
            admin_password,
            bootstrap_pat,
            require_web_login,
            public_base_url,
            fx_api_url,
            quote_api_url,
            hermes_gateway_url,
        }
    }

    pub fn from_test_db(test_db: &TestDb) -> Self {
        Self {
            database_url: format!("postgres://hermes:hermes@127.0.0.1:5432/{}", test_db.db_name),
            redis_url: Some("redis://127.0.0.1:6379".to_string()),
            second_brain_dir: test_db.second_brain_dir.clone(),
            youtube_lists_db: test_db.youtube_lists_db.clone(),
            youtube_lists_notes_dir: test_db.youtube_lists_notes_dir.clone(),
            admin_user: "operator".to_string(),
            admin_password: "hermes-os-local".to_string(),
            bootstrap_pat: None,
            require_web_login: false,
            public_base_url: "http://127.0.0.1:8080".to_string(),
            fx_api_url: None,
            quote_api_url: None,
            hermes_gateway_url: "http://127.0.0.1:8642/v1".to_string(),
        }
    }
}
