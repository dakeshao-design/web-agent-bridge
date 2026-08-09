//! Agent Host HTTP IPC（VS Code 扩展用）
use serde::Deserialize;
use serde_json::json;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Listener, Manager};
use tiny_http::{Header, Method, Response, Server, StatusCode};

use crate::webview_bridge::{
    agent_bridge_is_loading, create_agent_webview, fill_agent_message, hide_agent_webview,
    send_agent_message, show_agent_webview, WebviewBounds, WebviewState,
};

const DEFAULT_PORT: &str = "9791";

#[derive(Clone)]
struct EventBus {
    events: Arc<Mutex<VecDeque<serde_json::Value>>>,
    seq: Arc<Mutex<u64>>,
}

impl EventBus {
    fn new() -> Self {
        Self {
            events: Arc::new(Mutex::new(VecDeque::new())),
            seq: Arc::new(Mutex::new(0)),
        }
    }

    fn push(&self, mut payload: serde_json::Value) {
        let mut seq = self.seq.lock().unwrap();
        *seq += 1;
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("seq".into(), json!(*seq));
        }
        let mut events = self.events.lock().unwrap();
        events.push_back(payload);
        while events.len() > 500 {
            events.pop_front();
        }
    }

    fn since(&self, after: u64) -> Vec<serde_json::Value> {
        let events = self.events.lock().unwrap();
        events
            .iter()
            .filter(|e| e.get("seq").and_then(|s| s.as_u64()).unwrap_or(0) > after)
            .cloned()
            .collect()
    }
}

#[derive(Debug, Deserialize, Default)]
struct CreateBody {
    #[serde(default, alias = "agentId")]
    agent_id: String,
    #[serde(default)]
    url: String,
    #[serde(default, alias = "bridgeScript")]
    bridge_script: String,
    #[serde(default, alias = "templateScript")]
    template_script: String,
    #[serde(default, alias = "bridgeConfig")]
    bridge_config: serde_json::Value,
    #[serde(default)]
    bounds: Option<WebviewBounds>,
    #[serde(default)]
    hidden: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
struct AgentBody {
    #[serde(default, alias = "agentId")]
    agent_id: String,
    #[serde(default)]
    bounds: Option<WebviewBounds>,
}

#[derive(Debug, Deserialize, Default)]
struct SendBody {
    #[serde(default, alias = "agentId")]
    agent_id: String,
    #[serde(default)]
    text: String,
}

pub fn start_host_server(app: AppHandle) {
    let bus = EventBus::new();
    let bus_chat = bus.clone();
    let bus_comm = bus.clone();

    app.listen("agent-chat-message", move |event| {
        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) {
            let mut wrapped = json!({ "type": "chat" });
            if let Some(obj) = wrapped.as_object_mut() {
                if let Some(p) = payload.as_object() {
                    for (k, v) in p {
                        obj.insert(k.clone(), v.clone());
                    }
                }
            }
            bus_chat.push(wrapped);
        }
    });

