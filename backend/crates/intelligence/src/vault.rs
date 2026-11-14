use std::path::{Component, Path, PathBuf};

use chrono::{DateTime, Utc};
use hermes_domain::{
    ApiError, DistillVaultRequest, DistillVaultResponse, VaultEmbeddingRecord, VaultNoteDetail,
    VaultNoteListQuery, VaultNoteSummary, new_uuid_v7,
};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use pgvector::Vector;
use sha2::{Digest, Sha256};
use sqlx::Row;

use crate::service::IntelligenceService;

pub const VAULT_EMBEDDING_DIM: usize = 384;

/// Computes a deterministic 384-dimensional L2-normalized feature-hashing vector
/// over word unigrams, word bigrams, and character trigrams using SHA-256.
pub fn compute_deterministic_embedding_384d(text: &str) -> Vec<f32> {
    let mut vec = vec![0.0_f32; VAULT_EMBEDDING_DIM];
    let normalized = text.to_lowercase();
    let words: Vec<&str> = normalized
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();

    if words.is_empty() {
        vec[0] = 1.0;
        return vec;
    }

    // Word unigrams (weight 2.0)
    for word in &words {
        accumulate_feature(&mut vec, word.as_bytes(), 2.0);
    }

    // Word bigrams (weight 1.5)
    for pair in words.windows(2) {
        let bigram = format!("{}_{}", pair[0], pair[1]);
        accumulate_feature(&mut vec, bigram.as_bytes(), 1.5);
    }

    // Character trigrams (weight 0.75)
    let chars: Vec<char> = normalized.chars().filter(|c| !c.is_whitespace()).collect();
    for tri in chars.windows(3) {
        let s: String = tri.iter().collect();
        accumulate_feature(&mut vec, s.as_bytes(), 0.75);
    }

    let norm = vec.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm > 1e-8 {
        for v in &mut vec {
            *v /= norm;
        }
    } else {
        vec[0] = 1.0;
    }
    vec
}

fn accumulate_feature(vec: &mut [f32], token: &[u8], weight: f32) {
    let digest = Sha256::digest(token);
    for chunk in digest.chunks_exact(4).take(4) {
        let raw = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        let idx = (raw as usize) % VAULT_EMBEDDING_DIM;
        let sign = if (raw & 0x8000_0000) != 0 { 1.0 } else { -1.0 };
        vec[idx] += sign * weight;
    }
}

pub fn sha256_hex(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn slugify_vault_title(title: &str) -> String {
    let mut slug = String::new();
    let mut prev_dash = false;
    for ch in title.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !slug.is_empty() {
            slug.push('-');
            prev_dash = true;
        }
        if slug.len() >= 64 {
            break;
        }
    }
    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "note".to_string()
    } else {
        trimmed
    }
}

pub fn extract_markdown_title(content_md: &str, fallback_stem: &str) -> String {
    let trimmed = content_md.trim_start();
    if let Some(after_open) = trimmed.strip_prefix("---") {
        if let Some((frontmatter, body)) = after_open.split_once("\n---") {
            for line in frontmatter.lines() {
                if let Some(rest) = line.trim().strip_prefix("title:") {
                    let clean = rest.trim().trim_matches('"').trim_matches('\'').trim();
                    if !clean.is_empty() {
                        return clean.to_string();
                    }
                }
            }
            for line in body.lines() {
                if let Some(heading) = line.trim().strip_prefix("# ") {
                    let clean = heading.trim();
                    if !clean.is_empty() {
                        return clean.to_string();
                    }
                }
            }
        }
    }

    for line in content_md.lines() {
        if let Some(heading) = line.trim().strip_prefix("# ") {
            let clean = heading.trim();
            if !clean.is_empty() {
                return clean.to_string();
            }
        }
    }

    fallback_stem.to_string()
}

pub fn chunk_markdown_by_headings(
    content_md: &str,
    fallback_title: &str,
) -> Vec<(i32, String, String)> {
    let mut chunks = Vec::new();
    let mut current_heading = fallback_title.to_string();
    let mut current_lines = Vec::new();

    for line in content_md.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("# ") || trimmed.starts_with("## ") || trimmed.starts_with("### ") {
            let body = current_lines.join("\n").trim().to_string();
            if !body.is_empty() {
                chunks.push((chunks.len() as i32, current_heading.clone(), body));
                current_lines.clear();
            }
            current_heading = trimmed.trim_start_matches('#').trim().to_string();
        }
        current_lines.push(line);
    }

    let tail = current_lines.join("\n").trim().to_string();
    if !tail.is_empty() || chunks.is_empty() {
        chunks.push((
            chunks.len() as i32,
            current_heading,
            if tail.is_empty() {
                fallback_title.to_string()
            } else {
                tail
            },
        ));
    }

    chunks
}

