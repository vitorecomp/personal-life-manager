use std::time::Duration;

use chrono::Utc;
use hermes_domain::{
    ApiError, ApprovalStatus, ChatStreamRequest, ChatToolCallDirective, HermesChatMessage,
    HermesSession, HermesStreamEvent, TaskListFilter, ThinkingOrbState, VaultNoteListQuery,
    new_uuid_v7,
};
use uuid::Uuid;

use crate::mcp::{McpCallContext, McpToolExecutionOutcome};
use crate::service::IntelligenceService;

pub const GATEWAY_PROBE_TIMEOUT_MS: u64 = 1500;

#[derive(Debug, Clone)]
pub struct ResolvedChatContext {
    pub resolved_mentions: Vec<String>,
    pub slash_command: Option<String>,
    pub thinking_orb_active: bool,
    pub context_blocks: Vec<String>,
    pub system_prompt: String,
}

pub fn format_sse_events(events: &[HermesStreamEvent]) -> String {
    let mut out = String::new();
    for ev in events {
        let name = ev.event_name();
        if let Ok(json) = serde_json::to_string(ev) {
            out.push_str(&format!("event: {name}\ndata: {json}\n\n"));
        }
    }
    out
}

impl IntelligenceService {
    /// Fast non-blocking probe (`1500ms` timeout) against `{HERMES_GATEWAY_URL}/models`
    /// and `/health`, returning `"online"` when reachable or `"offline_mock"` when offline.
    pub async fn check_gateway_health(&self) -> String {
        let base = self.gateway_url.trim_end_matches('/');
        if base.is_empty()
            || base.eq_ignore_ascii_case("offline")
            || base.eq_ignore_ascii_case("mock")
            || base.eq_ignore_ascii_case("offline_mock")
        {
            return "offline_mock".to_string();
        }

        let probe_client = reqwest::Client::builder()
            .timeout(Duration::from_millis(GATEWAY_PROBE_TIMEOUT_MS))
            .build()
            .unwrap_or_else(|_| self.http_client.clone());

        for suffix in ["/models", "/health"] {
            let url = format!("{base}{suffix}");
            let mut req = probe_client.get(&url);
            if let Some(ref key) = self.gateway_api_key {
                req = req.bearer_auth(key);
            }
            if let Ok(resp) = req.send().await {
                if resp.status().is_success() {
                    return "online".to_string();
                }
            }
        }

        "offline_mock".to_string()
    }

    pub async fn resolve_chat_context(
        &self,
        req: &ChatStreamRequest,
        session: &HermesSession,
    ) -> Result<ResolvedChatContext, ApiError> {
        let mut slash_command = req
            .slash_command
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| {
                if s.starts_with('/') {
                    s.to_ascii_lowercase()
                } else {
                    format!("/{}", s.to_ascii_lowercase())
                }
            });

        if slash_command.is_none() {
            let trimmed_msg = req.message.trim();
            for candidate in ["/deep-plan", "/weekly-review", "/quiz-me", "/rebalance"] {
                if trimmed_msg == candidate || trimmed_msg.starts_with(&format!("{candidate} ")) {
                    slash_command = Some(candidate.to_string());
                    break;
                }
            }
        }

        let mut raw_mentions: Vec<String> = Vec::new();
        if let Some(ref list) = req.mentions {
            for m in list {
                let t = m.trim();
                if !t.is_empty() {
                    raw_mentions.push(if t.starts_with('@') {
                        t.to_string()
                    } else {
                        format!("@{t}")
                    });
                }
            }
        }

        for token in req.message.split_whitespace() {
            let clean = token.trim_matches(|c: char| {
                matches!(c, ',' | ';' | ')' | '(' | '[' | ']' | '"' | '\'' | '?' | '!')
            });
            if clean.starts_with('@') && clean.len() > 1 {
                raw_mentions.push(clean.to_string());
            }
        }

        // Slash command implied context
        match slash_command.as_deref() {
            Some("/deep-plan") => {
                raw_mentions.push("@goals".to_string());
                raw_mentions.push("@todos".to_string());
            }
            Some("/weekly-review") => {
                raw_mentions.push("@routines".to_string());
                raw_mentions.push("@todos".to_string());
                raw_mentions.push("@goals".to_string());
            }
            Some("/quiz-me") => {
                raw_mentions.push("@courses".to_string());
            }
            Some("/rebalance") => {
                raw_mentions.push("@finance".to_string());
            }
            _ => {}
        }