    app.listen("bridge-comm-log", move |event| {
        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) {
            let mut wrapped = json!({ "type": "bridgeComm" });
            if let Some(obj) = wrapped.as_object_mut() {
                if let Some(p) = payload.as_object() {
                    for (k, v) in p {
                        obj.insert(k.clone(), v.clone());
                    }
                }
            }
            bus_comm.push(wrapped);
        }
    });

    let bus_closed = bus.clone();
    app.listen("agent-webview-closed", move |event| {
        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) {
            let agent_id = payload
                .get("agentId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if !agent_id.is_empty() {
                bus_closed.push(json!({
                    "type": "agentClosed",
                    "agentId": agent_id,
                }));
            }
        }
    });

    let token = std::env::var("AGENT_HOST_TOKEN").unwrap_or_else(|_| "dev-token".into());
    let port = std::env::var("AGENT_HOST_PORT").unwrap_or_else(|_| DEFAULT_PORT.into());
    let addr = format!("127.0.0.1:{}", port);

    std::thread::spawn(move || {
        let server = match Server::http(&addr) {
            Ok(s) => s,
            Err(err) => {
                eprintln!("[agent-host] bind failed {}: {}", addr, err);
                return;
            }
        };
        eprintln!("[agent-host] listening on http://{}", addr);

        for request in server.incoming_requests() {
            let app = app.clone();
            let bus = bus.clone();
            let token = token.clone();
            std::thread::spawn(move || {
                let mut request = request;
                let method = request.method().clone();
                let url = request.url().to_string();
                let auth_ok = request.headers().iter().any(|h| {
                    let field = h.field.as_str().to_string().to_ascii_lowercase();
                    field == "x-agent-host-token" && h.value.as_str() == token.as_str()
                }) || url.contains(&format!("token={}", token));

                let path = url.split('?').next().unwrap_or("/").to_string();
                if path != "/health" && !auth_ok {
                    let _ = request.respond(json_error(StatusCode(401), "unauthorized"));
                    return;
                }

                let body = read_body(&mut request);
                let response = match handle(&app, &bus, method, &path, &url, &body) {
                    Ok(r) => r,
                    Err(err) => json_error(StatusCode(500), &err),
                };
                let _ = request.respond(response);
            });
        }
    });
}

fn handle(
    app: &AppHandle,
    bus: &EventBus,
    method: Method,
    path: &str,
    url: &str,
    body: &str,
) -> Result<Response<std::io::Cursor<Vec<u8>>>, String> {
    match (method, path) {
        (Method::Get, "/health") => json_ok(json!({ "ok": true, "mode": "agent-host" })),
        (Method::Get, "/events") => {
            let after = parse_query(url.split('?').nth(1).unwrap_or(""))
                .get("after")
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
            // 短轮询：最多等 2 秒
            for _ in 0..20 {
                let events = bus.since(after);
                if !events.is_empty() {
                    return json_ok(json!({ "ok": true, "events": events }));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            json_ok(json!({ "ok": true, "events": [] }))
        }
        (Method::Post, "/agents/create") => {
            let payload: CreateBody = parse_json(body)?;
            if payload.agent_id.is_empty() || payload.url.is_empty() {
                return Err("agentId and url are required".into());
            }
            let label = format!("agent-{}", payload.agent_id);
            let bounds = payload.bounds.unwrap_or(WebviewBounds {
                x: 0.0,
                y: 0.0,
                width: 900.0,
                height: 700.0,
            });
            let bridge_config = if payload.bridge_config.is_null() {
                json!({})
            } else {
                payload.bridge_config
            };

            let app2 = app.clone();
            let agent_id = payload.agent_id.clone();
            let url_s = payload.url.clone();
            let bridge_script = payload.bridge_script.clone();
            let template_script = payload.template_script.clone();
            let hidden = payload.hidden.unwrap_or(true);

            let result = tauri::async_runtime::block_on(async move {
                let state = app2.state::<WebviewState>();
                create_agent_webview(
                    app2.clone(),
                    state,
                    label.clone(),
                    url_s,
                    agent_id.clone(),
                    bounds,
                    bridge_script,
                    template_script,
                    bridge_config,
                )
                .await?;
                // 启动会话同步；静默时再 hide
                show_agent_webview(app2.clone(), label.clone(), bounds).await?;
                if hidden {
                    hide_agent_webview(app2, label).await?;
                }
                Ok::<(), String>(())
            });
            result?;
            json_ok(json!({ "ok": true, "agentId": payload.agent_id }))
        }
        (Method::Post, "/agents/show") => {
            let payload: AgentBody = parse_json(body)?;
            if payload.agent_id.is_empty() {
                return Err("agentId is required".into());
            }
            let label = format!("agent-{}", payload.agent_id);
            let bounds = payload.bounds.unwrap_or(WebviewBounds {
                x: 40.0,
                y: 40.0,
                width: 1000.0,
                height: 750.0,
            });
            let app2 = app.clone();
            tauri::async_runtime::block_on(async move {
                show_agent_webview(app2, label, bounds).await
            })?;
            json_ok(json!({ "ok": true, "agentId": payload.agent_id }))
        }
        (Method::Post, "/agents/hide") => {
            let payload: AgentBody = parse_json(body)?;
            if payload.agent_id.is_empty() {
                return Err("agentId is required".into());
            }
            let label = format!("agent-{}", payload.agent_id);
            let app2 = app.clone();
            tauri::async_runtime::block_on(async move {
                hide_agent_webview(app2, label).await
            })?;
            json_ok(json!({ "ok": true, "agentId": payload.agent_id }))
        }
        (Method::Post, "/agents/send") => {
            let payload: SendBody = parse_json(body)?;
            if payload.agent_id.is_empty() || payload.text.is_empty() {
                return Err("agentId and text are required".into());
            }
            let label = format!("agent-{}", payload.agent_id);
            let app2 = app.clone();
            let agent_id = payload.agent_id.clone();
            let text = payload.text.clone();
            tauri::async_runtime::block_on(async move {
                send_agent_message(app2, label, agent_id, text).await
            })?;
            json_ok(json!({ "ok": true }))
        }
        (Method::Post, "/agents/fill") => {
            let payload: SendBody = parse_json(body)?;
            if payload.agent_id.is_empty() {
                return Err("agentId is required".into());
            }
            let label = format!("agent-{}", payload.agent_id);
            let app2 = app.clone();
            let agent_id = payload.agent_id.clone();
            let text = payload.text.clone();
            tauri::async_runtime::block_on(async move {
                fill_agent_message(app2, label, agent_id, text).await
            })?;
            json_ok(json!({ "ok": true }))
        }
        (Method::Get, "/agents/loading") => {
            let agent_id = parse_query(url.split('?').nth(1).unwrap_or(""))
                .get("agentId")
                .cloned()
                .unwrap_or_default();
            if agent_id.is_empty() {
                return Err("agentId is required".into());
            }
            let app2 = app.clone();
            let loading = tauri::async_runtime::block_on(async move {
                agent_bridge_is_loading(app2, agent_id).await
            })?;
            json_ok(json!({ "ok": true, "loading": loading }))
        }
        (Method::Post, "/shutdown") => {
            let app2 = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(200));
                app2.exit(0);
            });
            json_ok(json!({ "ok": true }))
        }
        _ => Ok(json_error(StatusCode(404), "unknown endpoint")),
    }
}

