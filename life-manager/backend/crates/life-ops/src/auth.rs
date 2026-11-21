//! Feature F07 — Operator Auth (`argon2id`), `web_sessions`, revocable `SHA-256` PATs (`plm_pat_...`),
//! `verify_pat_or_session`, and Desktop Pairing QR generation.

use argon2::{
    Argon2,
    password_hash::{PasswordHasher, PasswordVerifier, phc::PasswordHash},
};
use chrono::{Duration, Utc};
use hermes_domain::{
    auth::{
        ApiTokenSummary, AuthVerifyResponse, CreatePatRequest, CreatedPatResponse, LoginResponse,
        PairingQrRequest, PairingQrResponse, User,
    },
    error::ApiError,
    id::new_uuid_v7,
};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use crate::service::LifeOpsService;

/// Hash an operator password using `argon2 0.6.0` (`Argon2id` v19 with 16-byte CSPRNG salt).
pub fn hash_password_argon2id(password: &str) -> Result<String, ApiError> {
    if password.trim().is_empty() {
        return Err(ApiError::bad_request("Password must not be empty"));
    }
    Argon2::default()
        .hash_password(password.as_bytes())
        .map(|h| h.to_string())
        .map_err(|e| ApiError::internal(format!("Argon2 hash error: {e}")))
}

