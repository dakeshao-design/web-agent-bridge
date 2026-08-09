use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Header, Method, Response, Server, StatusCode};
use crate::webview_bridge::{debug_query_agent, debug_query_bridge_response, debug_query_last_file_op, debug_reset_sync, WebviewState};

const HELP_TEXT: &str = r#"WebAgent Debug CLI (HTTP)

Base URL: http://127.0.0.1:9781  (override with DEBUG_PORT)

Commands:
  GET  /debug/help
  GET  /debug/status
  POST /debug/click          {"action":"agent-mode|open-folder|open-file|save|save-as|send-current-file|send-selection"}
  POST /debug/select-agent   {"agentId":"example"}
  POST /debug/open-folder    {"path":"C:/work/test-editor"}   (omit path to open dialog)
  POST /debug/send-prompt    {"text":"hello", "agentId":"example"}
  GET  /debug/agent-dom?agentId=example
  GET  /debug/conversation?agentId=example
  GET  /debug/bridge-response?agentId=example
  GET  /debug/last-file-op
  POST /debug/reset-sync     {"agentId":"example"}

PowerShell helper:
  .\scripts\debug-cli.ps1 help
  .\scripts\debug-cli.ps1 click agent-mode
  .\scripts\debug-cli.ps1 agent-dom example
  .\scripts\debug-cli.ps1 flow-read C:/work/test-editor example

Options:
  DEBUG_PORT=9781
  DEBUG_STEP_DELAY_MS=2000     delay after each HTTP call
  DEBUG_FLOW_AGENT_WAIT_MS=15000
  DEBUG_FLOW_REPLY_WAIT_MS=12000
"#;

#[derive(Debug, Deserialize, Default)]
struct ClickBody {
    action: String,
}

#[derive(Debug, Deserialize, Default)]
struct AgentBody {
    #[serde(default, alias = "agentId")]
    agent_id: String,
}

