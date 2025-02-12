use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use std::str::FromStr;

use anyhow::{Context, Result};
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{HeaderMap, Method, Request, Response, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use chrono;
use cookie::{Cookie, CookieJar};
use hyper::body::Bytes;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, RwLock};
use tower::ServiceExt;
use tower_http::trace::TraceLayer;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::config::Config;

const QUEUE_METHODS: [Method; 4] = [
    Method::POST,
    Method::PUT,
    Method::PATCH,
    Method::DELETE,
];

#[derive(Debug, Clone, Serialize)]
struct LogEntry {
    request_id: String,
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    timestamp: String,
    response: Option<ResponseLog>,
    contexts: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
struct ResponseLog {
    status: u16,
    headers: HashMap<String, String>,
    body: Option<String>,
}

#[derive(Clone)]
pub struct ProxyServer {
    config: Config,
    logs: Arc<RwLock<Vec<LogEntry>>>,
    contexts: Arc<RwLock<HashMap<String, Vec<String>>>>,
    tx: mpsc::Sender<String>,
}

impl ProxyServer {
    pub fn new(config: Config, tx: mpsc::Sender<String>) -> Self {
        Self {
            config,
            logs: Arc::new(RwLock::new(Vec::new())),
            contexts: Arc::new(RwLock::new(HashMap::new())),
            tx,
        }
    }

    pub async fn run(self) -> Result<()> {
        let port = self.config.proxy_port;
        let app = Router::new()
            .route("/_chopin/login", get(Self::handle_login))
            .route("/_chopin/report-context", post(Self::handle_report_context))
            .route("/_chopin/logs", get(Self::handle_logs))
            .fallback(Self::handle_proxy)
            .layer(TraceLayer::new_for_http())
            .with_state(Arc::new(self));

        let addr = format!("127.0.0.1:{}", port);
        info!("Starting proxy server on {}", addr);
        
        let listener = tokio::net::TcpListener::bind(&addr).await?;
        axum::serve(listener, app).await?;

        Ok(())
    }

    async fn handle_login(
        Query(params): Query<HashMap<String, String>>,
    ) -> impl IntoResponse {
        let address = params.get("as").cloned().unwrap_or_else(|| {
            format!("0x{:040x}", rand::random::<u64>())
        });

        let mut jar = CookieJar::new();
        jar.add(Cookie::new("dev-address", address.clone()));

        let mut headers = HeaderMap::new();
        if let Some(cookie) = jar.get("dev-address") {
            headers.insert("set-cookie", cookie.to_string().parse().unwrap());
        }

        (StatusCode::OK, headers, "")
    }

    async fn handle_report_context(
        State(state): State<Arc<Self>>,
        Query(params): Query<HashMap<String, String>>,
        body: String,
    ) -> impl IntoResponse {
        let request_id = match params.get("requestId") {
            Some(id) => id,
            None => return (StatusCode::BAD_REQUEST, "Missing requestId").into_response(),
        };

        let mut contexts = state.contexts.write().await;
        contexts
            .entry(request_id.to_string())
            .or_insert_with(Vec::new)
            .push(body);

        StatusCode::OK.into_response()
    }

    async fn handle_logs(
        State(state): State<Arc<Self>>,
    ) -> impl IntoResponse {
        let logs = state.logs.read().await;
        let contexts = state.contexts.read().await;

        let mut response = Vec::new();
        for log in logs.iter() {
            let mut log = log.clone();
            if let Some(ctx) = contexts.get(&log.request_id) {
                log.contexts = Some(ctx.clone());
            }
            response.push(log);
        }

        (StatusCode::OK, axum::Json(response))
    }

    async fn handle_proxy(
        State(state): State<Arc<Self>>,
        req: Request<Body>,
    ) -> impl IntoResponse {
        // Extract necessary information from request
        let method = req.method().clone();
        let uri = req.uri().to_string();
        let headers = req.headers().clone();
        let is_queued = QUEUE_METHODS.contains(&method);
        let request_id = Uuid::new_v4().to_string();

        // Process cookies and extract dev-address
        let mut x_address = None;
        if let Some(cookie_str) = headers
            .get("cookie")
            .and_then(|c| c.to_str().ok())
            .map(String::from)
        {
            for cookie in cookie::Cookie::split_parse(&cookie_str).filter_map(Result::ok) {
                if cookie.name() == "dev-address" {
                    x_address = Some(cookie.value().to_string());
                    break;
                }
            }
        }

        // Build target URL
        let target_url = format!("http://localhost:{}{}", state.config.target_port, uri);

        // Read body
        let body_bytes = match axum::body::to_bytes(req.into_body(), usize::MAX).await {
            Ok(bytes) => bytes,
            Err(_) => Bytes::new(),
        };

        // Create log entry
        let mut log_entry = LogEntry {
            request_id: request_id.clone(),
            method: method.to_string(),
            url: uri,
            headers: headers
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                .collect(),
            body: Some(String::from_utf8_lossy(&body_bytes).to_string()),
            timestamp: chrono::Utc::now().to_rfc3339(),
            response: None,
            contexts: None,
        };

        // Convert headers to reqwest format
        let mut forward_headers = reqwest::header::HeaderMap::new();
        for (k, v) in headers.iter() {
            if let Ok(name) = reqwest::header::HeaderName::from_bytes(k.as_ref()) {
                if let Ok(value) = reqwest::header::HeaderValue::from_str(v.to_str().unwrap_or("")) {
                    forward_headers.insert(name, value);
                }
            }
        }

        // Add x-address header if found
        if let Some(addr) = x_address {
            if let Ok(value) = reqwest::header::HeaderValue::from_str(&addr) {
                forward_headers.insert(
                    reqwest::header::HeaderName::from_static("x-address"),
                    value,
                );
            }
        }

        if is_queued {
            let callback_url = format!(
                "http://localhost:{}/chopin/report-context?requestId={}",
                state.config.proxy_port, request_id
            );
            if let Ok(value) = reqwest::header::HeaderValue::from_str(&callback_url) {
                forward_headers.insert(
                    reqwest::header::HeaderName::from_static("x-callback-url"),
                    value,
                );
            }
        }

        // Forward the request
        let client = reqwest::Client::new();
        let forward_req = client
            .request(reqwest::Method::from_str(method.as_str()).unwrap(), &target_url)
            .headers(forward_headers)
            .body(body_bytes)
            .build()
            .unwrap();

        // Send the request and get response
        let resp = match client.execute(forward_req).await {
            Ok(r) => r,
            Err(e) => {
                warn!("Proxy error: {}", e);
                return Response::builder()
                    .status(StatusCode::BAD_GATEWAY)
                    .body(Body::from(format!("Proxy error: {}", e)))
                    .unwrap();
            }
        };

        // Log response
        let status = StatusCode::from_u16(resp.status().as_u16()).unwrap();
        let headers = resp.headers().clone();
        let body = resp.bytes().await.unwrap_or_default();

        log_entry.response = Some(ResponseLog {
            status: status.as_u16(),
            headers: headers
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                .collect(),
            body: Some(String::from_utf8_lossy(&body).to_string()),
        });

        // Store log entry
        state.logs.write().await.push(log_entry);

        // Convert response headers to axum format
        let mut response = Response::builder().status(status);
        for (k, v) in headers.iter() {
            if let Ok(name) = http::header::HeaderName::from_bytes(k.as_ref()) {
                if let Ok(value) = http::header::HeaderValue::from_bytes(v.as_ref()) {
                    response = response.header(name, value);
                }
            }
        }
        response.body(Body::from(body)).unwrap()
    }
} 