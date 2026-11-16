//! Module 11 — Multi-Market Finance Operator, `10×20` Waffle, Buy-Only Rebalancer,
//! Macro Monthly Spend & `rust_decimal` FIRE Engine (`F17`).

use std::time::Duration as StdDuration;

use chrono::{Datelike, Duration, Months, Utc};
use hermes_domain::error::ApiError;
use hermes_domain::events::SystemEvent;
use hermes_domain::finance::{
    AllocationResponse, AssetCandlesResponse, AssetClass, AssetListFilter, CandlestickBar,
    CreatePortfolioAssetRequest, CreatePortfolioSnapshotRequest, CurrencyCode,
    FireProjectionResponse, FireSimulationRequest, FireTrajectoryPoint, MonthlyInvestmentPlan,
    PortfolioAsset, PortfolioSnapshot, QuoteRefreshResponse, RebalanceRecommendation,
    RetirementConfig, UpdatePortfolioAssetRequest, UpdateRetirementConfigRequest,
    UpsertMonthlyInvestmentPlanRequest, WaffleTile,
};
use hermes_domain::id::new_uuid_v7;
use rust_decimal::Decimal;
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use uuid::Uuid;

use crate::service::LifeOpsService;

impl LifeOpsService {
    // =========================================================================
    // 1. Multi-Market Portfolio & Watchlist Assets CRUD
    // =========================================================================

