use std::net::{Ipv4Addr, SocketAddr, UdpSocket};
use std::sync::Mutex;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;

use crate::modules::lock::mutex_lock;
use crate::modules::pty::{PtyRemoteSession, PtyState};

const BIND_HOST: &str = "0.0.0.0";
const LOOPBACK_HOST: &str = "127.0.0.1";
const DEFAULT_REMOTE_PORT: u16 = 8765;
const LAN_PROBE_ADDR: &str = "8.8.8.8:80";
const TRANSCRIPT_CHUNK_BYTES: usize = 256 * 1024;
const POLL_INTERVAL: Duration = Duration::from_millis(80);

#[derive(Default)]
pub struct RemoteState {
    inner: Mutex<RemoteRuntime>,
}

#[derive(Default)]
struct RemoteRuntime {
    running: Option<RunningRemoteServer>,
}

struct RunningRemoteServer {
    port: u16,
    shutdown: Option<oneshot::Sender<()>>,
    handle: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteServiceStatus {
    pub enabled: bool,
    pub bind_host: String,
    pub port: Option<u16>,
    pub url: Option<String>,
    pub access_urls: Vec<String>,
}

impl RemoteServiceStatus {
    pub fn running(port: u16) -> Self {
        let access_urls = remote_access_urls(port);
        Self {
            enabled: true,
            bind_host: BIND_HOST.into(),
            port: Some(port),
            url: preferred_remote_url(&access_urls),
            access_urls,
        }
    }

    pub fn stopped() -> Self {
        Self {
            enabled: false,
            bind_host: BIND_HOST.into(),
            port: None,
            url: None,
            access_urls: Vec::new(),
        }
    }
}

fn preferred_remote_url(access_urls: &[String]) -> Option<String> {
    access_urls
        .iter()
        .find(|url| !url.contains(LOOPBACK_HOST))
        .or_else(|| access_urls.first())
        .cloned()
}

fn remote_access_urls(port: u16) -> Vec<String> {
    remote_access_hosts()
        .into_iter()
        .map(|host| format!("http://{host}:{port}/"))
        .collect()
}

fn remote_access_hosts() -> Vec<String> {
    let mut hosts = vec![LOOPBACK_HOST.to_string()];
    if let Some(ip) = primary_lan_ipv4() {
        let host = ip.to_string();
        if host != LOOPBACK_HOST {
            hosts.push(host);
        }
    }
    hosts
}

fn primary_lan_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0))).ok()?;
    socket.connect(LAN_PROBE_ADDR).ok()?;
    let addr = socket.local_addr().ok()?;
    match addr.ip() {
        std::net::IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() => Some(ip),
        _ => None,
    }
}

pub struct RemoteAuth {
    token: String,
}

impl RemoteAuth {
    pub fn new(token: String) -> Self {
        Self { token }
    }

    pub fn is_authorized(
        &self,
        query_token: Option<&str>,
        authorization_header: Option<&str>,
    ) -> bool {
        query_token
            .map(|token| constant_time_eq(token, &self.token))
            .unwrap_or(false)
            || bearer_token(authorization_header)
                .map(|token| constant_time_eq(token, &self.token))
                .unwrap_or(false)
    }
}

fn bearer_token(header: Option<&str>) -> Option<&str> {
    header?.strip_prefix("Bearer ").map(str::trim)
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    let a = a.as_bytes();
    let b = b.as_bytes();
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (left, right)| acc | (left ^ right))
        == 0
}

#[derive(Clone)]
struct RemoteServerState {
    app: AppHandle,
    auth_token: String,
    port: u16,
}