impl IntelligenceService {
    /// Strict lexical + canonical path-traversal guard for `second_brain_dir`.
    /// Rejects empty paths, null bytes, backslashes, absolute paths, `..` traversal
    /// segments, non-`.md` files, and symlinks escaping `second_brain_dir`.
    pub fn resolve_safe_vault_path(
        &self,
        rel_path: &str,
        require_exists: bool,
    ) -> Result<(PathBuf, String), ApiError> {
        let trimmed = rel_path.trim();
        if trimmed.is_empty() {
            return Err(ApiError::bad_request("Vault note path must not be empty"));
        }
        if trimmed.contains('\0') || trimmed.contains('\\') {
            return Err(ApiError::bad_request(
                "Invalid characters in vault note path",
            ));
        }
        if trimmed.starts_with('/') || trimmed.contains("..") {
            return Err(ApiError::bad_request(
                "Path traversal or absolute vault note path is forbidden",
            ));
        }

        let path = Path::new(trimmed);
        if path.is_absolute() {
            return Err(ApiError::bad_request("Absolute vault paths are forbidden"));
        }

        let mut normalized_parts = Vec::new();
        for comp in path.components() {
            match comp {
                Component::Normal(os) => {
                    let part = os
                        .to_str()
                        .ok_or_else(|| ApiError::bad_request("Invalid UTF-8 in vault path"))?;
                    if part.is_empty() || part == "." || part == ".." || part.starts_with('.') {
                        return Err(ApiError::bad_request(
                            "Hidden or traversal path segments are forbidden in vault path",
                        ));
                    }
                    normalized_parts.push(part.to_string());
                }
                Component::CurDir => {}
                Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                    return Err(ApiError::bad_request(
                        "Path traversal or root prefix in vault path is forbidden",
                    ));
                }
            }
        }

        if normalized_parts.is_empty() {
            return Err(ApiError::bad_request("Vault note path must not be empty"));
        }

        let normalized_rel = normalized_parts.join("/");
        let ext = Path::new(&normalized_rel)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        if !ext.eq_ignore_ascii_case("md") {
            return Err(ApiError::bad_request(
                "Only .md Markdown files may be accessed in the Vault",
            ));
        }

        std::fs::create_dir_all(&self.second_brain_dir).map_err(|e| {
            ApiError::internal(format!("Failed to initialize second_brain_dir: {e}"))
        })?;
        let canonical_root = std::fs::canonicalize(&self.second_brain_dir).map_err(|e| {
            ApiError::internal(format!("Failed to canonicalize second_brain_dir: {e}"))
        })?;

