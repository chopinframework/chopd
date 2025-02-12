use std::io;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{prelude::*, widgets::*};
use tokio::sync::mpsc;
use tracing::{info, warn};

mod app;
mod config;
mod proxy;
mod tui;

use app::{App, AppState};
use config::Config;
use proxy::ProxyServer;
use tui::ui;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt::init();

    // Parse command line args and config
    let config = Config::new()?;

    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Create channels for proxy server communication
    let (tx, rx) = mpsc::channel(100);
    
    // Initialize the application state
    let app = Arc::new(App::new(config.clone()));
    
    // Start the proxy server in a separate task
    let proxy_handle = {
        let app = Arc::clone(&app);
        tokio::spawn(async move {
            let proxy = ProxyServer::new(config, tx);
            if let Err(e) = proxy.run().await {
                warn!("Proxy server error: {}", e);
                app.set_state(AppState::Error(e.to_string()));
            }
        })
    };

    // Run the main event loop
    run_app(&mut terminal, app, rx).await?;

    // Cleanup
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    // Ensure proxy server is shutdown
    proxy_handle.abort();

    Ok(())
}

async fn run_app<B: Backend>(
    terminal: &mut Terminal<B>,
    app: Arc<App>,
    mut rx: mpsc::Receiver<String>,
) -> Result<()> {
    let tick_rate = Duration::from_millis(200);
    let mut last_tick = tokio::time::Instant::now();

    loop {
        terminal.draw(|f| ui::draw(f, app.as_ref()))?;

        let timeout = tick_rate
            .checked_sub(last_tick.elapsed())
            .unwrap_or_else(|| Duration::from_secs(0));

        if event::poll(timeout)? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Char('q') => {
                        app.set_state(AppState::Stopping);
                        return Ok(());
                    }
                    KeyCode::Char('c') => {
                        app.clear_logs();
                    }
                    _ => {}
                }
            }
        }

        if last_tick.elapsed() >= tick_rate {
            app.on_tick();
            last_tick = tokio::time::Instant::now();
        }

        // Handle any incoming messages from the proxy server
        while let Ok(msg) = rx.try_recv() {
            app.add_log(msg);
        }
    }
} 