#[derive(Debug, Deserialize, Default)]
struct OpenFolderBody {
    #[serde(default)]
    path: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct SendPromptBody {
    text: String,
    #[serde(default, alias = "agentId")]
    agent_id: String,
}

pub fn start_debug_server(app: AppHandle) {
    std::thread::spawn(move || {
        let port = std::env::var("DEBUG_PORT").unwrap_or_else(|_| "9781".into());
        let addr = format!("127.0.0.1:{}", port);
        let server = match Server::http(&addr) {
            Ok(value) => value,
            Err(err) => {
                eprintln!("[debug] failed to bind {}: {}", addr, err);
                return;
            }
        };

        eprintln!("[debug] CLI server listening on http://{}", addr);
        eprintln!("[debug] run: curl http://{}/debug/help", addr);

        for request in server.incoming_requests() {
            let app = app.clone();
            std::thread::spawn(move || {
                let mut request = request;
                let method = request.method().clone();
                let url = request.url().to_string();
                let body = read_body(&mut request);
                let response = match handle_request(&app, method, &url, &body) {
                    Ok(response) => response,
                    Err(err) => json_error(StatusCode(500), &err),
                };
                if let Err(err) = request.respond(response) {
                    eprintln!("[debug] response error: {}", err);
                }
            });
        }
    });
}

fn handle_request(
    app: &AppHandle,
    method: Method,
    url: &str,
    body: &str,
) -> Result<Response<std::io::Cursor<Vec<u8>>>, String> {
    let path = url.split('?').next().unwrap_or("/").to_string();
    let query = parse_query(url.split('?').nth(1).unwrap_or(""));

    match (method, path.as_str()) {
        (Method::Get, "/debug/help") => text_ok(HELP_TEXT),
        (Method::Get, "/debug/status") => json_ok(debug_status(app)?),
        (Method::Get, "/debug/agent-dom") => {
            let agent_id = required_agent_id(&query, &body)?;
            json_ok(debug_query_agent(app, &agent_id)?)
        }
        (Method::Get, "/debug/conversation") => {
            let agent_id = required_agent_id(&query, &body)?;
            let data = debug_query_agent(app, &agent_id)?;
            Ok(json_response(
                StatusCode(200),
                &json!({
                    "agentId": agent_id,
                    "conversation": data.get("conversation").cloned().unwrap_or(json!([])),
                    "bridgeReady": data.get("bridgeReady"),
                    "virtualItemCount": data.get("virtualItemCount"),
                }),
            )?)
        }
        (Method::Get, "/debug/last-file-op") => json_ok(debug_query_last_file_op(app)?),
        (Method::Get, "/debug/bridge-response") => {
            let agent_id = required_agent_id(&query, &body)?;
            json_ok(debug_query_bridge_response(app, &agent_id)?)
        }
        (Method::Post, "/debug/click") => {
            let payload: ClickBody = parse_json(&body)?;
            emit_debug(
                app,
                json!({
                    "type": "click",
                    "action": payload.action,
                }),
            )?;
            json_ok(json!({ "ok": true, "action": payload.action }))
        }
        (Method::Post, "/debug/select-agent") => {
            let payload: AgentBody = parse_json(&body)?;
            let agent_id = payload.agent_id;
            if agent_id.is_empty() {
                return Err("agentId is required".into());
            }
            emit_debug(
                app,
                json!({
                    "type": "select-agent",
                    "agentId": agent_id,
                }),
            )?;
            json_ok(json!({ "ok": true, "agentId": agent_id }))
        }
        (Method::Post, "/debug/open-folder") => {
            let payload: OpenFolderBody = if body.trim().is_empty() {
                OpenFolderBody::default()
            } else {
                parse_json(&body)?
            };
            emit_debug(
                app,
                json!({
                    "type": "open-folder",
                    "path": payload.path,
                }),
            )?;
            json_ok(json!({ "ok": true, "path": payload.path }))
        }
        (Method::Post, "/debug/send-prompt") => {
            let payload: SendPromptBody = parse_json(&body)?;
            if payload.text.is_empty() {
                return Err("text is required".into());
            }
            let agent_id = payload.agent_id;
            emit_debug(
                app,
                json!({
                    "type": "send-prompt",
                    "text": payload.text,
                    "agentId": agent_id,
                }),
            )?;
            json_ok(json!({
                "ok": true,
                "agentId": agent_id,
                "textLength": payload.text.len(),
            }))
        }
        (Method::Post, "/debug/reset-sync") => {
            let payload: AgentBody = parse_json(&body)?;
            let agent_id = payload.agent_id;
            if agent_id.is_empty() {
                return Err("agentId is required".into());
            }
            debug_reset_sync(app, &agent_id)?;
            json_ok(json!({ "ok": true, "agentId": agent_id, "reset": true }))
        }
        _ => Ok(json_error(StatusCode(404), "unknown debug endpoint")),
    }
}

fn debug_status(app: &AppHandle) -> Result<serde_json::Value, String> {
    let state = app.state::<WebviewState>();
    let webviews = state
        .webviews
        .lock()
        .map_err(|e| e.to_string())?
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    let active_syncs = state
        .active_syncs
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .cloned()
        .collect::<Vec<_>>();

    Ok(json!({
        "ok": true,
        "webviews": webviews,
        "activeSyncs": active_syncs,
    }))
}

fn emit_debug(app: &AppHandle, payload: serde_json::Value) -> Result<(), String> {
    app.emit("debug-command", payload)
        .map_err(|e| e.to_string())
}

fn required_agent_id(
    query: &std::collections::HashMap<String, String>,
    body: &str,
) -> Result<String, String> {
    if let Some(agent_id) = query.get("agentId").or_else(|| query.get("agent_id")) {
        if !agent_id.is_empty() {
            return Ok(agent_id.clone());
        }
    }
    if !body.is_empty() {
        let payload: AgentBody = parse_json(body)?;
        let agent_id = payload.agent_id;
        if !agent_id.is_empty() {
            return Ok(agent_id);
        }
    }
    Ok("example".to_string())
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
    let _ = request.as_reader().read_to_string(&mut body);
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
    let body = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    Ok(Response::from_string(body)
        .with_status_code(status)
        .with_header(json_header()))
}

fn json_ok(value: serde_json::Value) -> Result<Response<std::io::Cursor<Vec<u8>>>, String> {
    json_response(StatusCode(200), &value)
}

fn json_error(status: StatusCode, message: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let payload = json!({ "ok": false, "error": message });
    json_response(status, &payload)
        .unwrap_or_else(|_| Response::from_string(message.to_string()).with_status_code(status))
}

fn text_ok(text: &str) -> Result<Response<std::io::Cursor<Vec<u8>>>, String> {
    Ok(Response::from_string(text.to_string())
        .with_status_code(StatusCode(200))
        .with_header(text_header()))
}

fn json_header() -> Header {
    Header::from_bytes(&b"Content-Type"[..], &b"application/json; charset=utf-8"[..]).unwrap()
}

fn text_header() -> Header {
    Header::from_bytes(&b"Content-Type"[..], &b"text/plain; charset=utf-8"[..]).unwrap()
}
