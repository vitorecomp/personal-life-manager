//! Module 11 — Finance Operator (BRL+USD Portfolio, 10x20 Waffle, Macro Monthly Spend Sheet & FIRE Engine).

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::{Decimal, prelude::ToPrimitive};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum AssetClass {
    #[serde(alias = "br_equities")]
    BrEquity,
    #[serde(alias = "br_fiis")]
    BrFii,
    BrFixedIncome,
    #[serde(alias = "us_equities")]
    UsEquity,
    #[serde(alias = "global_etfs")]
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

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct AssetListFilter {
    pub in_portfolio: Option<bool>,
    pub is_watchlist: Option<bool>,
    pub asset_class: Option<AssetClass>,
    pub currency: Option<CurrencyCode>,
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

impl PortfolioAsset {
    pub fn is_watchlist(&self) -> bool {
        !self.in_portfolio
    }

    pub fn market_value_native_cents(&self) -> i64 {
        (self.quantity * Decimal::from(self.current_price_cents))
            .round()
            .to_i64()
            .unwrap_or(0)
    }

    pub fn cost_basis_native_cents(&self) -> i64 {
        (self.quantity * Decimal::from(self.avg_cost_cents))
            .round()
            .to_i64()
            .unwrap_or(0)
    }

    pub fn unrealized_pnl_native_cents(&self) -> i64 {
        self.market_value_native_cents() - self.cost_basis_native_cents()
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreatePortfolioAssetRequest {
    #[serde(default)]
    pub id: Option<Uuid>,
    #[serde(alias = "ticker")]
    pub symbol: String,
    pub name: String,
    pub asset_class: AssetClass,
    #[serde(default)]
    pub currency: CurrencyCode,
    #[serde(default = "default_true")]
    pub in_portfolio: bool,
    #[serde(default)]
    pub is_watchlist: Option<bool>,
    #[serde(default)]
    pub quantity: Decimal,
    #[serde(default, alias = "average_cost_cents", alias = "cost_basis_cents")]
    pub avg_cost_cents: i64,
    #[serde(default, alias = "last_price_cents")]
    pub current_price_cents: i64,
    #[serde(default)]
    pub previous_close_cents: Option<i64>,
    pub dividend_yield_pct: Option<Decimal>,
    #[serde(default, alias = "target_pct")]
    pub target_weight_pct: Decimal,
    #[serde(alias = "alert_below_cents", alias = "price_alert_low_cents", alias = "min_price_cents")]
    pub alert_low_cents: Option<i64>,
    #[serde(alias = "alert_above_cents", alias = "price_alert_high_cents", alias = "max_price_cents")]
    pub alert_high_cents: Option<i64>,
    #[serde(default)]
    pub thesis_md: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdatePortfolioAssetRequest {
    #[serde(alias = "ticker")]
    pub symbol: Option<String>,
    pub name: Option<String>,
    pub asset_class: Option<AssetClass>,
    pub currency: Option<CurrencyCode>,
    pub in_portfolio: Option<bool>,
    pub is_watchlist: Option<bool>,
    pub quantity: Option<Decimal>,
    #[serde(alias = "average_cost_cents", alias = "cost_basis_cents")]
    pub avg_cost_cents: Option<i64>,
    #[serde(alias = "last_price_cents")]
    pub current_price_cents: Option<i64>,
    pub previous_close_cents: Option<i64>,
    pub dividend_yield_pct: Option<Decimal>,
    #[serde(alias = "target_pct")]
    pub target_weight_pct: Option<Decimal>,
    #[serde(alias = "alert_below_cents", alias = "price_alert_low_cents", alias = "min_price_cents")]
    pub alert_low_cents: Option<i64>,
    #[serde(alias = "alert_above_cents", alias = "price_alert_high_cents", alias = "max_price_cents")]
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
    #[serde(default)]
    pub post_buy_weight_pct: Decimal,
    pub recommended_buy_cents: i64,
    pub recommended_units: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct AllocationResponse {
    #[serde(default)]
    pub base_currency: CurrencyCode,
    pub total_brl_cents: i64,
    pub total_usd_cents: i64,
    pub fx_usd_brl: Decimal,
    #[serde(default)]
    pub new_contribution_cents: i64,
    #[serde(default)]
    pub target_weight_sum_pct: Decimal,
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
    #[sqlx(default)]
    #[serde(default)]
    pub investable_surplus_cents: i64,
    #[sqlx(default)]
    #[serde(default)]
    pub net_cashflow_cents: i64,
    #[sqlx(default)]
    #[serde(default)]
    pub savings_rate_pct: f64,
    pub allocations_json: serde_json::Value,
    pub notes_md: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl MonthlyInvestmentPlan {
    pub fn with_computed_metrics(mut self) -> Self {
        let effective_spend = self.actual_spend_cents.unwrap_or(self.planned_spend_cents);
        self.net_cashflow_cents = self.salary_income_cents - effective_spend;
        self.investable_surplus_cents = self.net_cashflow_cents.max(0);
        self.savings_rate_pct = if self.salary_income_cents > 0 {
            let raw = (self.net_cashflow_cents as f64 / self.salary_income_cents as f64) * 100.0;
            if raw.is_finite() {
                (raw * 10.0).round() / 10.0
            } else {
                0.0
            }
        } else {
            0.0
        };
        self
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpsertMonthlyInvestmentPlanRequest {
    #[serde(default)]
    pub currency: CurrencyCode,
    pub fx_usd_brl: Option<Decimal>,
    #[serde(default, alias = "net_salary_cents")]
    pub salary_income_cents: i64,
    #[serde(default)]
    pub other_income_cents: i64,
    #[serde(default, alias = "planned_living_spend_cents")]
    pub planned_spend_cents: i64,
    #[serde(default, alias = "actual_living_spend_cents")]
    pub actual_spend_cents: Option<i64>,
    #[serde(default)]
    pub planned_investment_cents: i64,
    #[serde(default, alias = "actual_investment_cents")]
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
    #[serde(alias = "real_return_pct", alias = "annual_return_pct")]
    pub expected_real_return_pct: Option<Decimal>,
    #[serde(alias = "swr_pct")]
    pub safe_withdrawal_rate_pct: Option<Decimal>,
    pub override_retirement_monthly_spend_cents: Option<i64>,
    pub macro_class_targets_json: Option<serde_json::Value>,
    pub current_age: Option<i16>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct FireTrajectoryPoint {
    pub year_offset: i32,
    pub calendar_year: i32,
    pub age: Option<i16>,
    pub projected_net_worth_cents: i64,
    pub total_contributions_cents: i64,
    pub fi_target_cents: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct FireProjectionResponse {
    pub current_net_worth_brl_cents: i64,
    pub fi_target_brl_cents: i64,
    pub fire_number_cents: i64,
    pub coast_fire_cents: i64,
    pub monthly_contribution_brl_cents: i64,
    pub monthly_retirement_spend_brl_cents: i64,
    pub years_to_fi: f64,
    pub months_to_fi: i32,
    pub projected_fi_date: Option<NaiveDate>,
    pub progress_pct: f64,
    pub fi_progress_pct: f64,
    pub passive_income_coverage_pct: f64,
    pub unreachable: bool,
    pub trajectory: Vec<FireTrajectoryPoint>,
    pub config: RetirementConfig,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct FireSimulationRequest {
    pub current_net_worth_brl_cents: Option<i64>,
    #[serde(alias = "monthly_investment_cents", alias = "new_contribution_cents")]
    pub monthly_contribution_brl_cents: Option<i64>,
    #[serde(alias = "monthly_spend_cents")]
    pub monthly_retirement_spend_brl_cents: Option<i64>,
    #[serde(alias = "real_return_pct", alias = "annual_return_pct")]
    pub expected_real_return_pct: Option<Decimal>,
    #[serde(alias = "swr_pct")]
    pub safe_withdrawal_rate_pct: Option<Decimal>,
    #[serde(default)]
    pub current_age: Option<i16>,
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