#[derive(Deserialize)]
struct AuthQuery {
    token: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum RemoteClientMessage {
    Input { data: String },
    Resize { cols: u16, rows: u16 },
    Sync { since_offset: u64 },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum RemoteServerMessage {
    Snapshot {
        session: PtyRemoteSession,
    },
    Output {
        start_offset: u64,
        next_offset: u64,
        total_offset: u64,
        data_base64: String,
    },
    Error {
        message: String,
    },
}

impl RemoteState {
    fn status(&self) -> RemoteServiceStatus {
        match mutex_lock(&self.inner, "remote state") {
            Ok(runtime) => runtime
                .running
                .as_ref()
                .map(|running| RemoteServiceStatus::running(running.port))
                .unwrap_or_else(RemoteServiceStatus::stopped),
            Err(error) => {
                log::error!("{error}");
                RemoteServiceStatus::stopped()
            }
        }
    }

    fn stop_locked(runtime: &mut RemoteRuntime) {
        if let Some(mut running) = runtime.running.take() {
            if let Some(shutdown) = running.shutdown.take() {
                let _ = shutdown.send(());
            }
            running.handle.abort();
        }
    }
}

#[tauri::command]
pub fn remote_terminal_status(state: tauri::State<'_, RemoteState>) -> RemoteServiceStatus {
    state.status()
}

#[tauri::command]
pub async fn remote_terminal_start(
    app: AppHandle,
    state: tauri::State<'_, RemoteState>,
    token: String,
    port: Option<u16>,
) -> Result<RemoteServiceStatus, String> {
    let token = token.trim().to_string();
    if token.len() < 16 {
        return Err("remote token must be at least 16 characters".into());
    }

    {
        let mut runtime = mutex_lock(&state.inner, "remote state")?;
        RemoteState::stop_locked(&mut runtime);
    }

    let requested_port = port.unwrap_or(DEFAULT_REMOTE_PORT);
    let addr = SocketAddr::from((Ipv4Addr::UNSPECIFIED, requested_port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("bind remote terminal service: {e}"))?;
    let actual_port = listener
        .local_addr()
        .map_err(|e| format!("read remote terminal address: {e}"))?
        .port();

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let router = build_router(RemoteServerState {
        app,
        auth_token: token,
        port: actual_port,
    });

    let handle = tauri::async_runtime::spawn(async move {
        if let Err(error) = axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
        {
            log::warn!("remote terminal service stopped with error: {error}");
        }
    });

    let mut runtime = mutex_lock(&state.inner, "remote state")?;
    runtime.running = Some(RunningRemoteServer {
        port: actual_port,
        shutdown: Some(shutdown_tx),
        handle,
    });
    Ok(RemoteServiceStatus::running(actual_port))
}

#[tauri::command]
pub fn remote_terminal_stop(state: tauri::State<'_, RemoteState>) -> RemoteServiceStatus {
    match mutex_lock(&state.inner, "remote state") {
        Ok(mut runtime) => RemoteState::stop_locked(&mut runtime),
        Err(error) => log::error!("{error}"),
    }
    RemoteServiceStatus::stopped()
}

fn build_router(state: RemoteServerState) -> Router {
    Router::new()
        .route("/", get(remote_index))
        .route("/remote", get(remote_index))
        .route("/remote.html", get(remote_index))
        .route("/assets/{*path}", get(remote_asset))
        .route("/api/status", get(api_status))
        .route("/api/terminals", get(api_terminals))
        .route("/api/terminals/{id}/ws", get(terminal_ws))
        .with_state(state)
}

async fn remote_index(State(state): State<RemoteServerState>) -> Response {
    serve_asset(&state.app, "remote.html").unwrap_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            "remote terminal assets are not built yet",
        )
            .into_response()
    })
}

async fn remote_asset(
    State(state): State<RemoteServerState>,
    Path(path): Path<String>,
) -> Response {
    serve_asset(&state.app, &format!("assets/{path}"))
        .unwrap_or_else(|| (StatusCode::NOT_FOUND, "asset not found").into_response())
}

fn serve_asset(app: &AppHandle, path: &str) -> Option<Response> {
    let asset = app.asset_resolver().get(path.to_string())?;
    let mut builder = Response::builder().status(StatusCode::OK);
    builder = builder.header(header::CONTENT_TYPE, asset.mime_type().to_string());
    Some(
        builder
            .body(axum::body::Body::from(asset.bytes))
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "asset error").into_response()),
    )
}

fn is_authorized(state: &RemoteServerState, query: &AuthQuery, headers: &HeaderMap) -> bool {
    let auth = RemoteAuth::new(state.auth_token.clone());
    auth.is_authorized(
        query.token.as_deref(),
        headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok()),
    )
}

async fn api_status(
    State(state): State<RemoteServerState>,
    Query(query): Query<AuthQuery>,
    headers: HeaderMap,
) -> Response {
    if !is_authorized(&state, &query, &headers) {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }
    Json(RemoteServiceStatus::running(state.port)).into_response()
}

async fn api_terminals(
    State(state): State<RemoteServerState>,
    Query(query): Query<AuthQuery>,
    headers: HeaderMap,
) -> Response {
    if !is_authorized(&state, &query, &headers) {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }
    let pty = state.app.state::<PtyState>();
    match pty.remote_sessions() {
        Ok(sessions) => Json(sessions).into_response(),
        Err(error) => (StatusCode::INTERNAL_SERVER_ERROR, error).into_response(),
    }
}