        let mut resolved_mentions = Vec::new();
        let mut context_blocks = Vec::new();

        for mention in raw_mentions {
            if let Some(vault_path) = mention.strip_prefix("@vault:") {
                let clean_path = vault_path.trim();
                // Strict path-traversal validation via read_vault_note
                match self.read_vault_note(clean_path).await {
                    Ok(note) => {
                        let tag = format!("@vault:{}", note.path);
                        if !resolved_mentions.contains(&tag) {
                            resolved_mentions.push(tag);
                        }
                        let snippet: String = note.content_md.chars().take(600).collect();
                        context_blocks.push(format!(
                            "[VAULT NOTE: {} ({})]\n{}",
                            note.title, note.path, snippet
                        ));
                    }
                    Err(err) => {
                        if err.status_code() == 400 || err.status_code() == 403 {
                            return Err(err);
                        }
                        context_blocks.push(format!(
                            "[VAULT NOTE MISSING: {clean_path}] Note not found in Second Brain."
                        ));
                    }
                }
                continue;
            }

            let lower = mention.to_ascii_lowercase();
            match lower.as_str() {
                "@goals" => {
                    if !resolved_mentions.contains(&"@goals".to_string()) {
                        resolved_mentions.push("@goals".to_string());
                        if let Ok(goals) = self.life_ops.list_goals(None, None, None).await {
                            let summary: Vec<String> = goals
                                .iter()
                                .take(5)
                                .map(|g| {
                                    format!(
                                        "{} ({:.1}% / confidence {}%)",
                                        g.goal.title, g.goal.progress_pct, g.goal.confidence_score
                                    )
                                })
                                .collect();
                            context_blocks.push(format!(
                                "[GOALS CONTEXT ({} total)]: {}",
                                goals.len(),
                                if summary.is_empty() {
                                    "No goals defined.".to_string()
                                } else {
                                    summary.join("; ")
                                }
                            ));
                        }
                    }
                }
                "@todos" | "@tasks" => {
                    if !resolved_mentions.contains(&"@todos".to_string()) {
                        resolved_mentions.push("@todos".to_string());
                        if let Ok(tasks) = self.life_ops.list_tasks(TaskListFilter::default()).await
                        {
                            let open_tasks: Vec<String> = tasks
                                .iter()
                                .filter(|t| t.completed_at.is_none())
                                .take(6)
                                .map(|t| format!("{} [{:?}]", t.title, t.priority))
                                .collect();
                            let active_timer = self
                                .life_ops
                                .get_active_timer()
                                .await
                                .ok()
                                .and_then(|r| r.session)
                                .map(|s| format!("Active timer: {:?}", s.timer_mode))
                                .unwrap_or_else(|| "No active timer".to_string());
                            context_blocks.push(format!(
                                "[TODOS CONTEXT ({} open)]: {} | {}",
                                open_tasks.len(),
                                if open_tasks.is_empty() {
                                    "Inbox zero.".to_string()
                                } else {
                                    open_tasks.join("; ")
                                },
                                active_timer
                            ));
                        }
                    }
                }
                "@finance" | "@portfolio" => {
                    if !resolved_mentions.contains(&"@finance".to_string()) {
                        resolved_mentions.push("@finance".to_string());
                        if let Ok(alloc) = self.life_ops.get_portfolio_allocation(None, None).await {
                            let buy_recs: Vec<String> = alloc
                                .recommendations
                                .iter()
                                .filter(|b| b.recommended_buy_cents > 0)
                                .map(|b| {
                                    format!(
                                        "{}: buy {} cents (current {:.1}% -> target {:.1}%)",
                                        b.symbol,
                                        b.recommended_buy_cents,
                                        b.current_weight_pct,
                                        b.target_weight_pct
                                    )
                                })
                                .collect();
                            context_blocks.push(format!(
                                "[FINANCE CONTEXT]: Total BRL={} cents, Total USD={} cents, FX={:.4} | Rebalance: {}",
                                alloc.total_brl_cents,
                                alloc.total_usd_cents,
                                alloc.fx_usd_brl,
                                if buy_recs.is_empty() {
                                    "On target".to_string()
                                } else {
                                    buy_recs.join(", ")
                                }
                            ));
                        }
                    }
                }
                "@routines" => {
                    if !resolved_mentions.contains(&"@routines".to_string()) {
                        resolved_mentions.push("@routines".to_string());
                        if let Ok(routines) = self.life_ops.list_routines(None, None).await {
                            let analytics = self.life_ops.get_routines_analytics().await.ok();
                            let adherence = analytics
                                .map(|a| format!("{:.1}% consistency", a.consistency_score_pct))
                                .unwrap_or_else(|| "n/a".to_string());
                            context_blocks.push(format!(
                                "[ROUTINES CONTEXT]: {} routines configured ({})",
                                routines.len(),
                                adherence
                            ));
                        }
                    }
                }
                "@courses" | "@youtube" => {
                    if !resolved_mentions.contains(&"@courses".to_string()) {
                        resolved_mentions.push("@courses".to_string());
                        if let Ok(courses) = self.life_ops.list_courses(None, None, None).await {
                            let due_reviews = self
                                .life_ops
                                .list_due_spaced_reviews()
                                .await
                                .unwrap_or_default();
                            let course_titles: Vec<String> = courses
                                .iter()
                                .take(5)
                                .map(|c| format!("{} ({:.0}%)", c.title, c.progress_pct))
                                .collect();
                            context_blocks.push(format!(
                                "[COURSES CONTEXT ({} courses, {} due reviews)]: {}",
                                courses.len(),
                                due_reviews.len(),
                                if course_titles.is_empty() {
                                    "No courses.".to_string()
                                } else {
                                    course_titles.join("; ")
                                }
                            ));
                        }
                    }
                }
                "@servers" => {
                    if !resolved_mentions.contains(&"@servers".to_string()) {
                        resolved_mentions.push("@servers".to_string());
                        if let Ok(summary) = self.life_ops.get_servers_summary().await {
                            context_blocks.push(format!(
                                "[SERVERS CONTEXT]: total={}, online={}, degraded={}, offline={}",
                                summary.total, summary.online, summary.degraded, summary.offline
                            ));
                        }
                    }
                }
                "@vault" => {
                    if !resolved_mentions.contains(&"@vault".to_string()) {
                        resolved_mentions.push("@vault".to_string());
                        if let Ok(notes) = self
                            .list_vault_notes(VaultNoteListQuery {
                                q: None,
                                folder: None,
                                semantic: false,
                                limit: Some(5),
                            })
                            .await
                        {
                            let list: Vec<String> = notes
                                .iter()
                                .map(|n| format!("{} ({})", n.title, n.path))
                                .collect();
                            context_blocks.push(format!(
                                "[VAULT NOTES ({} recent)]: {}",
                                notes.len(),
                                if list.is_empty() {
                                    "Empty vault.".to_string()
                                } else {
                                    list.join("; ")
                                }
                            ));
                        }
                    }
                }
                _ => {}
            }
        }

