use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::RwLock;
use std::time::{Duration, Instant};

use crate::config::Config;

#[derive(Debug, Clone)]
pub enum AppState {
    Starting,
    Running,
    Error(String),
    Stopping,
}

pub struct App {
    pub title: String,
    state: RwLock<AppState>,
    logs: RwLock<Vec<(Instant, String)>>,
    request_count: AtomicUsize,
    config: Config,
}

impl App {
    pub fn new(config: Config) -> Self {
        Self {
            title: String::from("chopd-rs"),
            state: RwLock::new(AppState::Starting),
            logs: RwLock::new(Vec::new()),
            request_count: AtomicUsize::new(0),
            config,
        }
    }

    pub fn state(&self) -> AppState {
        self.state.read().unwrap().clone()
    }

    pub fn set_state(&self, state: AppState) {
        *self.state.write().unwrap() = state;
    }

    pub fn add_log(&self, message: String) {
        let mut logs = self.logs.write().unwrap();
        logs.push((Instant::now(), message));
        
        // Keep only last 1000 logs
        if logs.len() > 1000 {
            logs.remove(0);
        }
    }

    pub fn clear_logs(&self) {
        self.logs.write().unwrap().clear();
    }

    pub fn get_logs(&self) -> Vec<(Instant, String)> {
        self.logs.read().unwrap().clone()
    }

    pub fn increment_request_count(&self) {
        self.request_count.fetch_add(1, Ordering::SeqCst);
    }

    pub fn get_request_count(&self) -> usize {
        self.request_count.load(Ordering::SeqCst)
    }

    pub fn config(&self) -> &Config {
        &self.config
    }

    pub fn on_tick(&self) {
        // Cleanup old logs (older than 1 hour)
        let mut logs = self.logs.write().unwrap();
        let now = Instant::now();
        logs.retain(|(timestamp, _)| {
            now.duration_since(*timestamp) < Duration::from_secs(3600)
        });
    }
} 