async fn terminal_ws(
    State(state): State<RemoteServerState>,
    Path(id): Path<u32>,
    Query(query): Query<AuthQuery>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !is_authorized(&state, &query, &headers) {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }
    ws.on_upgrade(move |socket| handle_terminal_ws(socket, state, id))
}

async fn handle_terminal_ws(socket: WebSocket, state: RemoteServerState, id: u32) {
    let (mut sender, mut receiver) = socket.split();
    let mut next_offset = 0;
    let mut interval = tokio::time::interval(POLL_INTERVAL);

    let sessions = match state.app.state::<PtyState>().remote_sessions() {
        Ok(sessions) => sessions,
        Err(message) => {
            let _ = send_json(&mut sender, &RemoteServerMessage::Error { message }).await;
            return;
        }
    };
    let session = sessions.into_iter().find(|session| session.id == id);
    let Some(session) = session else {
        let _ = send_json(
            &mut sender,
            &RemoteServerMessage::Error {
                message: format!("unknown pty session: {id}"),
            },
        )
        .await;
        return;
    };
    if send_json(&mut sender, &RemoteServerMessage::Snapshot { session })
        .await
        .is_err()
    {
        return;
    }

    loop {
        tokio::select! {
            _ = interval.tick() => {
                match state.app.state::<PtyState>().read_remote_transcript(
                    id,
                    next_offset,
                    TRANSCRIPT_CHUNK_BYTES,
                ) {
                    Ok(read) => {
                        if read.next_offset > next_offset {
                            next_offset = read.next_offset;
                            let message = RemoteServerMessage::Output {
                                start_offset: read.start_offset,
                                next_offset: read.next_offset,
                                total_offset: read.total_offset,
                                data_base64: read.data_base64,
                            };
                            if send_json(&mut sender, &message).await.is_err() {
                                return;
                            }
                        }
                    }
                    Err(message) => {
                        let _ = send_json(&mut sender, &RemoteServerMessage::Error { message }).await;
                        return;
                    }
                }
            }
            incoming = receiver.next() => {
                let Some(Ok(message)) = incoming else { return; };
                if handle_client_message(&state, id, message, &mut next_offset).is_err() {
                    let _ = send_json(
                        &mut sender,
                        &RemoteServerMessage::Error {
                            message: "invalid terminal control message".into(),
                        },
                    )
                    .await;
                    return;
                }
            }
        }
    }
}

fn handle_client_message(
    state: &RemoteServerState,
    id: u32,
    message: Message,
    next_offset: &mut u64,
) -> Result<(), String> {
    let Message::Text(text) = message else {
        return Ok(());
    };
    match serde_json::from_str::<RemoteClientMessage>(&text).map_err(|e| e.to_string())? {
        RemoteClientMessage::Input { data } => state
            .app
            .state::<PtyState>()
            .write_remote_session(id, &data),
        RemoteClientMessage::Resize { cols, rows } => state
            .app
            .state::<PtyState>()
            .resize_remote_session(id, cols, rows),
        RemoteClientMessage::Sync { since_offset } => {
            *next_offset = since_offset;
            Ok(())
        }
    }
}

async fn send_json(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    message: &RemoteServerMessage,
) -> Result<(), axum::Error> {
    let body = serde_json::to_string(message).unwrap_or_else(|_| {
        r#"{"type":"error","message":"failed to encode server message"}"#.into()
    });
    sender.send(Message::Text(body.into())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_accepts_query_token_or_bearer_header() {
        let auth = RemoteAuth::new("secret-token".into());

        assert!(auth.is_authorized(Some("secret-token"), None));
        assert!(auth.is_authorized(None, Some("Bearer secret-token")));
        assert!(!auth.is_authorized(Some("wrong"), None));
        assert!(!auth.is_authorized(None, Some("Bearer wrong")));
        assert!(!auth.is_authorized(None, None));
    }

    #[test]
    fn remote_status_exposes_lan_bind_and_access_urls() {
        let status = RemoteServiceStatus::running(49201);

        assert_eq!(status.bind_host, "0.0.0.0");
        assert!(status
            .access_urls
            .iter()
            .any(|url| url == "http://127.0.0.1:49201/"));
        assert!(status
            .url
            .as_deref()
            .is_some_and(|url| status.access_urls.iter().any(|candidate| candidate == url)));
    }
}
