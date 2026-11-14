//! `HERMES // OS` Unified HTTP/SSE + `/mcp` + CSR SPA-Fallback Binary Entrypoint (`:8080`).

use std::net::SocketAddr;

use hermes_server::{AppState, ServerConfig, build_router};
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();

    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,hermes_server=info,sqlx=warn")),
        )
        .with(tracing_subscriber::fmt::layer())
        .try_init()
        .ok();

    let config = ServerConfig::from_env();
    let bind_addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;

    let state = AppState::connect_from_config(config).await?;
    state.initialize_database_and_background_tasks().await?;

    let app = build_router(state);

    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    tracing::info!("HERMES // OS unified server listening on http://{bind_addr}");

    axum::serve(listener, app).await?;
    Ok(())
}
