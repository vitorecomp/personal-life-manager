use hermes_domain::{
    ApiError, CreateHermesSessionRequest, ForkHermesSessionRequest, HermesChatMessage,
    HermesSession, ListHermesSessionsQuery, SessionOrigin, UpdateHermesSessionRequest, new_uuid_v7,
};

use crate::service::IntelligenceService;

pub fn derive_smart_session_title(message: &str) -> String {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return "New Tactical Session".to_string();
    }
    let first_line = trimmed.lines().next().unwrap_or(trimmed).trim();
    let snippet: String = first_line.chars().take(60).collect();
    if first_line.chars().count() > 60 {
        format!("{}...", snippet.trim_end())
    } else {
        snippet
    }
}

impl IntelligenceService {
    pub async fn list_sessions(
        &self,
        query: ListHermesSessionsQuery,
    ) -> Result<Vec<HermesSession>, ApiError> {
        let rows = sqlx::query_as::<_, HermesSession>(
            r#"
            SELECT *
            FROM hermes_sessions_index
            ORDER BY pinned DESC, updated_at DESC, created_at DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(ApiError::from)?;

        let folder_filter = query
            .folder_name
            .as_deref()
            .map(str::trim)
            .filter(|f| !f.is_empty());
        let q_filter = query
            .q
            .as_deref()
            .map(str::trim)
            .filter(|q| !q.is_empty())
            .map(|q| q.to_ascii_lowercase());

        let mut sessions: Vec<HermesSession> = rows
            .into_iter()
            .map(HermesSession::with_computed_metadata)
            .filter(|s| {
                if let Some(pinned) = query.pinned {
                    if s.pinned != pinned {
                        return false;
                    }
                }
                if let Some(archived) = query.archived {
                    if s.archived != archived {
                        return false;
                    }
                }
                if let Some(origin) = query.origin {
                    if s.origin != origin {
                        return false;
                    }
                }
                if let Some(folder) = folder_filter {
                    if s.folder_name.as_deref() != Some(folder) {
                        return false;
                    }
                }
                if let Some(ref q_lower) = q_filter {
                    let matches_title = s.title.to_ascii_lowercase().contains(q_lower);
                    let matches_key = s.session_key.to_ascii_lowercase().contains(q_lower);
                    let matches_folder = s
                        .folder_name
                        .as_deref()
                        .unwrap_or_default()
                        .to_ascii_lowercase()
                        .contains(q_lower);
                    let matches_profile = s
                        .profile_slug
                        .as_deref()
                        .unwrap_or_default()
                        .to_ascii_lowercase()
                        .contains(q_lower);
                    let matches_preview = s
                        .last_message_preview
                        .as_deref()
                        .unwrap_or_default()
                        .to_ascii_lowercase()
                        .contains(q_lower);
                    let matches_body = s
                        .messages_json
                        .to_string()
                        .to_ascii_lowercase()
                        .contains(q_lower);

                    if !(matches_title
                        || matches_key
                        || matches_folder
                        || matches_profile
                        || matches_preview
                        || matches_body)
                    {
                        return false;
                    }
                }
                true
            })
            .collect();

        sessions.sort_by(|a, b| {
            b.pinned
                .cmp(&a.pinned)
                .then_with(|| {
                    b.last_message_at
                        .unwrap_or(b.updated_at)
                        .cmp(&a.last_message_at.unwrap_or(a.updated_at))
                })
                .then_with(|| b.updated_at.cmp(&a.updated_at))
        });

        if let Some(limit) = query.limit {
            sessions.truncate(limit.max(0) as usize);
        }

        Ok(sessions)
    }

    pub async fn create_session(
        &self,
        req: CreateHermesSessionRequest,
    ) -> Result<HermesSession, ApiError> {
        let session_key = req
            .session_key
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("sess_{}", new_uuid_v7().simple()));

        let title = req
            .title
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("New Tactical Session")
            .to_string();

        let profile_slug = req
            .profile_slug
            .or(req.model)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let folder_name = req
            .folder_name
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let messages_json = req.messages_json.unwrap_or_else(|| serde_json::json!([]));

        let row = sqlx::query_as::<_, HermesSession>(
            r#"
            INSERT INTO hermes_sessions_index (
                session_key, title, origin, profile_slug, pinned, archived,
                folder_name, high_level_mode, last_route_context, messages_json,
                created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7, $8, $9, NOW(), NOW())
            ON CONFLICT (session_key) DO UPDATE SET
                title = EXCLUDED.title,
                profile_slug = COALESCE(EXCLUDED.profile_slug, hermes_sessions_index.profile_slug),
                pinned = EXCLUDED.pinned OR hermes_sessions_index.pinned,
                folder_name = COALESCE(EXCLUDED.folder_name, hermes_sessions_index.folder_name),
                high_level_mode = EXCLUDED.high_level_mode,
                last_route_context = COALESCE(EXCLUDED.last_route_context, hermes_sessions_index.last_route_context),
                updated_at = NOW()
            RETURNING *
            "#,
        )
        .bind(&session_key)
        .bind(&title)
        .bind(req.origin)
        .bind(&profile_slug)
        .bind(req.pinned)
        .bind(&folder_name)
        .bind(req.high_level_mode)
        .bind(&req.last_route_context)
        .bind(&messages_json)
        .fetch_one(&self.pool)
        .await
        .map_err(ApiError::from)?;

        Ok(row.with_computed_metadata())
    }