        if let Some(ref page_ctx) = req.page_context {
            context_blocks.push(format!(
                "[PAGE CONTEXT]: active_route='{}', entity_id={:?}, dashboard_id={:?}",
                page_ctx.active_route, page_ctx.selected_entity_id, page_ctx.active_dashboard_id
            ));
        }

        // Preserve any pre-seeded system prompt in session history (e.g. Course Quiz)
        let mut seeded_system_prompts = Vec::new();
        if let Some(arr) = session.messages_json.as_array() {
            for msg in arr {
                if msg.get("role").and_then(|r| r.as_str()) == Some("system") {
                    if let Some(content) = msg.get("content").and_then(|c| c.as_str()) {
                        seeded_system_prompts.push(content.to_string());
                    }
                }
            }
        }

        let thinking_orb_active = req.high_level_mode.unwrap_or(false)
            || session.high_level_mode
            || matches!(slash_command.as_deref(), Some("/deep-plan"));

        let mut system_prompt = String::from(
            "You are HERMES // OS ( & Frieren Sage Companion), a tactical Second Brain & Life Operations intelligence.",
        );
        if thinking_orb_active {
            system_prompt.push_str(
                " High-Level Reasoning Mode (REF-08 Geodesic Thinking Orb) is ACTIVE: provide deep multi-horizon strategic synthesis.",
            );
        }
        if let Some(ref cmd) = slash_command {
            system_prompt.push_str(&format!(" Active Slash Command: {cmd}."));
        }
        for sp in seeded_system_prompts {
            system_prompt.push_str(&format!("\n[SESSION DIRECTIVE]: {sp}"));
        }
        if !context_blocks.is_empty() {
            system_prompt.push_str("\n\nLIVE GROUNDED TELEMETRY:\n");
            system_prompt.push_str(&context_blocks.join("\n"));
        }

