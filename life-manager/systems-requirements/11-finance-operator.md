# 11 — Finance Operator (Portfolio, Stock Watchlist & Retirement Engine)

> **Status**: Locked v1.0
> **Platforms**: Web SPA Only (Excluded from Companion App)
> **Visual Reference**: [`assets/ref-07-dashboard-finance-waffle-ai.jpg`](./assets/ref-07-dashboard-finance-waffle-ai.jpg) (`REF-07` Analytical Terminal) + [`REF-02`](./assets/ref-02-protocol-diagnosis-fui.jpg) FUI Framing

---

## 1. Purpose & Core Philosophy

**Finance Operator is NOT a tedious daily coffee-receipt expense tracker.**

Instead, it is a **Multi-Market Portfolio Planner, Stock/Asset Intelligence Terminal, and Time-to-Retirement (FIRE) Engine**:
1. **Portfolio & Stock Following (`BRL` + `USD`)**: Follow stocks, ETFs, FIIs, Fixed Income, and Crypto across B3 and US/Global markets, maintain your target allocation strategy, and log your investment thesis per asset.
2. **Macro Monthly Investment Planning (Only Cashflow Input)**: Enter **only** your monthly **Salary / Income** and your **Planned vs. Actual Monthly Total Spending** to determine **how much capital to invest each month** and automatically calculate rebalancing buy orders.
3. **Retirement / Financial Independence Simulator**: Continuously computes **how many years/months remain until retirement** based on your live portfolio value, monthly investment contribution, and monthly spending target.

---

## 2. Core Functional Requirements

### 2.1. Multi-Market Portfolio & Stock Watchlist (`BRL` + `USD`)
- [x] **Multi-Asset & Multi-Currency Coverage**:
  - **B3 (Brazil — `BRL`)**: Ações (`PETR4`, `WEGE3`, ...), FIIs, ETFs, and Fixed Income / Tesouro Direto / CDB reserves.
  - **US & Global (`USD`)**: Stocks, ETFs (`VOO`, `VT`, `QQQ`, ...), REITs, Bonds/Cash.
  - **Crypto**: `BTC`, `ETH`, etc.
  - Automatic Rust background quote & `USD/BRL` FX fetcher (via Yahoo Finance / Brapi / CoinGecko APIs, cached in Postgres/Redis) with consolidated view in either `BRL` or `USD`.
- [x] **Stock Following & Thesis Terminal (`REF-07`)**:
  - Candlestick / historical price chart (`[1D | 7D | 1M | 1Y | ALL]`), valuation/dividend yield snapshot, price target alerts, and **Markdown Investment Thesis & Catalyst Notes** per ticker (searchable by Hermes & Frieren!).
  - Watchlist tracking candidate stocks before they enter your active portfolio.
- [x] **Target Allocation & Smart Rebalancing Calculator**:
  - Define target weights across Macro Classes (*US Equities 40%*, *B3 Equities/FIIs 25%*, *Fixed Income 25%*, *Crypto 10%*) and individual tickers.
  - Visualized via `REF-07`'s **`10×20` Waffle Tile Allocation Grid** (Current Weight vs. Target Weight, zero pie-chart clutter).

### 2.2. Monthly Investment & Spending Planner (Single Macro Cashflow Sheet)
- [x] **Zero Micro-Bookkeeping**: One clean monthly planning record (`YYYY-MM`) with:
  - **`salary_income_cents`** (Salary + bonuses/dividends reinvested or earned)
  - **`planned_spend_cents`** (Target total monthly lifestyle cost)
  - **`actual_spend_cents`** (Actual total spent for the month — single macro number or card/account total)
  - **Auto-Computed `investable_surplus_cents` (`Income - Spend`)** & **Savings Rate `%`**.
- [x] **Monthly Deployment Plan ("What to Buy This Month")**:
  - Feeds `investable_surplus_cents` directly into your target portfolio weights and live asset prices to propose exact monthly contributions per asset/bucket so every new deposit rebalances your portfolio without selling.
  - `REF-07` **Solid vs. Diagonal-Hatched (`/////`) Paired Bar Chart** comparing *Planned vs. Actual Monthly Spend* and *Planned vs. Deployed Monthly Investment* across `[3M | 6M | 1Y | ALL]`.

### 2.3. Retirement / Financial Independence (FI / FIRE) Engine
- [x] **Live Time-to-Retirement Calculation**:
  - Driven directly by:
    1. **Current Invested Portfolio** (live sum of holdings converted at current FX),
    2. **Monthly Contribution** (`Income - Spend`),
    3. **Target Monthly Retirement Spend** (defaults to your rolling Planned/Actual Monthly Spend, adjustable for post-FI lifestyle),
    4. **Return & Withdrawal Assumptions** (Expected Annual Real Return `%`, Safe Withdrawal Rate `SWR %` e.g. `3.5%–4.0%` or target passive dividend yield).
  - Outputs: **FI Target Number** (`Annual Spend / SWR`), **FI Progress `%`** (`REF-07` diagonal-hatched ring gauge), **Exact Years & Months to Retirement** (`e.g. 7Y 4M -> Mar 2034`), and **Current Monthly Passive Income Coverage `%`**.
- [x] **Interactive What-If Sliders & Privacy Blur (`👁️`)**:
  - Drag sliders for *Monthly Spend*, *Monthly Investment*, or *Real Return %* to see instant delta on Retirement Date (*"-R$ 1,500/mo spend = retire 1.8 years earlier"*).
  - Global `👁️` Privacy Mode masks currency values while keeping `%`, Waffle tiles, and Years-to-Retirement visible.

---

## 3. Core Data Entities (PostgreSQL — `BIGINT` Cents & `NUMERIC`)

- **`portfolio_assets`**: `id`, `symbol` (`WEGE3.SA | VOO | BTC-USD | TESOURO_IPCA`), `name`, `asset_class` (`br_equity | br_fii | br_fixed_income | us_equity | global_etf | crypto | cash`), `currency` (`BRL | USD`), `in_portfolio` (bool, `false` = watchlist only), `quantity` (`NUMERIC(18,8)`), `avg_cost_cents` (`BIGINT`), `current_price_cents` (`BIGINT`), `target_weight_pct` (`NUMERIC(5,2)`), `alert_low_cents`, `alert_high_cents`, `thesis_md`, `last_quote_at`.
- **`monthly_investment_plans`**: `month` (`YYYY-MM` PK), `currency` (`BRL`), `fx_usd_brl` (`NUMERIC(10,4)`), `salary_income_cents`, `planned_spend_cents`, `actual_spend_cents`, `planned_investment_cents`, `actual_invested_cents`, `allocations_json` (planned vs executed buys), `notes_md`, `updated_at`.
- **`retirement_config`**: `id`, `expected_real_return_pct` (default `6.5`), `safe_withdrawal_rate_pct` (default `4.0`), `override_retirement_monthly_spend_cents` (nullable — defaults to avg monthly spend), `current_age`, `updated_at`.
- **`portfolio_snapshots`**: `snapshot_date` (PK), `total_brl_cents`, `total_usd_cents`, `fi_target_brl_cents`, `projected_years_to_fi` (`NUMERIC(5,2)`), `breakdown_json`.
