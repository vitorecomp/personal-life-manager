//! Unified REST & service error types (`{ "error": "<code>", "message": "<human readable>" }`).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct ApiErrorBody {
    pub error: String,
    pub message: String,
}

#[derive(Debug, Clone, Error, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(tag = "error", content = "message", rename_all = "snake_case")]
pub enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    InvalidSyncTable(String),
    #[error("{0}")]
    Unauthorized(String),
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    CycleDetected(String),
    #[error("{0}")]
    UnprocessableEntity(String),
    #[error("{0}")]
    Internal(String),
    #[error("{0}")]
    BadGateway(String),
}

impl ApiError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self::BadRequest(msg.into())
    }

    pub fn invalid_sync_table(table: &str) -> Self {
        Self::InvalidSyncTable(format!(
            "Table '{}' is not in the 8 allowed mobile sync tables",
            table
        ))
    }

    pub fn unauthorized(msg: impl Into<String>) -> Self {
        Self::Unauthorized(msg.into())
    }

    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::Forbidden(msg.into())
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::NotFound(msg.into())
    }

    pub fn conflict(msg: impl Into<String>) -> Self {
        Self::Conflict(msg.into())
    }

    pub fn cycle_detected(msg: impl Into<String>) -> Self {
        Self::CycleDetected(msg.into())
    }

    pub fn unprocessable(msg: impl Into<String>) -> Self {
        Self::UnprocessableEntity(msg.into())
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self::Internal(msg.into())
    }

    pub fn bad_gateway(msg: impl Into<String>) -> Self {
        Self::BadGateway(msg.into())
    }

    pub fn status_code(&self) -> u16 {
        match self {
            Self::BadRequest(_) | Self::InvalidSyncTable(_) => 400,
            Self::Unauthorized(_) => 401,
            Self::Forbidden(_) => 403,
            Self::NotFound(_) => 404,
            Self::Conflict(_) => 409,
            Self::CycleDetected(_) | Self::UnprocessableEntity(_) => 422,
            Self::Internal(_) => 500,
            Self::BadGateway(_) => 502,
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::BadRequest(_) => "bad_request",
            Self::InvalidSyncTable(_) => "invalid_sync_table",
            Self::Unauthorized(_) => "unauthorized",
            Self::Forbidden(_) => "forbidden",
            Self::NotFound(_) => "not_found",
            Self::Conflict(_) => "conflict",
            Self::CycleDetected(_) => "CYCLE_DETECTED",
            Self::UnprocessableEntity(_) => "unprocessable_entity",
            Self::Internal(_) => "internal_error",
            Self::BadGateway(_) => "bad_gateway",
        }
    }

    pub fn message(&self) -> &str {
        match self {
            Self::BadRequest(m)
            | Self::InvalidSyncTable(m)
            | Self::Unauthorized(m)
            | Self::Forbidden(m)
            | Self::NotFound(m)
            | Self::Conflict(m)
            | Self::CycleDetected(m)
            | Self::UnprocessableEntity(m)
            | Self::Internal(m)
            | Self::BadGateway(m) => m,
        }
    }

    pub fn to_body(&self) -> ApiErrorBody {
        ApiErrorBody {
            error: self.code().to_string(),
            message: self.message().to_string(),
        }
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        match err {
            sqlx::Error::RowNotFound => Self::NotFound("Requested resource not found".to_string()),
            sqlx::Error::Database(db_err) => {
                let code = db_err.code().map(|c| c.into_owned()).unwrap_or_default();
                match code.as_str() {
                    "23505" => Self::Conflict(format!("Unique constraint conflict: {}", db_err.message())),
                    "23503" => Self::BadRequest(format!("Foreign key constraint failed: {}", db_err.message())),
                    "23514" => Self::BadRequest(format!("Check constraint failed: {}", db_err.message())),
                    _ => Self::Internal(format!("Database error: {}", db_err.message())),
                }
            }
            other => Self::Internal(format!("Database error: {other}")),
        }
    }
}

impl From<serde_json::Error> for ApiError {
    fn from(err: serde_json::Error) -> Self {
        Self::BadRequest(format!("Invalid JSON payload: {err}"))
    }
}
