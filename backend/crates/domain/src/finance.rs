//! Module 11 — Finance Operator (BRL+USD Portfolio, 10x20 Waffle, Macro Monthly Spend Sheet & FIRE Engine).

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum AssetClass {
    BrEquity,
    BrFii,
    BrFixedIncome,
    UsEquity,
    GlobalEtf,
    Crypto,
    Cash,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "UPPERCASE")]
#[serde(rename_all = "UPPERCASE")]
pub enum CurrencyCode {
    Brl,
    Usd,
}

impl Default for CurrencyCode {
    fn default() -> Self {
        Self::Brl
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct PortfolioAsset {
    pub id: Uuid,
    pub symbol: String,
    pub name: String,
    pub asset_class: AssetClass,
    pub currency: CurrencyCode,
    pub in_portfolio: bool,
    pub quantity: Decimal,
    pub avg_cost_cents: i64,
    pub current_price_cents: i64,
    pub previous_close_cents: Option<i64>,
    pub dividend_yield_pct: Option<Decimal>,
    pub target_weight_pct: Decimal,
    pub alert_low_cents: Option<i64>,
    pub alert_high_cents: Option<i64>,
    pub thesis_md: String,
    pub quote_source: String,
    pub last_quote_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreatePortfolioAssetRequest {
    pub symbol: String,
    pub name: String,
    pub asset_class: AssetClass,
    #[serde(default)]
    pub currency: CurrencyCode,
    #[serde(default = "default_true")]
    pub in_portfolio: bool,
    #[serde(default)]
    pub quantity: Decimal,
    #[serde(default)]
    pub avg_cost_cents: i64,
    #[serde(default)]
    pub current_price_cents: i64,
    pub dividend_yield_pct: Option<Decimal>,
    #[serde(default)]
    pub target_weight_pct: Decimal,
    pub alert_low_cents: Option<i64>,
    pub alert_high_cents: Option<i64>,
    #[serde(default)]
    pub thesis_md: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdatePortfolioAssetRequest {
    pub symbol: Option<String>,
    pub name: Option<String>,
    pub asset_class: Option<AssetClass>,
    pub currency: Option<CurrencyCode>,
    pub in_portfolio: Option<bool>,
    pub quantity: Option<Decimal>,
    pub avg_cost_cents: Option<i64>,
    pub current_price_cents: Option<i64>,
    pub dividend_yield_pct: Option<Decimal>,
    pub target_weight_pct: Option<Decimal>,
    pub alert_low_cents: Option<i64>,
    pub alert_high_cents: Option<i64>,
    pub thesis_md: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CandlestickBar {
    pub timestamp: String,
    pub open_cents: i64,
    pub high_cents: i64,
    pub low_cents: i64,
    pub close_cents: i64,
    pub volume: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct AssetCandlesResponse {
    pub symbol: String,
    pub range_key: String,
    pub quote_source: String,
    pub candles: Vec<CandlestickBar>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct QuoteRefreshResponse {
    pub refreshed_count: usize,
    pub fx_usd_brl: Decimal,
    pub fx_source: String,
    pub refreshed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct WaffleTile {
    pub tile_index: usize,
    pub symbol: String,
    pub asset_class: AssetClass,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct RebalanceRecommendation {
    pub asset_id: Uuid,
    pub symbol: String,
    pub current_weight_pct: Decimal,
    pub target_weight_pct: Decimal,
    pub recommended_buy_cents: i64,
    pub recommended_units: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct AllocationResponse {
    pub total_brl_cents: i64,
    pub total_usd_cents: i64,
    pub fx_usd_brl: Decimal,
    pub waffle_tiles: Vec<WaffleTile>,
    pub recommendations: Vec<RebalanceRecommendation>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct MonthlyInvestmentPlan {
    pub month: String,
    pub currency: CurrencyCode,
    pub fx_usd_brl: Decimal,
    pub salary_income_cents: i64,
    pub planned_spend_cents: i64,
    pub actual_spend_cents: Option<i64>,
    pub planned_investment_cents: i64,
    pub actual_invested_cents: i64,
    pub allocations_json: serde_json::Value,
    pub notes_md: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpsertMonthlyInvestmentPlanRequest {
    #[serde(default)]
    pub currency: CurrencyCode,
    pub fx_usd_brl: Option<Decimal>,
    pub salary_income_cents: i64,
    pub planned_spend_cents: i64,
    pub actual_spend_cents: Option<i64>,
    pub planned_investment_cents: i64,
    #[serde(default)]
    pub actual_invested_cents: i64,
    #[serde(default)]
    pub allocations_json: serde_json::Value,
    #[serde(default)]
    pub notes_md: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct RetirementConfig {
    pub id: i16,
    pub expected_real_return_pct: Decimal,
    pub safe_withdrawal_rate_pct: Decimal,
    pub override_retirement_monthly_spend_cents: Option<i64>,
    pub macro_class_targets_json: serde_json::Value,
    pub current_age: Option<i16>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateRetirementConfigRequest {
    pub expected_real_return_pct: Option<Decimal>,
    pub safe_withdrawal_rate_pct: Option<Decimal>,
    pub override_retirement_monthly_spend_cents: Option<i64>,
    pub macro_class_targets_json: Option<serde_json::Value>,
    pub current_age: Option<i16>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct FireProjectionResponse {
    pub current_net_worth_brl_cents: i64,
    pub fi_target_brl_cents: i64,
    pub monthly_contribution_brl_cents: i64,
    pub monthly_retirement_spend_brl_cents: i64,
    pub years_to_fi: f64,
    pub progress_pct: f64,
    pub config: RetirementConfig,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct FireSimulationRequest {
    pub current_net_worth_brl_cents: Option<i64>,
    pub monthly_contribution_brl_cents: Option<i64>,
    pub monthly_retirement_spend_brl_cents: Option<i64>,
    pub expected_real_return_pct: Option<Decimal>,
    pub safe_withdrawal_rate_pct: Option<Decimal>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct PortfolioSnapshot {
    pub snapshot_date: NaiveDate,
    pub total_brl_cents: i64,
    pub total_usd_cents: i64,
    pub fx_usd_brl: Decimal,
    pub fi_target_brl_cents: i64,
    pub projected_years_to_fi: Option<Decimal>,
    pub breakdown_json: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreatePortfolioSnapshotRequest {
    pub snapshot_date: Option<NaiveDate>,
}