        Ok(ResolvedChatContext {
            resolved_mentions,
            slash_command,
            thinking_orb_active,
            context_blocks,
            system_prompt,
        })
    }

    pub async fn stream_chat(
        &self,
        header_session_key: Option<&str>,
        req: ChatStreamRequest,
    ) -> Result<Vec<HermesStreamEvent>, ApiError> {
        let trimmed_msg = req.message.trim();
        if trimmed_msg.is_empty() {
            return Err(ApiError::bad_request("Chat message must not be empty"));
        }

        let effective_key = header_session_key
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .or_else(|| {
                req.session_key
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
            });

        let route_ctx = req
            .page_context
            .as_ref()
            .and_then(|p| serde_json::to_value(p).ok());

        let session = self
            .get_or_create_session(
                effective_key,
                trimmed_msg,
                req.origin,
                req.profile_slug.clone().or_else(|| req.model.clone()),
                req.high_level_mode,
                route_ctx.clone(),
            )
            .await?;

        let resolved_ctx = self.resolve_chat_context(&req, &session).await?;
        let gateway_status = self.check_gateway_health().await;

        if gateway_status == "online" {
            if let Ok(events) = self
                .stream_chat_via_online_gateway(&session, &req, &resolved_ctx, route_ctx.clone())
                .await
            {
                return Ok(events);
            }
        }

        self.stream_chat_offline_mock(&session, &req, &resolved_ctx, route_ctx)
            .await
    }

    async fn stream_chat_via_online_gateway(
        &self,
        session: &HermesSession,
        req: &ChatStreamRequest,
        ctx: &ResolvedChatContext,
        route_ctx: Option<serde_json::Value>,
    ) -> Result<Vec<HermesStreamEvent>, ApiError> {
        let base = self.gateway_url.trim_end_matches('/');
        let url = format!("{base}/chat/completions");

        let mut messages_payload = vec![serde_json::json!({
            "role": "system",
            "content": ctx.system_prompt,
        })];

        if let Some(arr) = session.messages_json.as_array() {
            for m in arr {
                let role = m.get("role").and_then(|v| v.as_str()).unwrap_or("user");
                if role == "system" {
                    continue;
                }
                if let Some(content) = m.get("content").and_then(|v| v.as_str()) {
                    messages_payload.push(serde_json::json!({
                        "role": role,
                        "content": content,
                    }));
                }
            }
        }
        messages_payload.push(serde_json::json!({
            "role": "user",
            "content": req.message,
        }));

        let model = req
            .model
            .clone()
            .or_else(|| req.profile_slug.clone())
            .or_else(|| session.profile_slug.clone())
            .unwrap_or_else(|| "hermes-3-llama-3.1-70b".to_string());

        let body = serde_json::json!({
            "model": model,
            "stream": true,
            "high_level_mode": ctx.thinking_orb_active,
            "messages": messages_payload,
        });

        let mut http_req = self
            .http_client
            .post(&url)
            .header("X-Hermes-Session-Key", &session.session_key)
            .json(&body);

        if let Some(ref key) = self.gateway_api_key {
            http_req = http_req.bearer_auth(key);
        }

        let resp = http_req
            .send()
            .await
            .map_err(|e| ApiError::internal(format!("Gateway connection failed: {e}")))?;

        if !resp.status().is_success() {
            return Err(ApiError::internal(format!(
                "Gateway returned non-success status: {}",
                resp.status()
            )));
        }

        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();

        let raw_text = resp
            .text()
            .await
            .map_err(|e| ApiError::internal(format!("Failed to read gateway response: {e}")))?;

        let mut events = Vec::new();
        let mut thinking_acc = String::new();
        let mut content_acc = String::new();
        let mut upstream_tool_directives: Vec<ChatToolCallDirective> = Vec::new();

        if let Some(ref explicit_tc) = req.tool_call {
            upstream_tool_directives.push(explicit_tc.clone());
        }

        let is_sse = content_type.contains("text/event-stream")
            || raw_text.trim_start().starts_with("data:")
            || raw_text.trim_start().starts_with("event:");

        if is_sse {
            for line in raw_text.lines() {
                let trimmed = line.trim();
                let Some(data_str) = trimmed.strip_prefix("data:") else {
                    continue;
                };
                let data_trimmed = data_str.trim();
                if data_trimmed.is_empty() || data_trimmed == "[DONE]" {
                    continue;
                }
                let Ok(val) = serde_json::from_str::<serde_json::Value>(data_trimmed) else {
                    continue;
                };

                if let Some(th) = val
                    .get("thinking")
                    .and_then(|v| v.as_str())
                    .or_else(|| {
                        val.pointer("/choices/0/delta/reasoning_content")
                            .and_then(|v| v.as_str())
                    })
                    .or_else(|| {
                        val.pointer("/choices/0/delta/thinking")
                            .and_then(|v| v.as_str())
                    })
                {
                    if !th.is_empty() {
                        if !thinking_acc.is_empty() {
                            thinking_acc.push(' ');
                        }
                        thinking_acc.push_str(th);
                    }
                }

                if let Some(tc_arr) = val
                    .pointer("/choices/0/delta/tool_calls")
                    .and_then(|v| v.as_array())
                    .or_else(|| {
                        val.pointer("/choices/0/message/tool_calls")
                            .and_then(|v| v.as_array())
                    })
                {
                    for tc in tc_arr {
                        if let Some(name) = tc
                            .pointer("/function/name")
                            .or_else(|| tc.get("name"))
                            .and_then(|v| v.as_str())
                        {
                            let args = tc
                                .pointer("/function/arguments")
                                .or_else(|| tc.get("arguments"))
                                .map(|v| {
                                    if let Some(s) = v.as_str() {
                                        serde_json::from_str(s).unwrap_or_else(|_| serde_json::json!({}))
                                    } else {
                                        v.clone()
                                    }
                                })
                                .unwrap_or_else(|| serde_json::json!({}));
                            upstream_tool_directives.push(ChatToolCallDirective {
                                name: name.to_string(),
                                arguments: args,
                            });
                        }
                    }
                }

                if let Some(delta) = val
                    .pointer("/choices/0/delta/content")
                    .and_then(|v| v.as_str())
                    .or_else(|| {
                        val.pointer("/choices/0/message/content")
                            .and_then(|v| v.as_str())
                    })
                    .or_else(|| val.get("delta").and_then(|v| v.as_str()))
                    .or_else(|| val.get("token").and_then(|v| v.as_str()))
                {
                    if !delta.is_empty() {
                        content_acc.push_str(delta);
                    }
                }
            }
        } else if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw_text) {
            if let Some(th) = val
                .pointer("/choices/0/message/reasoning_content")
                .or_else(|| val.get("thinking"))
                .and_then(|v| v.as_str())
            {
                thinking_acc.push_str(th);
            }
            if let Some(tc_arr) = val
                .pointer("/choices/0/message/tool_calls")
                .and_then(|v| v.as_array())
            {
                for tc in tc_arr {
                    if let Some(name) = tc
                        .pointer("/function/name")
                        .or_else(|| tc.get("name"))
                        .and_then(|v| v.as_str())
                    {
                        let args = tc
                            .pointer("/function/arguments")
                            .or_else(|| tc.get("arguments"))
                            .map(|v| {
                                if let Some(s) = v.as_str() {
                                    serde_json::from_str(s).unwrap_or_else(|_| serde_json::json!({}))
                                } else {
                                    v.clone()
                                }
                            })
                            .unwrap_or_else(|| serde_json::json!({}));
                        upstream_tool_directives.push(ChatToolCallDirective {
                            name: name.to_string(),
                            arguments: args,
                        });
                    }
                }
            }
            if let Some(c) = val
                .pointer("/choices/0/message/content")
                .or_else(|| val.get("content"))
                .and_then(|v| v.as_str())
            {
                content_acc.push_str(c);
            }
        }

        // Extract inline <thinking>...</thinking> tags if present
        if let Some((extracted_think, cleaned_body)) = extract_inline_thinking(&content_acc) {
            if thinking_acc.is_empty() {
                thinking_acc = extracted_think;
            }
            content_acc = cleaned_body;
        }

        if thinking_acc.is_empty() {
            thinking_acc = format!(
                "Connected to hermes gateway ({}). Mentions: {:?}, Slash: {:?}.",
                self.gateway_url, ctx.resolved_mentions, ctx.slash_command
            );
        }

        events.push(HermesStreamEvent::Thinking {
            session_key: session.session_key.clone(),
            content: thinking_acc.clone(),
            step: 1,
            thinking_orb_active: ctx.thinking_orb_active,
            orb_state: ThinkingOrbState {
                active: ctx.thinking_orb_active,
                vertices_lit: if ctx.thinking_orb_active { 24 } else { 8 },
                rings_locked: if ctx.thinking_orb_active { 3 } else { 1 },
                phase: "gateway_online_reasoning".to_string(),
            },
            gateway_mode: "online".to_string(),
        });

        let mut tool_calls_log = Vec::new();
        let mut undo_ids = Vec::new();
        let mut approval_ids = Vec::new();

        for directive in upstream_tool_directives {
            self.execute_and_append_chat_tool(
                &session.session_key,
                &directive,
                &mut events,
                &mut tool_calls_log,
                &mut undo_ids,
                &mut approval_ids,
            )
            .await;
        }

        if content_acc.trim().is_empty() {
            content_acc = format!(
                "Processed request via online gateway (`{}`). Context mentions: {:?}.",
                model, ctx.resolved_mentions
            );
        }

        let chunks = split_into_token_deltas(&content_acc);
        let mut running = String::new();
        for delta in chunks {
            running.push_str(&delta);
            events.push(HermesStreamEvent::Token {
                session_key: session.session_key.clone(),
                delta,
                content: running.clone(),
            });
        }

        let updated_session = self
            .persist_turn_messages(
                &session.session_key,
                &req.message,
                &content_acc,
                &thinking_acc,
                &tool_calls_log,
                &undo_ids,
                &approval_ids,
                "online",
                ctx.thinking_orb_active,
                route_ctx,
            )
            .await?;

        events.push(HermesStreamEvent::Done {
            session_key: session.session_key.clone(),
            message: content_acc,
            thinking: thinking_acc,
            thinking_orb_active: ctx.thinking_orb_active,
            gateway_mode: "online".to_string(),
            resolved_mentions: ctx.resolved_mentions.clone(),
            slash_command: ctx.slash_command.clone(),
            tool_calls: tool_calls_log,
            undo_ids,
            approval_ids,
            message_count: updated_session.message_count,
            token_count: updated_session.token_count,
        });

        Ok(events)
    }

    async fn stream_chat_offline_mock(
        &self,
        session: &HermesSession,
        req: &ChatStreamRequest,
        ctx: &ResolvedChatContext,
        route_ctx: Option<serde_json::Value>,
    ) -> Result<Vec<HermesStreamEvent>, ApiError> {
        let mut events = Vec::new();

        let thinking_text = format!(
            "HERMES // OFFLINE_MOCK synthesis for session '{}'. Active mentions: {:?}. Slash directive: {:?}. High-Level Orb: {}.",
            session.session_key,
            ctx.resolved_mentions,
            ctx.slash_command,
            ctx.thinking_orb_active
        );

        events.push(HermesStreamEvent::Thinking {
            session_key: session.session_key.clone(),
            content: thinking_text.clone(),
            step: 1,
            thinking_orb_active: ctx.thinking_orb_active,
            orb_state: ThinkingOrbState {
                active: ctx.thinking_orb_active,
                vertices_lit: if ctx.thinking_orb_active { 24 } else { 8 },
                rings_locked: if ctx.thinking_orb_active { 3 } else { 1 },
                phase: if ctx.thinking_orb_active {
                    "geodesic_deep_synthesis".to_string()
                } else {
                    "tactical_context_lock".to_string()
                },
            },
            gateway_mode: "offline_mock".to_string(),
        });

        let mut tool_calls_log = Vec::new();
        let mut undo_ids = Vec::new();
        let mut approval_ids = Vec::new();

        let mut directives = Vec::new();
        if let Some(ref tc) = req.tool_call {
            directives.push(tc.clone());
        } else if let Some(inline_tc) = parse_inline_mcp_directive(&req.message) {
            directives.push(inline_tc);
        }

        for directive in directives {
            self.execute_and_append_chat_tool(
                &session.session_key,
                &directive,
                &mut events,
                &mut tool_calls_log,
                &mut undo_ids,
                &mut approval_ids,
            )
            .await;
        }

        let mut markdown_sections = Vec::new();
        markdown_sections.push(format!(
            "### HERMES // TACTICAL SYNTHESIS (`offline_mock`)\n**Query**: {}",
            req.message.trim()
        ));

        if let Some(ref cmd) = ctx.slash_command {
            markdown_sections.push(format!("**Command Executed**: `{cmd}`"));
        }

        if !ctx.context_blocks.is_empty() {
            markdown_sections.push(format!(
                "#### Grounded Context ({})\n{}",
                ctx.resolved_mentions.join(", "),
                ctx.context_blocks
                    .iter()
                    .map(|b| format!("- {b}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            ));
        }

        if !tool_calls_log.is_empty() {
            let summaries: Vec<String> = tool_calls_log
                .iter()
                .map(|tc| {
                    let name = tc.get("tool_name").and_then(|v| v.as_str()).unwrap_or("unknown");
                    let status = tc.get("status").and_then(|v| v.as_str()).unwrap_or("unknown");
                    format!("- `{name}` -> **{status}**")
                })
                .collect();
            markdown_sections.push(format!("#### MCP Tool Execution\n{}", summaries.join("\n")));
        }

        let full_reply = markdown_sections.join("\n\n");
        let chunks = split_into_token_deltas(&full_reply);
        let mut running = String::new();
        for delta in chunks {
            running.push_str(&delta);
            events.push(HermesStreamEvent::Token {
                session_key: session.session_key.clone(),
                delta,
                content: running.clone(),
            });
        }

        let updated_session = self
            .persist_turn_messages(
                &session.session_key,
                &req.message,
                &full_reply,
                &thinking_text,
                &tool_calls_log,
                &undo_ids,
                &approval_ids,
                "offline_mock",
                ctx.thinking_orb_active,
                route_ctx,
            )
            .await?;

        events.push(HermesStreamEvent::Done {
            session_key: session.session_key.clone(),
            message: full_reply,
            thinking: thinking_text,
            thinking_orb_active: ctx.thinking_orb_active,
            gateway_mode: "offline_mock".to_string(),
            resolved_mentions: ctx.resolved_mentions.clone(),
            slash_command: ctx.slash_command.clone(),
            tool_calls: tool_calls_log,
            undo_ids,
            approval_ids,
            message_count: updated_session.message_count,
            token_count: updated_session.token_count,
        });

        Ok(events)
    }

    async fn execute_and_append_chat_tool(
        &self,
        session_key: &str,
        directive: &ChatToolCallDirective,
        events: &mut Vec<HermesStreamEvent>,
        tool_calls_log: &mut Vec<serde_json::Value>,
        undo_ids: &mut Vec<Uuid>,
        approval_ids: &mut Vec<Uuid>,
    ) {
        match self
            .execute_mcp_tool_with_autonomy(
                &directive.name,
                directive.arguments.clone(),
                McpCallContext::direct(session_key),
            )
            .await
        {
            Ok(McpToolExecutionOutcome::ExecutedRead {
                autonomy_tier,
                result,
                ..
            }) => {
                events.push(HermesStreamEvent::ToolCall {
                    session_key: session_key.to_string(),
                    tool_name: directive.name.clone(),
                    arguments: directive.arguments.clone(),
                    autonomy_tier,
                    status: "executed".to_string(),
                    result: Some(result.clone()),
                    undo_id: None,
                    approval_id: None,
                });
                tool_calls_log.push(serde_json::json!({
                    "tool_name": directive.name,
                    "arguments": directive.arguments,
                    "autonomy_tier": autonomy_tier,
                    "status": "executed",
                    "result": result,
                    "undo_id": serde_json::Value::Null,
                }));
            }
            Ok(McpToolExecutionOutcome::ExecutedWithUndo {
                autonomy_tier,
                undo_action,
                result,
                ..
            }) => {
                let undo_id = Some(undo_action.id);
                events.push(HermesStreamEvent::ToolCall {
                    session_key: session_key.to_string(),
                    tool_name: directive.name.clone(),
                    arguments: directive.arguments.clone(),
                    autonomy_tier,
                    status: "executed".to_string(),
                    result: Some(result.clone()),
                    undo_id,
                    approval_id: None,
                });
                undo_ids.push(undo_action.id);
                events.push(HermesStreamEvent::UndoAvailable {
                    session_key: session_key.to_string(),
                    undo_id: undo_action.id,
                    tool_name: undo_action.tool_name,
                    entity_table: undo_action.entity_table,
                    entity_id: undo_action.entity_id,
                    expires_at: undo_action.expires_at,
                });
                tool_calls_log.push(serde_json::json!({
                    "tool_name": directive.name,
                    "arguments": directive.arguments,
                    "autonomy_tier": autonomy_tier,
                    "status": "executed",
                    "result": result,
                    "undo_id": undo_id,
                }));
            }
            Ok(McpToolExecutionOutcome::PendingApproval { approval, .. }) => {
                approval_ids.push(approval.id);
                events.push(HermesStreamEvent::ToolCall {
                    session_key: session_key.to_string(),
                    tool_name: directive.name.clone(),
                    arguments: directive.arguments.clone(),
                    autonomy_tier: hermes_domain::McpAutonomyTier::RequireApproval,
                    status: "awaiting_approval".to_string(),
                    result: None,
                    undo_id: None,
                    approval_id: Some(approval.id),
                });
                events.push(HermesStreamEvent::ApprovalRequired {
                    session_key: session_key.to_string(),
                    approval_id: approval.id,
                    tool_name: approval.tool_name.clone(),
                    payload_json: approval.payload_json.clone(),
                    status: ApprovalStatus::Pending,
                });
                tool_calls_log.push(serde_json::json!({
                    "tool_name": directive.name,
                    "arguments": directive.arguments,
                    "autonomy_tier": "REQUIRE_APPROVAL",
                    "status": "awaiting_approval",
                    "approval_id": approval.id,
                }));
            }
            Err(err) => {
                let tier = crate::mcp::classify_tool_autonomy(&directive.name, &directive.arguments);
                events.push(HermesStreamEvent::ToolCall {
                    session_key: session_key.to_string(),
                    tool_name: directive.name.clone(),
                    arguments: directive.arguments.clone(),
                    autonomy_tier: tier,
                    status: "error".to_string(),
                    result: Some(serde_json::json!({ "error": err.message() })),
                    undo_id: None,
                    approval_id: None,
                });
                tool_calls_log.push(serde_json::json!({
                    "tool_name": directive.name,
                    "arguments": directive.arguments,
                    "autonomy_tier": tier,
                    "status": "error",
                    "error": err.message(),
                }));
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn persist_turn_messages(
        &self,
        session_key: &str,
        user_text: &str,
        assistant_text: &str,
        thinking_text: &str,
        tool_calls_log: &[serde_json::Value],
        undo_ids: &[Uuid],
        approval_ids: &[Uuid],
        gateway_mode: &str,
        high_level_mode: bool,
        route_ctx: Option<serde_json::Value>,
    ) -> Result<HermesSession, ApiError> {
        let now = Utc::now();
        let user_msg = HermesChatMessage {
            id: Some(format!("msg_{}", new_uuid_v7().simple())),
            role: "user".to_string(),
            content: user_text.to_string(),
            thinking: None,
            tool_calls: None,
            undo_ids: None,
            approval_ids: None,
            gateway_mode: None,
            created_at: Some(now),
        };

        let assistant_msg = HermesChatMessage {
            id: Some(format!("msg_{}", new_uuid_v7().simple())),
            role: "assistant".to_string(),
            content: assistant_text.to_string(),
            thinking: Some(thinking_text.to_string()),
            tool_calls: if tool_calls_log.is_empty() {
                None
            } else {
                Some(tool_calls_log.to_vec())
            },
            undo_ids: if undo_ids.is_empty() {
                None
            } else {
                Some(undo_ids.to_vec())
            },
            approval_ids: if approval_ids.is_empty() {
                None
            } else {
                Some(approval_ids.to_vec())
            },
            gateway_mode: Some(gateway_mode.to_string()),
            created_at: Some(Utc::now()),
        };

        self.append_session_turn(
            session_key,
            user_msg,
            assistant_msg,
            high_level_mode,
            route_ctx,
        )
        .await
    }
}

fn extract_inline_thinking(content: &str) -> Option<(String, String)> {
    let start = content.find("<thinking>")?;
    let end = content.find("</thinking>")?;
    if end <= start {
        return None;
    }
    let think = content[start + "<thinking>".len()..end].trim().to_string();
    let mut rest = String::new();
    rest.push_str(&content[..start]);
    rest.push_str(&content[end + "</thinking>".len()..]);
    Some((think, rest.trim().to_string()))
}

fn parse_inline_mcp_directive(message: &str) -> Option<ChatToolCallDirective> {
    let trimmed = message.trim();
    let rest = trimmed.strip_prefix("/mcp ")?.trim();
    let (tool_name, json_part) = match rest.split_once(char::is_whitespace) {
        Some((name, args)) => (name.trim(), args.trim()),
        None => (rest, "{}"),
    };
    if tool_name.is_empty() {
        return None;
    }
    let arguments = serde_json::from_str(json_part).unwrap_or_else(|_| serde_json::json!({}));
    Some(ChatToolCallDirective {
        name: tool_name.to_string(),
        arguments,
    })
}

fn split_into_token_deltas(text: &str) -> Vec<String> {
    if text.is_empty() {
        return vec![String::new()];
    }
    let mut chunks = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        current.push(ch);
        if current.len() >= 48 && (ch == ' ' || ch == '\n') {
            chunks.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}