/// Verify a plaintext password against a stored `argon2id` PHC string.
pub fn verify_password_argon2id(password: &str, stored_phc: &str) -> Result<bool, ApiError> {
    let parsed = PasswordHash::new(stored_phc)
        .map_err(|_| ApiError::unauthorized("Invalid credentials"))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

/// Compute lowercase 64-character SHA-256 hex digest of an input string.
pub fn sha256_hex(input: &str) -> String {
    let digest = Sha256::digest(input.as_bytes());
    hex::encode(digest)
}

/// Generate a new `plm_pat_<32_lowercase_hex>` secret, display prefix, and 64-char SHA-256 hex digest.
pub fn generate_pat_secret() -> (String, String, String) {
    let mut raw = [0u8; 16];
    rand::fill(&mut raw);
    let hex_secret = hex::encode(raw);
    let full_token = format!("plm_pat_{hex_secret}");
    let token_prefix = format!("plm_pat_{}...", &hex_secret[..8]);
    let token_sha256 = sha256_hex(&full_token);
    (full_token, token_prefix, token_sha256)
}

/// Generate a new `hermes_sess_<32_lowercase_hex>` session token and its 64-char SHA-256 hex digest.
pub fn generate_session_secret() -> (String, String) {
    let mut raw = [0u8; 16];
    rand::fill(&mut raw);
    let hex_secret = hex::encode(raw);
    let session_token = format!("hermes_sess_{hex_secret}");
    let session_sha256 = sha256_hex(&session_token);
    (session_token, session_sha256)
}

fn extract_pat_prefix(raw_token: &str) -> String {
    let trimmed = raw_token.trim();
    if trimmed.len() >= 16 {
        format!("{}...", &trimmed[..16])
    } else {
        format!("{trimmed}...")
    }
}

impl LifeOpsService {
    /// Idempotently seeds or refreshes the single-owner admin account (`HERMES_ADMIN_USER` / `HERMES_ADMIN_PASSWORD`).
    pub async fn ensure_admin_user(&self) -> Result<User, ApiError> {
        let username = self.config.admin_user.trim();
        let password = self.config.admin_password.as_str();
        if username.is_empty() {
            return Err(ApiError::bad_request("Admin username must not be empty"));
        }

        let existing = sqlx::query(
            "SELECT id, username, password_hash, display_name, role, created_at, updated_at \
             FROM users WHERE username = $1",
        )
        .bind(username)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(row) = existing {
            let id: Uuid = row.try_get("id")?;
            let stored_hash: String = row.try_get("password_hash")?;
            let matches = verify_password_argon2id(password, &stored_hash).unwrap_or(false);
            if matches {
                let user = sqlx::query_as::<_, User>(
                    "SELECT id, username, display_name, role, created_at, updated_at \
                     FROM users WHERE id = $1",
                )
                .bind(id)
                .fetch_one(&self.pool)
                .await?;
                return Ok(user);
            }

            let fresh_hash = hash_password_argon2id(password)?;
            let updated = sqlx::query_as::<_, User>(
                "UPDATE users SET password_hash = $2, updated_at = NOW() \
                 WHERE id = $1 \
                 RETURNING id, username, display_name, role, created_at, updated_at",
            )
            .bind(id)
            .bind(fresh_hash)
            .fetch_one(&self.pool)
            .await?;
            return Ok(updated);
        }

        let new_id = new_uuid_v7();
        let fresh_hash = hash_password_argon2id(password)?;
        let created = sqlx::query_as::<_, User>(
            "INSERT INTO users (id, username, password_hash, display_name, role) \
             VALUES ($1, $2, $3, 'Operator', 'admin') \
             ON CONFLICT (username) DO UPDATE \
             SET password_hash = EXCLUDED.password_hash, updated_at = NOW() \
             RETURNING id, username, display_name, role, created_at, updated_at",
        )
        .bind(new_id)
        .bind(username)
        .bind(fresh_hash)
        .fetch_one(&self.pool)
        .await?;

        Ok(created)
    }

    /// Idempotently registers `HERMES_BOOTSTRAP_PAT` (storing only its SHA-256 digest in `api_tokens`).
    pub async fn ensure_bootstrap_pat(&self) -> Result<Option<ApiTokenSummary>, ApiError> {
        let Some(raw_token) = self.config.bootstrap_pat.as_deref() else {
            return Ok(None);
        };
        let trimmed = raw_token.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }

        let admin = self.ensure_admin_user().await?;
        let token_sha256 = sha256_hex(trimmed);
        let token_prefix = extract_pat_prefix(trimmed);
        let id = new_uuid_v7();
        let scopes = vec!["*".to_string()];

        let summary = sqlx::query_as::<_, ApiTokenSummary>(
            "INSERT INTO api_tokens (id, user_id, name, token_prefix, token_sha256, scopes) \
             VALUES ($1, $2, 'Bootstrap PAT', $3, $4, $5) \
             ON CONFLICT (token_sha256) DO UPDATE \
             SET revoked_at = NULL, updated_at = NOW() \
             RETURNING id, name, token_prefix, scopes, last_used_at, revoked_at, created_at",
        )
        .bind(id)
        .bind(admin.id)
        .bind(token_prefix)
        .bind(token_sha256)
        .bind(scopes)
        .fetch_one(&self.pool)
        .await?;

        Ok(Some(summary))
    }

    /// Authenticate with username and password (`argon2id`) and issue a 30-day `web_sessions` token.
    pub async fn login_password(
        &self,
        username: &str,
        password: &str,
    ) -> Result<LoginResponse, ApiError> {
        let trimmed_user = username.trim();
        if trimmed_user.is_empty() || password.is_empty() {
            return Err(ApiError::unauthorized("Invalid username or password"));
        }

        let row = sqlx::query(
            "SELECT id, password_hash FROM users WHERE username = $1",
        )
        .bind(trimmed_user)
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else {
            return Err(ApiError::unauthorized("Invalid username or password"));
        };

        let user_id: Uuid = row.try_get("id")?;
        let password_hash: String = row.try_get("password_hash")?;
        if !verify_password_argon2id(password, &password_hash)? {
            return Err(ApiError::unauthorized("Invalid username or password"));
        }

        let user = sqlx::query_as::<_, User>(
            "SELECT id, username, display_name, role, created_at, updated_at \
             FROM users WHERE id = $1",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        let (session_token, session_sha256) = generate_session_secret();
        let session_id = new_uuid_v7();
        let expires_at = Utc::now() + Duration::days(30);

        sqlx::query(
            "INSERT INTO web_sessions (id, user_id, session_token_sha256, expires_at) \
             VALUES ($1, $2, $3, $4)",
        )
        .bind(session_id)
        .bind(user.id)
        .bind(session_sha256)
        .bind(expires_at)
        .execute(&self.pool)
        .await?;

        Ok(LoginResponse {
            authenticated: true,
            user,
            token: session_token.clone(),
            session_token,
            expires_at,
        })
    }

    /// Revoke a web session token on logout.
    pub async fn logout_session(&self, raw_token: &str) -> Result<(), ApiError> {
        let cleaned = strip_bearer(raw_token);
        if cleaned.is_empty() {
            return Ok(());
        }
        let hash = sha256_hex(cleaned);
        sqlx::query(
            "UPDATE web_sessions SET revoked_at = NOW() \
             WHERE session_token_sha256 = $1 AND revoked_at IS NULL",
        )
        .bind(hash)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Return the currently authenticated operator `User` (from session/PAT, or local operator when `require_web_login = false`).
    pub async fn get_me(&self, raw_credential: Option<&str>) -> Result<User, ApiError> {
        if let Some(cred) = raw_credential.map(strip_bearer).filter(|s| !s.is_empty()) {
            let _verified = self.verify_pat_or_session(Some(cred)).await?;
            let hash = sha256_hex(cred);
            if !cred.starts_with("plm_pat_") {
                if let Some(user) = sqlx::query_as::<_, User>(
                    "SELECT u.id, u.username, u.display_name, u.role, u.created_at, u.updated_at \
                     FROM web_sessions s JOIN users u ON u.id = s.user_id \
                     WHERE s.session_token_sha256 = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()",
                )
                .bind(&hash)
                .fetch_optional(&self.pool)
                .await?
                {
                    return Ok(user);
                }
            }
        } else if self.config.require_web_login {
            return Err(ApiError::unauthorized("Authentication required"));
        }

        let user = sqlx::query_as::<_, User>(
            "SELECT id, username, display_name, role, created_at, updated_at \
             FROM users ORDER BY created_at ASC LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await?;

        match user {
            Some(u) => Ok(u),
            None => self.ensure_admin_user().await,
        }
    }

    /// Issue a new Personal Access Token (`plm_pat_<32_hex>`), storing ONLY its 64-char SHA-256 hex digest in `api_tokens`.
    pub async fn create_pat(&self, req: CreatePatRequest) -> Result<CreatedPatResponse, ApiError> {
        let name = req.name.trim();
        if name.is_empty() {
            return Err(ApiError::bad_request("PAT name must not be empty"));
        }

        let admin = self.ensure_admin_user().await?;
        let (full_token, token_prefix, token_sha256) = generate_pat_secret();
        let id = new_uuid_v7();
        let scopes = if req.scopes.is_empty() {
            vec!["*".to_string()]
        } else {
            req.scopes
        };

        let row = sqlx::query(
            "INSERT INTO api_tokens (id, user_id, name, token_prefix, token_sha256, scopes) \
             VALUES ($1, $2, $3, $4, $5, $6) \
             RETURNING created_at",
        )
        .bind(id)
        .bind(admin.id)
        .bind(name)
        .bind(&token_prefix)
        .bind(&token_sha256)
        .bind(&scopes)
        .fetch_one(&self.pool)
        .await?;

        let created_at = row.try_get("created_at")?;

        Ok(CreatedPatResponse {
            id,
            name: name.to_string(),
            token: full_token,
            token_prefix,
            scopes,
            created_at,
        })
    }

    /// List all PAT summaries (without exposing `token_sha256` or plaintext secrets).
    pub async fn list_pats(&self) -> Result<Vec<ApiTokenSummary>, ApiError> {
        let tokens = sqlx::query_as::<_, ApiTokenSummary>(
            "SELECT id, name, token_prefix, scopes, last_used_at, revoked_at, created_at \
             FROM api_tokens \
             WHERE revoked_at IS NULL \
             ORDER BY created_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(tokens)
    }

    /// Revoke a Personal Access Token by ID (`revoked_at = NOW()`).
    pub async fn revoke_pat(&self, token_id: Uuid) -> Result<(), ApiError> {
        let res = sqlx::query(
            "UPDATE api_tokens SET revoked_at = NOW(), updated_at = NOW() \
             WHERE id = $1 AND revoked_at IS NULL",
        )
        .bind(token_id)
        .execute(&self.pool)
        .await?;

        if res.rows_affected() == 0 {
            let exists: Option<Uuid> =
                sqlx::query_scalar("SELECT id FROM api_tokens WHERE id = $1")
                    .bind(token_id)
                    .fetch_optional(&self.pool)
                    .await?;
            if exists.is_none() {
                return Err(ApiError::not_found(format!("PAT '{token_id}' not found")));
            }
        }
        Ok(())
    }

    /// Strictly verify a Bearer PAT (`plm_pat_...`) or web session token (`hermes_sess_...`).
    /// Missing, empty, malformed, unknown, expired, or revoked credentials ALWAYS return `Err(ApiError::Unauthorized)`.
    pub async fn verify_pat_or_session(
        &self,
        raw_credential: Option<&str>,
    ) -> Result<AuthVerifyResponse, ApiError> {
        let Some(raw) = raw_credential else {
            return Err(ApiError::unauthorized("Missing authentication credentials"));
        };
        let token = strip_bearer(raw);
        if token.is_empty() {
            return Err(ApiError::unauthorized("Empty authentication credentials"));
        }

        let hash = sha256_hex(token);

        if token.starts_with("plm_pat_") {
            // Must be `plm_pat_` + at least 8 hex chars
            if token.len() < 16 {
                return Err(ApiError::unauthorized("Malformed Personal Access Token"));
            }

            let row = sqlx::query(
                "SELECT id, name, scopes FROM api_tokens \
                 WHERE token_sha256 = $1 AND revoked_at IS NULL",
            )
            .bind(&hash)
            .fetch_optional(&self.pool)
            .await?;

            let Some(row) = row else {
                return Err(ApiError::unauthorized(
                    "Invalid or revoked Personal Access Token",
                ));
            };

            let id: Uuid = row.try_get("id")?;
            let name: String = row.try_get("name")?;
            let scopes: Vec<String> = row.try_get("scopes")?;

            sqlx::query("UPDATE api_tokens SET last_used_at = NOW(), updated_at = NOW() WHERE id = $1")
                .bind(id)
                .execute(&self.pool)
                .await?;

            let latest_server_seq = self.latest_server_seq().await?;

            return Ok(AuthVerifyResponse {
                authenticated: true,
                auth_type: "pat".to_string(),
                token_name: Some(name),
                scopes,
                server_time: Utc::now(),
                latest_server_seq,
            });
        }

        if token.starts_with("hermes_sess_") {
            let row = sqlx::query(
                "SELECT s.id, u.username \
                 FROM web_sessions s \
                 JOIN users u ON u.id = s.user_id \
                 WHERE s.session_token_sha256 = $1 \
                   AND s.revoked_at IS NULL \
                   AND s.expires_at > NOW()",
            )
            .bind(&hash)
            .fetch_optional(&self.pool)
            .await?;

            let Some(row) = row else {
                return Err(ApiError::unauthorized("Invalid, expired, or revoked session"));
            };

            let session_id: Uuid = row.try_get("id")?;
            let username: String = row.try_get("username")?;

            sqlx::query("UPDATE web_sessions SET last_used_at = NOW() WHERE id = $1")
                .bind(session_id)
                .execute(&self.pool)
                .await?;

            let latest_server_seq = self.latest_server_seq().await?;

            return Ok(AuthVerifyResponse {
                authenticated: true,
                auth_type: "session".to_string(),
                token_name: Some(username),
                scopes: vec!["*".to_string()],
                server_time: Utc::now(),
                latest_server_seq,
            });
        }

        Err(ApiError::unauthorized("Malformed authentication token"))
    }

    /// Generate a Desktop QR pairing payload containing `{ primary_url, fallback_url, token }` and a newly issued PAT.
    pub async fn build_pairing_qr(
        &self,
        req: PairingQrRequest,
    ) -> Result<PairingQrResponse, ApiError> {
        let token_name = req
            .token_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Mobile Companion QR")
            .to_string();

        let created = self
            .create_pat(CreatePatRequest {
                name: token_name.clone(),
                scopes: vec!["*".to_string()],
            })
            .await?;

        let primary_url = req
            .primary_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(&self.config.public_base_url)
            .to_string();

        let fallback_url = req
            .fallback_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string);

        let qr_payload_json = serde_json::to_string(&serde_json::json!({
            "primary_url": primary_url,
            "fallback_url": fallback_url,
            "token": created.token,
        }))?;

        Ok(PairingQrResponse {
            primary_url,
            fallback_url,
            token: created.token,
            token_id: created.id,
            token_name,
            qr_payload_json,
            created_at: created.created_at,
        })
    }
}

fn strip_bearer(raw: &str) -> &str {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("Bearer ") {
        rest.trim()
    } else if let Some(rest) = trimmed.strip_prefix("bearer ") {
        rest.trim()
    } else {
        trimmed
    }
}