    pub async fn list_assets(
        &self,
        filter: AssetListFilter,
    ) -> Result<Vec<PortfolioAsset>, ApiError> {
        let mut assets = sqlx::query_as::<_, PortfolioAsset>(
            "SELECT * FROM portfolio_assets ORDER BY in_portfolio DESC, symbol ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        let effective_in_portfolio = filter
            .in_portfolio
            .or_else(|| filter.is_watchlist.map(|w| !w));

        if let Some(in_p) = effective_in_portfolio {
            assets.retain(|a| a.in_portfolio == in_p);
        }
        if let Some(ac) = filter.asset_class {
            assets.retain(|a| a.asset_class == ac);
        }
        if let Some(curr) = filter.currency {
            assets.retain(|a| a.currency == curr);
        }

        Ok(assets)
    }

    pub async fn get_asset(&self, id: Uuid) -> Result<PortfolioAsset, ApiError> {
        sqlx::query_as::<_, PortfolioAsset>("SELECT * FROM portfolio_assets WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| ApiError::not_found(format!("Portfolio asset {id} not found")))
    }

    pub async fn create_asset(
        &self,
        req: CreatePortfolioAssetRequest,
    ) -> Result<PortfolioAsset, ApiError> {
        let symbol = req.symbol.trim().to_ascii_uppercase();
        if symbol.is_empty() {
            return Err(ApiError::bad_request("Asset symbol must not be empty"));
        }
        let name = req.name.trim().to_string();
        if name.is_empty() {
            return Err(ApiError::bad_request("Asset name must not be empty"));
        }
        validate_asset_numbers(
            req.quantity,
            req.avg_cost_cents,
            req.current_price_cents,
            req.target_weight_pct,
            req.alert_low_cents,
            req.alert_high_cents,
        )?;

        let existing: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM portfolio_assets WHERE UPPER(symbol) = $1",
        )
        .bind(&symbol)
        .fetch_optional(&self.pool)
        .await?;
        if existing.is_some() {
            return Err(ApiError::conflict(format!(
                "Asset with symbol '{symbol}' already exists"
            )));
        }

        let in_portfolio = req
            .is_watchlist
            .map(|w| !w)
            .unwrap_or(req.in_portfolio);
        let id = req.id.unwrap_or_else(new_uuid_v7);

        let asset = sqlx::query_as::<_, PortfolioAsset>(
            r#"
            INSERT INTO portfolio_assets (
                id, symbol, name, asset_class, currency, in_portfolio,
                quantity, avg_cost_cents, current_price_cents, previous_close_cents,
                dividend_yield_pct, target_weight_pct, alert_low_cents, alert_high_cents,
                thesis_md, quote_source, last_quote_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'manual', NOW())
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(&symbol)
        .bind(&name)
        .bind(req.asset_class)
        .bind(req.currency)
        .bind(in_portfolio)
        .bind(req.quantity)
        .bind(req.avg_cost_cents)
        .bind(req.current_price_cents)
        .bind(req.previous_close_cents)
        .bind(req.dividend_yield_pct)
        .bind(req.target_weight_pct)
        .bind(req.alert_low_cents)
        .bind(req.alert_high_cents)
        .bind(&req.thesis_md)
        .fetch_one(&self.pool)
        .await?;

        self.check_and_emit_price_alert(&asset);
        self.recalculate_linked_finance_goals().await;

        Ok(asset)
    }

    pub async fn update_asset(
        &self,
        id: Uuid,
        req: UpdatePortfolioAssetRequest,
    ) -> Result<PortfolioAsset, ApiError> {
        let existing = self.get_asset(id).await?;
        let name = req
            .name
            .map(|n| n.trim().to_string())
            .unwrap_or(existing.name);
        if name.is_empty() {
            return Err(ApiError::bad_request("Asset name must not be empty"));
        }

        let asset_class = req.asset_class.unwrap_or(existing.asset_class);
        let currency = req.currency.unwrap_or(existing.currency);
        let in_portfolio = req
            .is_watchlist
            .map(|w| !w)
            .or(req.in_portfolio)
            .unwrap_or(existing.in_portfolio);
        let quantity = req.quantity.unwrap_or(existing.quantity);
        let avg_cost_cents = req.avg_cost_cents.unwrap_or(existing.avg_cost_cents);
        let current_price_cents = req
            .current_price_cents
            .unwrap_or(existing.current_price_cents);
        let previous_close_cents = req
            .previous_close_cents
            .or(existing.previous_close_cents);
        let dividend_yield_pct = req.dividend_yield_pct.or(existing.dividend_yield_pct);
        let target_weight_pct = req.target_weight_pct.unwrap_or(existing.target_weight_pct);
        let alert_low_cents = req.alert_low_cents.or(existing.alert_low_cents);
        let alert_high_cents = req.alert_high_cents.or(existing.alert_high_cents);
        let thesis_md = req.thesis_md.unwrap_or(existing.thesis_md);

        validate_asset_numbers(
            quantity,
            avg_cost_cents,
            current_price_cents,
            target_weight_pct,
            alert_low_cents,
            alert_high_cents,
        )?;

        let updated = sqlx::query_as::<_, PortfolioAsset>(
            r#"
            UPDATE portfolio_assets
            SET name = $2,
                asset_class = $3,
                currency = $4,
                in_portfolio = $5,
                quantity = $6,
                avg_cost_cents = $7,
                current_price_cents = $8,
                previous_close_cents = $9,
                dividend_yield_pct = $10,
                target_weight_pct = $11,
                alert_low_cents = $12,
                alert_high_cents = $13,
                thesis_md = $14,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(name)
        .bind(asset_class)
        .bind(currency)
        .bind(in_portfolio)
        .bind(quantity)
        .bind(avg_cost_cents)
        .bind(current_price_cents)
        .bind(previous_close_cents)
        .bind(dividend_yield_pct)
        .bind(target_weight_pct)
        .bind(alert_low_cents)
        .bind(alert_high_cents)
        .bind(thesis_md)
        .fetch_one(&self.pool)
        .await?;

        self.check_and_emit_price_alert(&updated);
        self.recalculate_linked_finance_goals().await;

        Ok(updated)
    }

    pub async fn upsert_asset(
        &self,
        req: CreatePortfolioAssetRequest,
    ) -> Result<PortfolioAsset, ApiError> {
        let symbol = req.symbol.trim().to_ascii_uppercase();
        if symbol.is_empty() {
            return Err(ApiError::bad_request("Asset symbol must not be empty"));
        }

        let existing_id: Option<Uuid> = if let Some(id) = req.id {
            sqlx::query_scalar("SELECT id FROM portfolio_assets WHERE id = $1")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?
        } else {
            None
        }
        .or({
            // Will check by symbol below if id was not found
            None
        });

        let target_id = match existing_id {
            Some(id) => Some(id),
            None => {
                sqlx::query_scalar("SELECT id FROM portfolio_assets WHERE UPPER(symbol) = $1")
                    .bind(&symbol)
                    .fetch_optional(&self.pool)
                    .await?
            }
        };

        if let Some(id) = target_id {
            self.update_asset(
                id,
                UpdatePortfolioAssetRequest {
                    symbol: Some(symbol),
                    name: Some(req.name),
                    asset_class: Some(req.asset_class),
                    currency: Some(req.currency),
                    in_portfolio: Some(req.in_portfolio),
                    is_watchlist: req.is_watchlist,
                    quantity: Some(req.quantity),
                    avg_cost_cents: Some(req.avg_cost_cents),
                    current_price_cents: Some(req.current_price_cents),
                    previous_close_cents: req.previous_close_cents,
                    dividend_yield_pct: req.dividend_yield_pct,
                    target_weight_pct: Some(req.target_weight_pct),
                    alert_low_cents: req.alert_low_cents,
                    alert_high_cents: req.alert_high_cents,
                    thesis_md: Some(req.thesis_md),
                },
            )
            .await
        } else {
            self.create_asset(req).await
        }
    }

    pub async fn delete_asset(&self, id: Uuid) -> Result<(), ApiError> {
        let res = sqlx::query("DELETE FROM portfolio_assets WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        if res.rows_affected() == 0 {
            return Err(ApiError::not_found(format!("Portfolio asset {id} not found")));
        }
        self.recalculate_linked_finance_goals().await;
        Ok(())
    }

    fn check_and_emit_price_alert(&self, asset: &PortfolioAsset) {
        if asset.current_price_cents <= 0 {
            return;
        }
        if let Some(high) = asset.alert_high_cents
            && asset.current_price_cents >= high
        {
            self.emit_event(SystemEvent::PortfolioPriceAlert {
                asset_id: asset.id,
                symbol: asset.symbol.clone(),
                current_price_cents: asset.current_price_cents,
                alert_low_cents: asset.alert_low_cents,
                alert_high_cents: asset.alert_high_cents,
                direction: "high".to_string(),
                timestamp: Utc::now(),
            });
        } else if let Some(low) = asset.alert_low_cents
            && asset.current_price_cents <= low
        {
            self.emit_event(SystemEvent::PortfolioPriceAlert {
                asset_id: asset.id,
                symbol: asset.symbol.clone(),
                current_price_cents: asset.current_price_cents,
                alert_low_cents: asset.alert_low_cents,
                alert_high_cents: asset.alert_high_cents,
                direction: "low".to_string(),
                timestamp: Utc::now(),
            });
        }
    }

    async fn recalculate_linked_finance_goals(&self) {
        if let Ok(goal_ids) = sqlx::query_scalar::<_, Uuid>(
            "SELECT DISTINCT goal_id FROM goal_key_results WHERE metric_type = 'linked_finance'",
        )
        .fetch_all(&self.pool)
        .await
        {
            for gid in goal_ids {
                let _ = self.recalculate_goal_rollups(gid).await;
            }
        }
    }

    // =========================================================================
    // 2. Historical OHLCV Candlesticks & Deterministic Fallback Synthesis
    // =========================================================================

    pub async fn get_asset_candles(
        &self,
        id: Uuid,
        range_key: &str,
    ) -> Result<AssetCandlesResponse, ApiError> {
        let asset = self.get_asset(id).await?;
        let raw_upper = range_key.trim().to_ascii_uppercase();
        let normalized_range = match raw_upper.as_str() {
            "" | "30D" | "1MO" | "MONTH" | "90D" | "3M" | "3MO" | "QUARTER" => "1M".to_string(),
            "24H" | "DAY" => "1D".to_string(),
            "1W" | "WEEK" => "7D".to_string(),
            "365D" | "12M" | "YEAR" => "1Y".to_string(),
            "MAX" => "ALL".to_string(),
            other => other.to_string(),
        };
        if !matches!(
            normalized_range.as_str(),
            "1D" | "7D" | "1M" | "1Y" | "ALL"
        ) {
            return Err(ApiError::bad_request(
                "range_key must be one of '1D', '7D', '1M', '1Y', or 'ALL'",
            ));
        }
        let history_row: Option<(serde_json::Value, String)> = sqlx::query_as(
            "SELECT candles_json, quote_source FROM asset_quote_history WHERE symbol = $1 AND range_key = $2",
        )
        .bind(&asset.symbol)
        .bind(&normalized_range)
        .fetch_optional(&self.pool)
        .await?;

        if let Some((candles_json, quote_source)) = history_row
            && let Ok(candles) = serde_json::from_value::<Vec<CandlestickBar>>(candles_json)
            && !candles.is_empty()
        {
            return Ok(AssetCandlesResponse {
                symbol: asset.symbol,
                range_key: normalized_range,
                quote_source,
                candles,
            });
        }

        let candles = synthesize_deterministic_candles(&asset, &normalized_range);
        Ok(AssetCandlesResponse {
            symbol: asset.symbol,
            range_key: normalized_range,
            quote_source: "synthetic_fallback".to_string(),
            candles,
        })
    }

    // =========================================================================
    // 3. Live Quote & USD/BRL FX Refresh with Cached Fallback & Price Alerts
    // =========================================================================

    pub async fn get_cached_fx_usd_brl(&self) -> Result<(Decimal, String), ApiError> {
        let row: Option<(Decimal, String)> = sqlx::query_as(
            "SELECT rate, source FROM fx_rates_cache WHERE pair = 'USD_BRL'",
        )
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some((rate, source)) if rate > Decimal::ZERO => Ok((rate, source)),
            _ => Ok((Decimal::new(50000, 4), "seeded".to_string())),
        }
    }

    pub async fn refresh_quotes_and_fx(&self) -> Result<QuoteRefreshResponse, ApiError> {
        let (mut fx_usd_brl, cached_source) = self.get_cached_fx_usd_brl().await?;
        let mut fx_source = if cached_source == "seeded" {
            "seeded".to_string()
        } else {
            "cached".to_string()
        };

        // 1. Optional FX refresh (5s timeout, clean fallback to cached DB rate)
        if let Some(fx_url) = self.config.fx_api_url.as_deref().map(str::trim)
            && !fx_url.is_empty()
            && let Ok(resp) = self
                .http_client
                .get(fx_url)
                .timeout(StdDuration::from_secs(5))
                .send()
                .await
            && resp.status().is_success()
            && let Ok(body) = resp.json::<serde_json::Value>().await
            && let Some(parsed_fx) = extract_fx_rate_from_json(&body)
            && parsed_fx > Decimal::ZERO
        {
            fx_usd_brl = parsed_fx.round_dp(6);
            fx_source = "live_api".to_string();
            let brl_usd = (Decimal::ONE / fx_usd_brl).round_dp(6);

            let _ = sqlx::query(
                r#"
                INSERT INTO fx_rates_cache (pair, rate, source, fetched_at)
                VALUES ('USD_BRL', $1, 'live_api', NOW()),
                       ('BRL_USD', $2, 'live_api', NOW())
                ON CONFLICT (pair) DO UPDATE SET
                    rate = EXCLUDED.rate,
                    source = EXCLUDED.source,
                    fetched_at = NOW()
                "#,
            )
            .bind(fx_usd_brl)
            .bind(brl_usd)
            .execute(&self.pool)
            .await;
        }

        // 2. Optional Quotes refresh (5s timeout, clean fallback to cached asset prices)
        let mut refreshed_count = 0_usize;
        if let Some(quote_url) = self.config.quote_api_url.as_deref().map(str::trim)
            && !quote_url.is_empty()
            && let Ok(resp) = self
                .http_client
                .get(quote_url)
                .timeout(StdDuration::from_secs(5))
                .send()
                .await
            && resp.status().is_success()
            && let Ok(body) = resp.json::<serde_json::Value>().await
        {
            let assets = sqlx::query_as::<_, PortfolioAsset>(
                "SELECT * FROM portfolio_assets ORDER BY symbol ASC",
            )
            .fetch_all(&self.pool)
            .await?;

            for asset in assets {
                if let Some((new_price, prev_close, candles_opt)) =
                    extract_asset_quote_from_json(&body, &asset.symbol)
                    && new_price > 0
                {
                    let prev = prev_close.or(Some(asset.current_price_cents));
                    sqlx::query(
                        r#"
                        UPDATE portfolio_assets
                        SET previous_close_cents = $2,
                            current_price_cents = $3,
                            quote_source = 'live_api',
                            last_quote_at = NOW(),
                            updated_at = NOW()
                        WHERE id = $1
                        "#,
                    )
                    .bind(asset.id)
                    .bind(prev)
                    .bind(new_price)
                    .execute(&self.pool)
                    .await?;

                    if let Some(candles) = candles_opt {
                        let _ = sqlx::query(
                            r#"
                            INSERT INTO asset_quote_history (symbol, range_key, candles_json, quote_source, fetched_at)
                            VALUES ($1, '1M', $2, 'live_api', NOW())
                            ON CONFLICT (symbol, range_key) DO UPDATE SET
                                candles_json = EXCLUDED.candles_json,
                                quote_source = 'live_api',
                                fetched_at = NOW()
                            "#,
                        )
                        .bind(&asset.symbol)
                        .bind(candles)
                        .execute(&self.pool)
                        .await;
                    }
                    refreshed_count += 1;
                }
            }
        }

        // Check price alerts across all assets (both holdings and watchlist)
        let all_assets = sqlx::query_as::<_, PortfolioAsset>(
            "SELECT * FROM portfolio_assets ORDER BY symbol ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        for asset in &all_assets {
            self.check_and_emit_price_alert(asset);
        }

        self.recalculate_linked_finance_goals().await;

        Ok(QuoteRefreshResponse {
            refreshed_count,
            fx_usd_brl,
            fx_source,
            refreshed_at: Utc::now(),
        })
    }

    // =========================================================================
    // 4. 10×20 (200-Tile) Hare-Niemeyer Waffle Grid & Buy-Only Smart Rebalancer
    // =========================================================================

    pub async fn get_portfolio_allocation(
        &self,
        base_currency: Option<CurrencyCode>,
        new_contribution_cents: Option<i64>,
    ) -> Result<AllocationResponse, ApiError> {
        let base_curr = base_currency.unwrap_or(CurrencyCode::Brl);
        let (fx_usd_brl, _) = self.get_cached_fx_usd_brl().await?;
        let holdings = sqlx::query_as::<_, PortfolioAsset>(
            "SELECT * FROM portfolio_assets WHERE in_portfolio = TRUE ORDER BY symbol ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut holding_vals: Vec<(PortfolioAsset, i64, i64)> = Vec::with_capacity(holdings.len());
        let mut total_brl_cents = 0_i64;
        let mut total_usd_cents = 0_i64;
        let mut target_weight_sum_pct = Decimal::ZERO;

        for h in holdings {
            target_weight_sum_pct += h.target_weight_pct;
            let native_dec = (h.quantity * Decimal::from(h.current_price_cents)).round();
            let (brl_dec, usd_dec) = match h.currency {
                CurrencyCode::Brl => (native_dec, (native_dec / fx_usd_brl).round()),
                CurrencyCode::Usd => ((native_dec * fx_usd_brl).round(), native_dec),
            };
            let brl_i64 = brl_dec.to_i64().unwrap_or(0).max(0);
            let usd_i64 = usd_dec.to_i64().unwrap_or(0).max(0);
            total_brl_cents += brl_i64;
            total_usd_cents += usd_i64;
            holding_vals.push((h, brl_i64, usd_i64));
        }

        // 1. 10x20 = 200-Tile Hare-Niemeyer Largest-Remainder Waffle Grid
        let waffle_tiles = build_hare_niemeyer_waffle_tiles(&holding_vals, total_brl_cents);

        // 2. Resolve new contribution in BRL cents
        let contribution_input_cents = match new_contribution_cents {
            Some(c) => c.max(0),
            None => {
                let latest_plan = sqlx::query_as::<_, MonthlyInvestmentPlan>(
                    "SELECT * FROM monthly_investment_plans ORDER BY month DESC LIMIT 1",
                )
                .fetch_optional(&self.pool)
                .await?;
                latest_plan
                    .map(|p| p.with_computed_metrics().investable_surplus_cents.max(0))
                    .unwrap_or(0)
            }
        };

        let contribution_brl_cents = match base_curr {
            CurrencyCode::Brl => contribution_input_cents,
            CurrencyCode::Usd => (Decimal::from(contribution_input_cents) * fx_usd_brl)
                .round()
                .to_i64()
                .unwrap_or(0)
                .max(0),
        };

        // 3. Buy-Only Smart Rebalancer (strictly non-negative, zero sells)
        let recommendations = compute_buy_only_recommendations(
            &holding_vals,
            total_brl_cents,
            contribution_brl_cents,
            base_curr,
            fx_usd_brl,
        );

        Ok(AllocationResponse {
            total_brl_cents,
            total_usd_cents,
            fx_usd_brl,
            base_currency: base_curr,
            new_contribution_cents: contribution_input_cents,
            target_weight_sum_pct: target_weight_sum_pct.round_dp(2),
            waffle_tiles,
            recommendations,
        })
    }

    // =========================================================================
    // 5. Single Macro 'YYYY-MM' Monthly Salary vs. Spend & Investment Planner
    // =========================================================================

    pub async fn list_monthly_plans(
        &self,
        limit: Option<i64>,
    ) -> Result<Vec<MonthlyInvestmentPlan>, ApiError> {
        let lim = limit.unwrap_or(24).clamp(1, 240);
        let plans = sqlx::query_as::<_, MonthlyInvestmentPlan>(
            "SELECT * FROM monthly_investment_plans ORDER BY month DESC LIMIT $1",
        )
        .bind(lim)
        .fetch_all(&self.pool)
        .await?;

        Ok(plans
            .into_iter()
            .map(MonthlyInvestmentPlan::with_computed_metrics)
            .collect())
    }

    pub async fn get_monthly_plan(&self, month: &str) -> Result<MonthlyInvestmentPlan, ApiError> {
        let normalized_month = validate_month_key(month)?;
        let plan = sqlx::query_as::<_, MonthlyInvestmentPlan>(
            "SELECT * FROM monthly_investment_plans WHERE month = $1",
        )
        .bind(&normalized_month)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "Monthly investment plan for '{normalized_month}' not found"
            ))
        })?;