fn parse_query(query: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or("").to_string();
        let value = parts.next().unwrap_or("").to_string();
        if !key.is_empty() {
            map.insert(key, value);
        }
    }
    map
}

fn read_body(request: &mut tiny_http::Request) -> String {
    let mut body = String::new();
    let _ = std::io::Read::read_to_string(request.as_reader(), &mut body);
    body
}

fn parse_json<T: for<'de> Deserialize<'de>>(body: &str) -> Result<T, String> {
    if body.trim().is_empty() {
        return Err("request body is required".into());
    }
    serde_json::from_str(body).map_err(|e| e.to_string())
}

fn json_response(
    status: StatusCode,
    value: &serde_json::Value,
) -> Result<Response<std::io::Cursor<Vec<u8>>>, String> {
    let body = serde_json::to_string(value).map_err(|e| e.to_string())?;
    Ok(Response::from_string(body)
        .with_status_code(status)
        .with_header(
            Header::from_bytes(&b"Content-Type"[..], &b"application/json; charset=utf-8"[..])
                .unwrap(),
        ))
}

fn json_ok(value: serde_json::Value) -> Result<Response<std::io::Cursor<Vec<u8>>>, String> {
    json_response(StatusCode(200), &value)
}

fn json_error(status: StatusCode, message: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let payload = json!({ "ok": false, "error": message });
    json_response(status, &payload)
        .unwrap_or_else(|_| Response::from_string(message.to_string()).with_status_code(status))
}