        let candidate = canonical_root.join(&normalized_rel);
        if require_exists {
            let symlink_meta = std::fs::symlink_metadata(&candidate).map_err(|_| {
                ApiError::not_found(format!("Vault note '{normalized_rel}' not found"))
            })?;
            let canonical_target = std::fs::canonicalize(&candidate).map_err(|_| {
                ApiError::not_found(format!("Vault note '{normalized_rel}' not found"))
            })?;
            if !canonical_target.starts_with(&canonical_root) {
                return Err(ApiError::forbidden(
                    "Vault symlink target escapes second_brain_dir",
                ));
            }
            if !canonical_target.is_file() && !symlink_meta.is_file() {
                return Err(ApiError::bad_request(format!(
                    "Vault path '{normalized_rel}' is not a regular file"
                )));
            }
            Ok((canonical_target, normalized_rel))
        } else {
            if let Some(parent) = candidate.parent() {
                std::fs::create_dir_all(parent).map_err(|e| {
                    ApiError::internal(format!("Failed to create vault subdirectory: {e}"))
                })?;
                let canonical_parent = std::fs::canonicalize(parent).map_err(|e| {
                    ApiError::internal(format!("Failed to canonicalize vault parent: {e}"))
                })?;
                if !canonical_parent.starts_with(&canonical_root) {
                    return Err(ApiError::forbidden(
                        "Vault parent directory escapes second_brain_dir",
                    ));
                }
            }
            Ok((candidate, normalized_rel))
        }
    }

    pub async fn index_vault_note(
        &self,
        rel_path: &str,
        content_md: &str,
    ) -> Result<Vec<VaultEmbeddingRecord>, ApiError> {
        let stem = Path::new(rel_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled");
        let title = extract_markdown_title(content_md, stem);
        let chunks = chunk_markdown_by_headings(content_md, &title);
        let mut records = Vec::with_capacity(chunks.len());

        for (chunk_idx, heading, chunk_text) in &chunks {
            let content_sha256 = sha256_hex(chunk_text);
            let vec_384 = compute_deterministic_embedding_384d(chunk_text);
            let pg_vec = Vector::from(vec_384);
            let id = new_uuid_v7();
            let metadata = serde_json::json!({
                "title": title,
                "dimensions": VAULT_EMBEDDING_DIM,
            });

            let row = sqlx::query_as::<_, VaultEmbeddingRecord>(
                r#"
                INSERT INTO vault_embeddings (
                    id, vault_note_path, chunk_index, heading, content_text, content_sha256, embedding, metadata, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                ON CONFLICT (vault_note_path, chunk_index) DO UPDATE SET
                    heading = EXCLUDED.heading,
                    content_text = EXCLUDED.content_text,
                    content_sha256 = EXCLUDED.content_sha256,
                    embedding = EXCLUDED.embedding,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()
                RETURNING *
                "#,
            )
            .bind(id)
            .bind(rel_path)
            .bind(*chunk_idx)
            .bind(heading)
            .bind(chunk_text)
            .bind(&content_sha256)
            .bind(pg_vec)
            .bind(&metadata)
            .fetch_one(&self.pool)
            .await
            .map_err(ApiError::from)?;

            records.push(row);
        }

        sqlx::query(
            "DELETE FROM vault_embeddings WHERE vault_note_path = $1 AND chunk_index >= $2",
        )
        .bind(rel_path)
        .bind(chunks.len() as i32)
        .execute(&self.pool)
        .await
        .map_err(ApiError::from)?;

        Ok(records)
    }

    pub async fn search_vault_embeddings(
        &self,
        query: &str,
        limit: i64,
    ) -> Result<Vec<(VaultEmbeddingRecord, f64)>, ApiError> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        let query_vec = Vector::from(compute_deterministic_embedding_384d(trimmed));
        let rows = sqlx::query(
            r#"
            SELECT
                id, vault_note_path, chunk_index, heading, content_text, content_sha256, embedding, metadata, updated_at,
                (1.0 - (embedding <=> $1))::FLOAT8 AS similarity
            FROM vault_embeddings
            ORDER BY embedding <=> $1 ASC
            LIMIT $2
            "#,
        )
        .bind(query_vec)
        .bind(limit.max(1))
        .fetch_all(&self.pool)
        .await
        .map_err(ApiError::from)?;

        let mut results = Vec::with_capacity(rows.len());
        for row in rows {
            let record = VaultEmbeddingRecord {
                id: row.get("id"),
                vault_note_path: row.get("vault_note_path"),
                chunk_index: row.get("chunk_index"),
                heading: row.get("heading"),
                content_text: row.get("content_text"),
                content_sha256: row.get("content_sha256"),
                embedding: row.get("embedding"),
                metadata: row.get("metadata"),
                updated_at: row.get("updated_at"),
            };
            let similarity: f64 = row.try_get("similarity").unwrap_or(0.0);
            results.push((record, similarity));
        }
        Ok(results)
    }

    pub async fn list_vault_notes(
        &self,
        query: VaultNoteListQuery,
    ) -> Result<Vec<VaultNoteSummary>, ApiError> {
        if !self.second_brain_dir.exists() {
            return Ok(Vec::new());
        }
        let canonical_root = match std::fs::canonicalize(&self.second_brain_dir) {
            Ok(root) => root,
            Err(_) => return Ok(Vec::new()),
        };

        let mut raw_files = Vec::new();
        collect_markdown_files_recursive(&canonical_root, &canonical_root, &mut raw_files);

        let folder_filter = query
            .folder
            .as_deref()
            .map(str::trim)
            .filter(|f| !f.is_empty());
        let q_filter = query.q.as_deref().map(str::trim).filter(|q| !q.is_empty());

        let mut semantic_scores = std::collections::HashMap::<String, f64>::new();
        if let Some(q) = q_filter {
            if let Ok(hits) = self.search_vault_embeddings(q, 50).await {
                for (rec, sim) in hits {
                    let entry = semantic_scores.entry(rec.vault_note_path).or_insert(sim);
                    if sim > *entry {
                        *entry = sim;
                    }
                }
            }
        }

        let mut summaries = Vec::new();
        for (abs_path, rel_path) in raw_files {
            let folder = rel_path
                .split_once('/')
                .map(|(top, _)| top.to_string())
                .unwrap_or_default();

            if let Some(f) = folder_filter {
                if !folder.eq_ignore_ascii_case(f) && !rel_path.starts_with(f) {
                    continue;
                }
            }

            let content = std::fs::read_to_string(&abs_path).unwrap_or_default();
            let stem = Path::new(&rel_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Untitled");
            let title = extract_markdown_title(&content, stem);
            let updated_at = std::fs::metadata(&abs_path)
                .ok()
                .and_then(|m| m.modified().ok())
                .map(DateTime::<Utc>::from);

            let mut similarity_score = semantic_scores.get(&rel_path).copied();
            if let Some(q) = q_filter {
                let q_lower = q.to_lowercase();
                let substring_match = title.to_lowercase().contains(&q_lower)
                    || rel_path.to_lowercase().contains(&q_lower)
                    || content.to_lowercase().contains(&q_lower);

                if substring_match {
                    let boosted = similarity_score.unwrap_or(0.5).max(0.75);
                    similarity_score = Some(boosted);
                } else if !query.semantic && similarity_score.unwrap_or(0.0) < 0.25 {
                    continue;
                }
            }

            summaries.push(VaultNoteSummary {
                path: rel_path,
                title,
                folder,
                updated_at,
                similarity_score,
            });
        }

        if q_filter.is_some() {
            summaries.sort_by(|a, b| {
                b.similarity_score
                    .unwrap_or(0.0)
                    .partial_cmp(&a.similarity_score.unwrap_or(0.0))
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.path.cmp(&b.path))
            });
        } else {
            summaries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.path.cmp(&b.path)));
        }

        if let Some(limit) = query.limit {
            summaries.truncate(limit);
        }

        Ok(summaries)
    }

    pub async fn read_vault_note(&self, rel_path: &str) -> Result<VaultNoteDetail, ApiError> {
        let (canonical_target, normalized_rel) = self.resolve_safe_vault_path(rel_path, true)?;
        let content_md = tokio::fs::read_to_string(&canonical_target)
            .await
            .map_err(|_| ApiError::not_found(format!("Vault note '{normalized_rel}' not found")))?;
        let stem = Path::new(&normalized_rel)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled");
        let title = extract_markdown_title(&content_md, stem);
        let updated_at = tokio::fs::metadata(&canonical_target)
            .await
            .ok()
            .and_then(|m| m.modified().ok())
            .map(DateTime::<Utc>::from);

        Ok(VaultNoteDetail {
            path: normalized_rel,
            title,
            content_md,
            updated_at,
        })
    }

    pub async fn distill_to_vault(
        &self,
        req: DistillVaultRequest,
    ) -> Result<DistillVaultResponse, ApiError> {
        let title = req.title.trim();
        if title.is_empty() {
            return Err(ApiError::bad_request("Vault note title must not be empty"));
        }
        let body = req.content_md.trim();
        if body.is_empty() {
            return Err(ApiError::bad_request(
                "Vault note content_md must not be empty",
            ));
        }

        let now = Utc::now();
        let date_prefix = now.format("%Y-%m-%d").to_string();
        let slug = slugify_vault_title(title);
        let rel_path = format!("Inbox/{date_prefix}-{slug}.md");

        let (final_path, normalized_rel) = self.resolve_safe_vault_path(&rel_path, false)?;
        let inbox_dir = final_path
            .parent()
            .ok_or_else(|| ApiError::internal("Invalid Inbox parent directory"))?;
        tokio::fs::create_dir_all(inbox_dir).await.map_err(|e| {
            ApiError::internal(format!("Failed to create Vault Inbox directory: {e}"))
        })?;

        let source_session = req
            .session_key
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("manual");
        let tags_yaml = if req.tags.is_empty() {
            "[\"hermes-distill\"]".to_string()
        } else {
            serde_json::to_string(&req.tags).unwrap_or_else(|_| "[]".to_string())
        };
        let escaped_title = title.replace('"', "\\\"");

        let rendered_md = if body.starts_with("# ") {
            format!(
                "---\ntitle: \"{escaped_title}\"\ncreated_at: \"{}\"\nsource_session: \"{source_session}\"\ntags: {tags_yaml}\n---\n\n{body}\n",
                now.to_rfc3339()
            )
        } else {
            format!(
                "---\ntitle: \"{escaped_title}\"\ncreated_at: \"{}\"\nsource_session: \"{source_session}\"\ntags: {tags_yaml}\n---\n\n# {title}\n\n{body}\n",
                now.to_rfc3339()
            )
        };

        let tmp_filename = format!(".tmp-{}.md", new_uuid_v7().simple());
        let tmp_path = inbox_dir.join(tmp_filename);
        {
            use tokio::io::AsyncWriteExt;
            let mut file = tokio::fs::File::create(&tmp_path).await.map_err(|e| {
                ApiError::internal(format!("Failed to create temporary vault file: {e}"))
            })?;
            file.write_all(rendered_md.as_bytes()).await.map_err(|e| {
                ApiError::internal(format!("Failed to write temporary vault file: {e}"))
            })?;
            file.sync_all().await.map_err(|e| {
                ApiError::internal(format!("Failed to fsync temporary vault file: {e}"))
            })?;
        }

        tokio::fs::rename(&tmp_path, &final_path)
            .await
            .map_err(|e| ApiError::internal(format!("Failed to atomically rename vault file: {e}")))?;

        let _ = self.index_vault_note(&normalized_rel, &rendered_md).await?;

        Ok(DistillVaultResponse {
            vault_note_path: normalized_rel,
            title: title.to_string(),
            created_at: now,
        })
    }

    pub fn spawn_vault_watcher(&self) -> Result<RecommendedWatcher, ApiError> {
        std::fs::create_dir_all(&self.second_brain_dir).map_err(|e| {
            ApiError::internal(format!("Failed to create second_brain_dir for watcher: {e}"))
        })?;
        let canonical_root = std::fs::canonicalize(&self.second_brain_dir).map_err(|e| {
            ApiError::internal(format!("Failed to canonicalize second_brain_dir: {e}"))
        })?;

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<notify::Event>();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        })
        .map_err(|e| ApiError::internal(format!("Failed to initialize vault watcher: {e}")))?;

        watcher
            .watch(&canonical_root, RecursiveMode::Recursive)
            .map_err(|e| ApiError::internal(format!("Failed to watch second_brain_dir: {e}")))?;

        let service = self.clone();
        let root_clone = canonical_root.clone();
        tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                for path in event.paths {
                    let Ok(rel) = path.strip_prefix(&root_clone) else {
                        continue;
                    };
                    let rel_str = rel.to_string_lossy().replace('\\', "/");
                    if rel_str.is_empty()
                        || rel_str.split('/').any(|seg| seg.starts_with('.'))
                        || !rel_str.ends_with(".md")
                    {
                        continue;
                    }
                    match event.kind {
                        EventKind::Create(_) | EventKind::Modify(_) => {
                            if let Ok(content) = tokio::fs::read_to_string(&path).await {
                                let _ = service.index_vault_note(&rel_str, &content).await;
                            }
                        }
                        EventKind::Remove(_) => {
                            let _ = sqlx::query(
                                "DELETE FROM vault_embeddings WHERE vault_note_path = $1",
                            )
                            .bind(&rel_str)
                            .execute(&service.pool)
                            .await;
                        }
                        _ => {}
                    }
                }
            }
        });

        Ok(watcher)
    }
}

fn collect_markdown_files_recursive(
    root: &Path,
    current: &Path,
    out: &mut Vec<(PathBuf, String)>,
) {
    let Ok(entries) = std::fs::read_dir(current) else {
        return;
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();
        if name_str.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let Ok(canonical) = std::fs::canonicalize(&path) else {
            continue;
        };
        if !canonical.starts_with(root) {
            // Skip any symlink that escapes second_brain_dir
            continue;
        }
        if canonical.is_dir() {
            collect_markdown_files_recursive(root, &canonical, out);
        } else if canonical.is_file() {
            if path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("md"))
            {
                if let Ok(rel) = path.strip_prefix(root) {
                    let rel_str = rel.to_string_lossy().replace('\\', "/");
                    out.push((canonical, rel_str));
                }
            }
        }
    }
}