        Ok(plan.with_computed_metrics())
    }

    pub async fn upsert_monthly_plan(
        &self,
        month: &str,
        req: UpsertMonthlyInvestmentPlanRequest,
    ) -> Result<MonthlyInvestmentPlan, ApiError> {
        let normalized_month = validate_month_key(month)?;
        if req.salary_income_cents < 0
            || req.other_income_cents < 0
            || req.planned_spend_cents < 0
            || req.planned_investment_cents < 0
            || req.actual_invested_cents < 0
            || req.actual_spend_cents.is_some_and(|v| v < 0)
        {
            return Err(ApiError::bad_request(
                "Monthly plan income, spend, and investment values must be non-negative",
            ));
        }

        let fx_usd_brl = match req.fx_usd_brl {
            Some(fx) if fx <= Decimal::ZERO => {
                return Err(ApiError::bad_request("fx_usd_brl must be greater than 0"));
            }
            Some(fx) => fx,
            None => self.get_cached_fx_usd_brl().await?.0,
        };

        let total_salary_cents = req.salary_income_cents + req.other_income_cents.max(0);
        let allocations_json = if req.allocations_json.is_null() {
            serde_json::json!([])
        } else {
            req.allocations_json
        };

        let plan = sqlx::query_as::<_, MonthlyInvestmentPlan>(
            r#"
            INSERT INTO monthly_investment_plans (
                month, currency, fx_usd_brl, salary_income_cents,
                planned_spend_cents, actual_spend_cents,
                planned_investment_cents, actual_invested_cents,
                allocations_json, notes_md
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (month) DO UPDATE SET
                currency = EXCLUDED.currency,
                fx_usd_brl = EXCLUDED.fx_usd_brl,
                salary_income_cents = EXCLUDED.salary_income_cents,
                planned_spend_cents = EXCLUDED.planned_spend_cents,
                actual_spend_cents = EXCLUDED.actual_spend_cents,
                planned_investment_cents = EXCLUDED.planned_investment_cents,
                actual_invested_cents = EXCLUDED.actual_invested_cents,
                allocations_json = EXCLUDED.allocations_json,
                notes_md = EXCLUDED.notes_md,
                updated_at = NOW()
            RETURNING *
            "#,
        )
        .bind(&normalized_month)
        .bind(req.currency)
        .bind(fx_usd_brl)
        .bind(total_salary_cents)
        .bind(req.planned_spend_cents)
        .bind(req.actual_spend_cents)
        .bind(req.planned_investment_cents)
        .bind(req.actual_invested_cents)
        .bind(allocations_json)
        .bind(&req.notes_md)
        .fetch_one(&self.pool)
        .await?;

        Ok(plan.with_computed_metrics())
    }

    // =========================================================================
    // 6. Singleton retirement_config, rust_decimal FIRE Engine & Snapshots
    // =========================================================================

    pub async fn get_retirement_config(&self) -> Result<RetirementConfig, ApiError> {
        if let Some(cfg) = sqlx::query_as::<_, RetirementConfig>(
            "SELECT * FROM retirement_config WHERE id = 1",
        )
        .fetch_optional(&self.pool)
        .await?
        {
            return Ok(cfg);
        }

        let cfg = sqlx::query_as::<_, RetirementConfig>(
            r#"
            INSERT INTO retirement_config (
                id, expected_real_return_pct, safe_withdrawal_rate_pct,
                override_retirement_monthly_spend_cents, macro_class_targets_json, current_age
            )
            VALUES (1, 6.50, 4.00, NULL, '{"us_equity":40,"br_equity_fii":25,"fixed_income":25,"crypto":10}'::jsonb, 30)
            ON CONFLICT (id) DO UPDATE SET updated_at = retirement_config.updated_at
            RETURNING *
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(cfg)
    }

    pub async fn update_retirement_config(
        &self,
        req: UpdateRetirementConfigRequest,
    ) -> Result<RetirementConfig, ApiError> {
        let existing = self.get_retirement_config().await?;
        let expected_real_return_pct = req
            .expected_real_return_pct
            .unwrap_or(existing.expected_real_return_pct);
        if expected_real_return_pct <= Decimal::from(-100)
            || expected_real_return_pct > Decimal::from(100)
        {
            return Err(ApiError::bad_request(
                "expected_real_return_pct must be between -99.99 and 100.00",
            ));
        }

        let safe_withdrawal_rate_pct = req
            .safe_withdrawal_rate_pct
            .unwrap_or(existing.safe_withdrawal_rate_pct);
        if safe_withdrawal_rate_pct <= Decimal::ZERO
            || safe_withdrawal_rate_pct > Decimal::from(100)
        {
            return Err(ApiError::bad_request(
                "safe_withdrawal_rate_pct must be greater than 0 and at most 100",
            ));
        }

        if let Some(spend) = req.override_retirement_monthly_spend_cents
            && spend < 0
        {
            return Err(ApiError::bad_request(
                "override_retirement_monthly_spend_cents must be non-negative",
            ));
        }
        if let Some(age) = req.current_age
            && !(1..=120).contains(&age)
        {
            return Err(ApiError::bad_request(
                "current_age must be between 1 and 120",
            ));
        }

        let override_spend = req
            .override_retirement_monthly_spend_cents
            .or(existing.override_retirement_monthly_spend_cents);
        let macro_targets = req
            .macro_class_targets_json
            .unwrap_or(existing.macro_class_targets_json);
        let current_age = req.current_age.or(existing.current_age);

        let updated = sqlx::query_as::<_, RetirementConfig>(
            r#"
            UPDATE retirement_config
            SET expected_real_return_pct = $1,
                safe_withdrawal_rate_pct = $2,
                override_retirement_monthly_spend_cents = $3,
                macro_class_targets_json = $4,
                current_age = $5,
                updated_at = NOW()
            WHERE id = 1
            RETURNING *
            "#,
        )
        .bind(expected_real_return_pct)
        .bind(safe_withdrawal_rate_pct)
        .bind(override_spend)
        .bind(macro_targets)
        .bind(current_age)
        .fetch_one(&self.pool)
        .await?;

        Ok(updated)
    }

    pub async fn get_retirement_projection(&self) -> Result<FireProjectionResponse, ApiError> {
        self.simulate_retirement(FireSimulationRequest {
            current_net_worth_brl_cents: None,
            monthly_contribution_brl_cents: None,
            monthly_retirement_spend_brl_cents: None,
            expected_real_return_pct: None,
            safe_withdrawal_rate_pct: None,
            current_age: None,
        })
        .await
    }

    pub async fn simulate_retirement(
        &self,
        req: FireSimulationRequest,
    ) -> Result<FireProjectionResponse, ApiError> {
        let mut config = self.get_retirement_config().await?;
        if let Some(r) = req.expected_real_return_pct {
            if r <= Decimal::from(-100) || r > Decimal::from(100) {
                return Err(ApiError::bad_request(
                    "expected_real_return_pct must be between -99.99 and 100.00",
                ));
            }
            config.expected_real_return_pct = r;
        }
        if let Some(swr) = req.safe_withdrawal_rate_pct {
            if swr <= Decimal::ZERO || swr > Decimal::from(100) {
                return Err(ApiError::bad_request(
                    "safe_withdrawal_rate_pct must be greater than 0 and at most 100",
                ));
            }
            config.safe_withdrawal_rate_pct = swr;
        }
        if let Some(age) = req.current_age {
            config.current_age = Some(age);
        }

        let alloc = self
            .get_portfolio_allocation(Some(CurrencyCode::Brl), None)
            .await?;
        let current_net_worth_brl_cents = req
            .current_net_worth_brl_cents
            .unwrap_or(alloc.total_brl_cents)
            .max(0);

        let latest_plan = sqlx::query_as::<_, MonthlyInvestmentPlan>(
            "SELECT * FROM monthly_investment_plans ORDER BY month DESC LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await?
        .map(MonthlyInvestmentPlan::with_computed_metrics);

        let default_spend_cents = latest_plan
            .as_ref()
            .map(|p| p.actual_spend_cents.unwrap_or(p.planned_spend_cents).max(0))
            .unwrap_or(500_000); // R$ 5,000.00 fallback when no monthly plan exists

        let default_contrib_cents = latest_plan
            .as_ref()
            .map(|p| {
                if p.actual_invested_cents > 0 {
                    p.actual_invested_cents
                } else if p.planned_investment_cents > 0 {
                    p.planned_investment_cents
                } else {
                    p.investable_surplus_cents
                }
            })
            .unwrap_or(200_000);

        let monthly_retirement_spend_brl_cents = req
            .monthly_retirement_spend_brl_cents
            .or(config.override_retirement_monthly_spend_cents)
            .unwrap_or(default_spend_cents)
            .max(0);

        let monthly_contribution_brl_cents = req
            .monthly_contribution_brl_cents
            .unwrap_or(default_contrib_cents);

        Ok(compute_fire_projection(
            current_net_worth_brl_cents,
            monthly_contribution_brl_cents,
            monthly_retirement_spend_brl_cents,
            config,
        ))
    }

    pub async fn list_portfolio_snapshots(
        &self,
        limit: Option<i64>,
    ) -> Result<Vec<PortfolioSnapshot>, ApiError> {
        let lim = limit.unwrap_or(90).clamp(1, 1000);
        let rows = sqlx::query_as::<_, PortfolioSnapshot>(
            "SELECT * FROM portfolio_snapshots ORDER BY snapshot_date DESC LIMIT $1",
        )
        .bind(lim)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn create_portfolio_snapshot(
        &self,
        req: CreatePortfolioSnapshotRequest,
    ) -> Result<PortfolioSnapshot, ApiError> {
        let snapshot_date = req
            .snapshot_date
            .unwrap_or_else(|| Utc::now().date_naive());
        let alloc = self
            .get_portfolio_allocation(Some(CurrencyCode::Brl), None)
            .await?;
        let fire = self.get_retirement_projection().await?;

        let breakdown_json = serde_json::json!({
            "waffle_tiles_count": alloc.waffle_tiles.len(),
            "recommendations": alloc.recommendations,
        });
        let projected_years_to_fi = if fire.unreachable {
            None
        } else {
            Decimal::from_f64_retain(fire.years_to_fi).map(|d| d.round_dp(2))
        };

        let snapshot = sqlx::query_as::<_, PortfolioSnapshot>(
            r#"
            INSERT INTO portfolio_snapshots (
                snapshot_date, total_brl_cents, total_usd_cents, fx_usd_brl,
                fi_target_brl_cents, projected_years_to_fi, breakdown_json
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (snapshot_date) DO UPDATE SET
                total_brl_cents = EXCLUDED.total_brl_cents,
                total_usd_cents = EXCLUDED.total_usd_cents,
                fx_usd_brl = EXCLUDED.fx_usd_brl,
                fi_target_brl_cents = EXCLUDED.fi_target_brl_cents,
                projected_years_to_fi = EXCLUDED.projected_years_to_fi,
                breakdown_json = EXCLUDED.breakdown_json
            RETURNING *
            "#,
        )
        .bind(snapshot_date)
        .bind(alloc.total_brl_cents)
        .bind(alloc.total_usd_cents)
        .bind(alloc.fx_usd_brl)
        .bind(fire.fi_target_brl_cents)
        .bind(projected_years_to_fi)
        .bind(breakdown_json)
        .fetch_one(&self.pool)
        .await?;

        Ok(snapshot)
    }
}

// =============================================================================
// Pure Domain Math & Validation Helpers (Waffle, Rebalancer, FIRE, Candles)
// =============================================================================

fn validate_asset_numbers(
    quantity: Decimal,
    avg_cost_cents: i64,
    current_price_cents: i64,
    target_weight_pct: Decimal,
    alert_low_cents: Option<i64>,
    alert_high_cents: Option<i64>,
) -> Result<(), ApiError> {
    if quantity < Decimal::ZERO {
        return Err(ApiError::bad_request("Asset quantity must be non-negative"));
    }
    if avg_cost_cents < 0 || current_price_cents < 0 {
        return Err(ApiError::bad_request(
            "Asset prices and costs in cents must be non-negative",
        ));
    }
    if target_weight_pct < Decimal::ZERO || target_weight_pct > Decimal::from(100) {
        return Err(ApiError::bad_request(
            "target_weight_pct must be between 0 and 100",
        ));
    }
    if let Some(low) = alert_low_cents
        && low < 0
    {
        return Err(ApiError::bad_request(
            "alert_low_cents must be non-negative",
        ));
    }
    if let Some(high) = alert_high_cents
        && high < 0
    {
        return Err(ApiError::bad_request(
            "alert_high_cents must be non-negative",
        ));
    }
    if let (Some(low), Some(high)) = (alert_low_cents, alert_high_cents)
        && low > high
    {
        return Err(ApiError::bad_request(
            "alert_low_cents must not exceed alert_high_cents",
        ));
    }
    Ok(())
}

pub fn validate_month_key(month: &str) -> Result<String, ApiError> {
    let m = month.trim();
    let bytes = m.as_bytes();
    if bytes.len() != 7 || bytes[4] != b'-' {
        return Err(ApiError::bad_request(
            "Month must match 'YYYY-MM' (e.g. '2026-11')",
        ));
    }
    let year: i32 = m[0..4]
        .parse()
        .map_err(|_| ApiError::bad_request("Invalid year in 'YYYY-MM'"))?;
    let month_num: u32 = m[5..7]
        .parse()
        .map_err(|_| ApiError::bad_request("Invalid month in 'YYYY-MM'"))?;
    if !(2000..=2100).contains(&year) || !(1..=12).contains(&month_num) {
        return Err(ApiError::bad_request(
            "Month must have year 2000..=2100 and month 01..=12",
        ));
    }
    Ok(m.to_string())
}

/// Computes the `10×20` (`200`-tile) Waffle Grid via the Hare-Niemeyer largest-remainder method.
pub fn build_hare_niemeyer_waffle_tiles(
    holding_vals: &[(PortfolioAsset, i64, i64)],
    total_brl_cents: i64,
) -> Vec<WaffleTile> {
    if total_brl_cents <= 0 {
        return (0..200)
            .map(|tile_index| WaffleTile {
                tile_index,
                symbol: "UNALLOCATED".to_string(),
                asset_class: AssetClass::Cash,
            })
            .collect();
    }

    let positive: Vec<&(PortfolioAsset, i64, i64)> = holding_vals
        .iter()
        .filter(|(_, brl, _)| *brl > 0)
        .collect();
    if positive.is_empty() {
        return (0..200)
            .map(|tile_index| WaffleTile {
                tile_index,
                symbol: "UNALLOCATED".to_string(),
                asset_class: AssetClass::Cash,
            })
            .collect();
    }

    let total_dec = Decimal::from(total_brl_cents);
    let mut tile_counts: Vec<usize> = Vec::with_capacity(positive.len());
    let mut remainders: Vec<(usize, Decimal, i64, String)> = Vec::with_capacity(positive.len());
    let mut floor_sum = 0_usize;

    for (idx, (asset, val_brl, _)) in positive.iter().enumerate() {
        let quota = (Decimal::from(*val_brl) * Decimal::from(200)) / total_dec;
        let floor_tiles = quota.floor().to_usize().unwrap_or(0);
        let rem = quota - Decimal::from(floor_tiles);
        tile_counts.push(floor_tiles);
        floor_sum += floor_tiles;
        remainders.push((idx, rem, *val_brl, asset.symbol.clone()));
    }

    let remaining = 200_usize.saturating_sub(floor_sum);
    remainders.sort_by(|a, b| {
        b.1.cmp(&a.1)
            .then_with(|| b.2.cmp(&a.2))
            .then_with(|| a.3.cmp(&b.3))
    });
    for &(idx, _, _, _) in remainders.iter().take(remaining) {
        tile_counts[idx] += 1;
    }

    // Order holdings by value descending for contiguous visual grouping in the 10x20 waffle grid
    let mut ordered_indices: Vec<usize> = (0..positive.len()).collect();
    ordered_indices.sort_by(|&a, &b| {
        positive[b]
            .1
            .cmp(&positive[a].1)
            .then_with(|| positive[a].0.symbol.cmp(&positive[b].0.symbol))
    });

    let mut tiles = Vec::with_capacity(200);
    let mut tile_index = 0_usize;
    for idx in ordered_indices {
        let (asset, _, _) = positive[idx];
        for _ in 0..tile_counts[idx] {
            if tiles.len() < 200 {
                tiles.push(WaffleTile {
                    tile_index,
                    symbol: asset.symbol.clone(),
                    asset_class: asset.asset_class,
                });
                tile_index = tile_index.saturating_add(1);
            }
        }
    }

    tiles
}

/// Computes buy-only smart rebalancing recommendations (zero sell recommendations).
pub fn compute_buy_only_recommendations(
    holding_vals: &[(PortfolioAsset, i64, i64)],
    total_brl_cents: i64,
    contribution_brl_cents: i64,
    base_curr: CurrencyCode,
    fx_usd_brl: Decimal,
) -> Vec<RebalanceRecommendation> {
    if holding_vals.is_empty() {
        return Vec::new();
    }

    let p0 = Decimal::from(total_brl_cents.max(0));
    let contrib_dec = Decimal::from(contribution_brl_cents.max(0));
    let p_new = p0 + contrib_dec;

    // Compute underweight deficit for each holding: max(0, target_post_deposit_value - current_value)
    let mut deficits: Vec<Decimal> = Vec::with_capacity(holding_vals.len());
    let mut deficit_sum = Decimal::ZERO;
    for (asset, val_brl, _) in holding_vals {
        let target_val = p_new * (asset.target_weight_pct / Decimal::from(100));
        let cur_val = Decimal::from(*val_brl);
        let d = if target_val > cur_val {
            target_val - cur_val
        } else {
            Decimal::ZERO
        };
        deficits.push(d);
        deficit_sum += d;
    }

    // Allocate contribution_brl_cents across underweight holdings using largest-remainder
    let mut buy_brl_alloc: Vec<i64> = vec![0; holding_vals.len()];
    if contribution_brl_cents > 0 {
        if deficit_sum > Decimal::ZERO {
            let mut floor_sum = 0_i64;
            let mut rems: Vec<(usize, Decimal, String)> = Vec::with_capacity(holding_vals.len());
            for (idx, d) in deficits.iter().enumerate() {
                if *d > Decimal::ZERO {
                    let exact = (contrib_dec * *d) / deficit_sum;
                    let fl = exact.floor().to_i64().unwrap_or(0).max(0);
                    buy_brl_alloc[idx] = fl;
                    floor_sum += fl;
                    rems.push((
                        idx,
                        exact - Decimal::from(fl),
                        holding_vals[idx].0.symbol.clone(),
                    ));
                }
            }
            let rem_cents = (contribution_brl_cents - floor_sum).max(0) as usize;
            rems.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.2.cmp(&b.2)));
            for &(idx, _, _) in rems.iter().take(rem_cents) {
                buy_brl_alloc[idx] += 1;
            }
        } else {
            // All holdings are at/above target weight (or targets are 0): allocate by target_weight_pct if > 0
            let weight_sum: Decimal = holding_vals.iter().map(|(a, _, _)| a.target_weight_pct).sum();
            if weight_sum > Decimal::ZERO {
                let mut floor_sum = 0_i64;
                let mut rems: Vec<(usize, Decimal)> = Vec::new();
                for (idx, (asset, _, _)) in holding_vals.iter().enumerate() {
                    let exact = (contrib_dec * asset.target_weight_pct) / weight_sum;
                    let fl = exact.floor().to_i64().unwrap_or(0).max(0);
                    buy_brl_alloc[idx] = fl;
                    floor_sum += fl;
                    rems.push((idx, exact - Decimal::from(fl)));
                }
                let rem_cents = (contribution_brl_cents - floor_sum).max(0) as usize;
                rems.sort_by(|a, b| b.1.cmp(&a.1));
                for &(idx, _) in rems.iter().take(rem_cents) {
                    buy_brl_alloc[idx] += 1;
                }
            }
        }
    }

    let mut recommendations = Vec::with_capacity(holding_vals.len());
    for (idx, (asset, val_brl, _)) in holding_vals.iter().enumerate() {
        let cur_weight_pct = if p0 > Decimal::ZERO {
            ((Decimal::from(*val_brl) * Decimal::from(100)) / p0).round_dp(2)
        } else {
            Decimal::ZERO
        };
        let buy_brl = buy_brl_alloc[idx].max(0);
        let recommended_buy_cents = match base_curr {
            CurrencyCode::Brl => buy_brl,
            CurrencyCode::Usd => (Decimal::from(buy_brl) / fx_usd_brl)
                .round()
                .to_i64()
                .unwrap_or(0)
                .max(0),
        };

        let unit_price_brl = match asset.currency {
            CurrencyCode::Brl => Decimal::from(asset.current_price_cents),
            CurrencyCode::Usd => Decimal::from(asset.current_price_cents) * fx_usd_brl,
        };
        let recommended_units = if buy_brl > 0 && unit_price_brl > Decimal::ZERO {
            (Decimal::from(buy_brl) / unit_price_brl).round_dp(4)
        } else {
            Decimal::ZERO
        };

        let post_buy_weight_pct = if p_new > Decimal::ZERO {
            ((Decimal::from(*val_brl + buy_brl) * Decimal::from(100)) / p_new).round_dp(2)
        } else {
            Decimal::ZERO
        };

        recommendations.push(RebalanceRecommendation {
            asset_id: asset.id,
            symbol: asset.symbol.clone(),
            current_weight_pct: cur_weight_pct,
            target_weight_pct: asset.target_weight_pct,
            recommended_buy_cents,
            recommended_units,
            post_buy_weight_pct,
        });
    }

    recommendations
}

/// Computes the `rust_decimal` + closed-form logarithmic NPER FIRE projection & yearly trajectory.
pub fn compute_fire_projection(
    current_net_worth_brl_cents: i64,
    monthly_contribution_brl_cents: i64,
    monthly_retirement_spend_brl_cents: i64,
    config: RetirementConfig,
) -> FireProjectionResponse {
    let annual_spend_dec =
        Decimal::from(monthly_retirement_spend_brl_cents.max(0)) * Decimal::from(12);
    let fi_target_brl_cents = if config.safe_withdrawal_rate_pct > Decimal::ZERO {
        ((annual_spend_dec * Decimal::from(100)) / config.safe_withdrawal_rate_pct)
            .round()
            .to_i64()
            .unwrap_or(0)
            .max(0)
    } else {
        0
    };
    let fire_number_cents = fi_target_brl_cents;

    let r_annual = config
        .expected_real_return_pct
        .to_f64()
        .unwrap_or(6.5)
        / 100.0;
    let r_m = if r_annual > -1.0 {
        (1.0 + r_annual).powf(1.0 / 12.0) - 1.0
    } else {
        0.0
    };

    // Coast FIRE target (PV needed today to compound to fire_number_cents by age 65 with 0 contributions)
    let age = config.current_age.unwrap_or(30);
    let coast_years = (65 - i32::from(age)).max(1) as f64;
    let coast_fire_cents = if fi_target_brl_cents <= 0 {
        0
    } else if r_annual > 0.0 {
        let pv = (fi_target_brl_cents as f64) / (1.0 + r_annual).powf(coast_years);
        (pv.round() as i64).clamp(0, fi_target_brl_cents)
    } else {
        fi_target_brl_cents
    };

    let progress_pct = if fi_target_brl_cents <= 0 {
        100.0
    } else {
        let raw = ((current_net_worth_brl_cents as f64) / (fi_target_brl_cents as f64)) * 100.0;
        if raw.is_finite() {
            ((raw * 10.0).round() / 10.0).max(0.0)
        } else {
            0.0
        }
    };
    let fi_progress_pct = progress_pct;
    let passive_income_coverage_pct = progress_pct;

    let p0 = current_net_worth_brl_cents.max(0) as f64;
    let f_target = fi_target_brl_cents as f64;
    let c_month = monthly_contribution_brl_cents.max(0) as f64;
    let today = Utc::now().date_naive();

    let (years_to_fi, months_to_fi, projected_fi_date, unreachable) =
        if p0 >= f_target || f_target <= 0.0 {
            (0.0, 0, Some(today), false)
        } else if r_m.abs() < 1e-9 {
            if c_month > 0.0 {
                let n_months = ((f_target - p0) / c_month).ceil().max(0.0);
                let m_i32 = (n_months as i64).clamp(0, 11988) as i32;
                let yrs = ((n_months / 12.0) * 100.0).round() / 100.0;
                let dt = today.checked_add_months(Months::new(m_i32 as u32));
                (yrs, m_i32, dt, false)
            } else {
                (999.0, 11988, None, true)
            }
        } else {
            let denom_inner = p0 * r_m + c_month;
            let num_inner = f_target * r_m + c_month;
            if denom_inner <= 0.0 || num_inner / denom_inner <= 0.0 || (1.0 + r_m) <= 0.0 {
                (999.0, 11988, None, true)
            } else {
                let n_months = (num_inner / denom_inner).ln() / (1.0 + r_m).ln();
                if !n_months.is_finite() || n_months < 0.0 || n_months > 11988.0 {
                    (999.0, 11988, None, true)
                } else {
                    let m_i32 = n_months.ceil() as i32;
                    let yrs = ((n_months / 12.0) * 100.0).round() / 100.0;
                    let dt = today.checked_add_months(Months::new(m_i32 as u32));
                    (yrs, m_i32, dt, false)
                }
            }
        };

    // Build yearly trajectory points
    let horizon_years = if unreachable {
        20
    } else {
        (years_to_fi.ceil() as i32).clamp(10, 40)
    };
    let current_year = today.year();
    let mut trajectory = Vec::with_capacity((horizon_years + 1) as usize);
    let mut nw = p0;
    let mut total_contrib = 0.0_f64;

    for yr_offset in 0..=horizon_years {
        if yr_offset > 0 {
            for _ in 0..12 {
                nw = nw * (1.0 + r_m) + c_month;
                total_contrib += c_month;
            }
        }
        trajectory.push(FireTrajectoryPoint {
            year_offset: yr_offset,
            calendar_year: current_year + yr_offset,
            age: config.current_age.map(|a| a.saturating_add(yr_offset as i16)),
            projected_net_worth_cents: nw.round().clamp(0.0, i64::MAX as f64) as i64,
            total_contributions_cents: total_contrib.round().clamp(0.0, i64::MAX as f64) as i64,
            fi_target_cents: fi_target_brl_cents,
        });
    }

    FireProjectionResponse {
        current_net_worth_brl_cents,
        fi_target_brl_cents,
        fire_number_cents,
        coast_fire_cents,
        monthly_contribution_brl_cents,
        monthly_retirement_spend_brl_cents,
        years_to_fi,
        months_to_fi,
        projected_fi_date,
        progress_pct,
        fi_progress_pct,
        passive_income_coverage_pct,
        unreachable,
        trajectory,
        config,
    }
}

fn synthesize_deterministic_candles(
    asset: &PortfolioAsset,
    range_key: &str,
) -> Vec<CandlestickBar> {
    let (bar_count, step_hours) = match range_key {
        "1D" => (24_usize, 1_i64),
        "7D" => (7_usize, 24_i64),
        "1M" => (30_usize, 24_i64),
        "1Y" => (52_usize, 24 * 7),
        _ => (60_usize, 24 * 7),
    };

    let end_price = asset.current_price_cents.max(100);
    let start_price = if asset.avg_cost_cents > 0 {
        asset.avg_cost_cents
    } else {
        ((end_price * 95) / 100).max(100)
    };

    let mut symbol_hash = 5381_u64;
    for b in asset.symbol.bytes() {
        symbol_hash = ((symbol_hash << 5).wrapping_add(symbol_hash)).wrapping_add(u64::from(b));
    }

    let now = Utc::now();
    let mut candles = Vec::with_capacity(bar_count);
    let mut prev_close = start_price;

    for i in 0..bar_count {
        let progress = (i + 1) as f64 / (bar_count as f64);
        let base_interp =
            (start_price as f64) + ((end_price - start_price) as f64) * progress;
        let phase = ((i as u64).wrapping_mul(17).wrapping_add(symbol_hash) % 9) as f64 - 4.0;
        let wave_factor = 1.0 + (phase * 0.004);

        let close_cents = if i + 1 == bar_count {
            asset.current_price_cents.max(1)
        } else {
            ((base_interp * wave_factor).round() as i64).max(1)
        };
        let open_cents = prev_close.max(1);
        let spread = ((open_cents.max(close_cents) as f64) * 0.012).round() as i64;
        let high_cents = open_cents.max(close_cents) + spread.max(1);
        let low_cents = (open_cents.min(close_cents) - spread.max(1)).max(1);
        let volume = 10_000_i64 + (((symbol_hash + i as u64 * 997) % 90_000) as i64);
        let ts = now - Duration::hours(((bar_count - 1 - i) as i64) * step_hours);

        candles.push(CandlestickBar {
            timestamp: ts.to_rfc3339(),
            open_cents,
            high_cents,
            low_cents,
            close_cents,
            volume,
        });
        prev_close = close_cents;
    }

    candles
}

fn extract_fx_rate_from_json(val: &serde_json::Value) -> Option<Decimal> {
    if let Some(n) = val
        .get("fx_usd_brl")
        .or_else(|| val.get("rate"))
        .or_else(|| val.get("rates").and_then(|r| r.get("BRL")))
    {
        if let Some(f) = n.as_f64() {
            return Decimal::from_f64(f);
        }
        if let Some(s) = n.as_str() {
            return s.parse::<Decimal>().ok();
        }
    }
    if let Some(bid) = val
        .get("USDBRL")
        .and_then(|u| u.get("bid"))
        .and_then(|b| b.as_str())
    {
        return bid.parse::<Decimal>().ok();
    }
    None
}

fn extract_asset_quote_from_json(
    val: &serde_json::Value,
    symbol: &str,
) -> Option<(i64, Option<i64>, Option<serde_json::Value>)> {
    let map_source = val.get("quotes").unwrap_or(val);
    if let Some(entry) = map_source.get(symbol) {
        if let Some(price) = entry.as_i64() {
            return Some((price, None, None));
        }
        if let Some(price) = entry
            .get("price_cents")
            .or_else(|| entry.get("current_price_cents"))
            .and_then(|v| v.as_i64())
        {
            let prev = entry.get("previous_close_cents").and_then(|v| v.as_i64());
            let candles = entry.get("candles").cloned();
            return Some((price, prev, candles));
        }
    }
    if let Some(arr) = map_source.as_array() {
        for item in arr {
            if item
                .get("symbol")
                .and_then(|s| s.as_str())
                .is_some_and(|s| s.eq_ignore_ascii_case(symbol))
                && let Some(price) = item
                    .get("price_cents")
                    .or_else(|| item.get("current_price_cents"))
                    .and_then(|v| v.as_i64())
            {
                let prev = item.get("previous_close_cents").and_then(|v| v.as_i64());
                let candles = item.get("candles").cloned();
                return Some((price, prev, candles));
            }
        }
    }
    None
}