    pub async fn get_session(&self, session_key: &str) -> Result<HermesSession, ApiError> {
        let trimmed = session_key.trim();
        if trimmed.is_empty() {
            return Err(ApiError::bad_request("session_key must not be empty"));
        }

        let row = sqlx::query_as::<_, HermesSession>(
            "SELECT * FROM hermes_sessions_index WHERE session_key = $1",
        )
        .bind(trimmed)
        .fetch_optional(&self.pool)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("Hermes session '{trimmed}' not found")))?;

        Ok(row.with_computed_metadata())
    }

    pub async fn get_or_create_session(
        &self,
        session_key: Option<&str>,
        first_message: &str,
        origin: Option<SessionOrigin>,
        profile_slug: Option<String>,
        high_level_mode: Option<bool>,
        last_route_context: Option<serde_json::Value>,
    ) -> Result<HermesSession, ApiError> {
        let resolved_key = session_key
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("sess_{}", new_uuid_v7().simple()));

        if let Ok(existing) = self.get_session(&resolved_key).await {
            return Ok(existing);
        }

        let smart_title = derive_smart_session_title(first_message);
        self.create_session(CreateHermesSessionRequest {
            session_key: Some(resolved_key),
            title: Some(smart_title),
            origin: origin.unwrap_or(SessionOrigin::HermesView),
            profile_slug,
            model: None,
            high_level_mode: high_level_mode.unwrap_or(false),
            pinned: false,
            folder_name: None,
            last_route_context,
            messages_json: Some(serde_json::json!([])),
        })
        .await
    }

    pub async fn update_session(
        &self,
        session_key: &str,
        req: UpdateHermesSessionRequest,
    ) -> Result<HermesSession, ApiError> {
        let existing = self.get_session(session_key).await?;

        let title = if let Some(raw_title) = req.title {
            let trimmed = raw_title.trim();
            if trimmed.is_empty() {
                return Err(ApiError::bad_request("Session title must not be empty"));
            }
            trimmed.to_string()
        } else {
            existing.title
        };

        let pinned = req.pinned.unwrap_or(existing.pinned);
        let archived = req.archived.unwrap_or(existing.archived);
        let folder_name = match req.folder_name {
            Some(f) => {
                let t = f.trim().to_string();
                if t.is_empty() { None } else { Some(t) }
            }
            None => existing.folder_name,
        };
        let high_level_mode = req.high_level_mode.unwrap_or(existing.high_level_mode);
        let last_route_context = req.last_route_context.or(existing.last_route_context);
        let profile_slug = req
            .profile_slug
            .or(req.model)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or(existing.profile_slug);

        let updated = sqlx::query_as::<_, HermesSession>(
            r#"
            UPDATE hermes_sessions_index
            SET title = $2,
                pinned = $3,
                archived = $4,
                folder_name = $5,
                high_level_mode = $6,
                last_route_context = $7,
                profile_slug = $8,
                updated_at = NOW()
            WHERE session_key = $1
            RETURNING *
            "#,
        )
        .bind(&existing.session_key)
        .bind(&title)
        .bind(pinned)
        .bind(archived)
        .bind(&folder_name)
        .bind(high_level_mode)
        .bind(&last_route_context)
        .bind(&profile_slug)
        .fetch_one(&self.pool)
        .await
        .map_err(ApiError::from)?;

        Ok(updated.with_computed_metadata())
    }

    pub async fn delete_session(&self, session_key: &str) -> Result<(), ApiError> {
        let trimmed = session_key.trim();
        let res = sqlx::query("DELETE FROM hermes_sessions_index WHERE session_key = $1")
            .bind(trimmed)
            .execute(&self.pool)
            .await
            .map_err(ApiError::from)?;

        if res.rows_affected() == 0 {
            return Err(ApiError::not_found(format!(
                "Hermes session '{trimmed}' not found"
            )));
        }
        Ok(())
    }

    pub async fn fork_session(
        &self,
        source_key: &str,
        req: ForkHermesSessionRequest,
    ) -> Result<HermesSession, ApiError> {
        let source = self.get_session(source_key).await?;
        let messages = source
            .messages_json
            .as_array()
            .cloned()
            .unwrap_or_default();

        let (sliced_messages, branched_at_turn) = match req.turn_index {
            Some(idx) if idx < 0 => {
                return Err(ApiError::bad_request(
                    "turn_index must be non-negative when forking a session",
                ));
            }
            Some(idx) => {
                let take_count = ((idx as usize) + 1).min(messages.len());
                let sliced: Vec<serde_json::Value> = messages.into_iter().take(take_count).collect();
                (sliced, Some(idx))
            }
            None => {
                let len = messages.len() as i32;
                (messages, Some(len))
            }
        };

        let new_session_key = req
            .new_session_key
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("sess_fork_{}", new_uuid_v7().simple()));

        let fork_title = req
            .title
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("{} (Fork)", source.title));

        let forked = sqlx::query_as::<_, HermesSession>(
            r#"
            INSERT INTO hermes_sessions_index (
                session_key, title, origin, profile_slug, pinned, archived,
                folder_name, parent_session_key, branched_at_turn, high_level_mode,
                last_route_context, messages_json, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, FALSE, FALSE, $5, $6, $7, $8, $9, $10, NOW(), NOW())
            RETURNING *
            "#,
        )
        .bind(&new_session_key)
        .bind(&fork_title)
        .bind(source.origin)
        .bind(&source.profile_slug)
        .bind(&source.folder_name)
        .bind(&source.session_key)
        .bind(branched_at_turn)
        .bind(source.high_level_mode)
        .bind(&source.last_route_context)
        .bind(serde_json::Value::Array(sliced_messages))
        .fetch_one(&self.pool)
        .await
        .map_err(ApiError::from)?;

        Ok(forked.with_computed_metadata())
    }

    pub async fn append_session_turn(
        &self,
        session_key: &str,
        user_msg: HermesChatMessage,
        assistant_msg: HermesChatMessage,
        high_level_mode: bool,
        last_route_context: Option<serde_json::Value>,
    ) -> Result<HermesSession, ApiError> {
        let existing = self.get_session(session_key).await?;
        let mut messages = existing
            .messages_json
            .as_array()
            .cloned()
            .unwrap_or_default();

        let should_retitle = existing.title == "New Tactical Session"
            && !user_msg.content.trim().is_empty();
        let next_title = if should_retitle {
            derive_smart_session_title(&user_msg.content)
        } else {
            existing.title
        };

        if let Ok(user_val) = serde_json::to_value(&user_msg) {
            messages.push(user_val);
        }
        if let Ok(assistant_val) = serde_json::to_value(&assistant_msg) {
            messages.push(assistant_val);
        }

        let merged_route_ctx = last_route_context.or(existing.last_route_context);

        let updated = sqlx::query_as::<_, HermesSession>(
            r#"
            UPDATE hermes_sessions_index
            SET title = $2,
                high_level_mode = $3,
                last_route_context = $4,
                messages_json = $5,
                updated_at = NOW()
            WHERE session_key = $1
            RETURNING *
            "#,
        )
        .bind(session_key)
        .bind(&next_title)
        .bind(high_level_mode)
        .bind(&merged_route_ctx)
        .bind(serde_json::Value::Array(messages))
        .fetch_one(&self.pool)
        .await
        .map_err(ApiError::from)?;

        Ok(updated.with_computed_metadata())
    }
}
