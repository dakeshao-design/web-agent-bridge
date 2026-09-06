use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::json;
use tauri::webview::{NewWindowFeatures, NewWindowResponse, WebviewWindowBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, WindowEvent};

/// Host 轮询 pollSnapshot / pollSnapshotForHost
const POLL_SNAPSHOT_EXPR: &str = r#"(function(){try{if(!window.__agentEditorBridge)return JSON.stringify({error:"no bridge"});var fn=window.__agentEditorBridge.pollSnapshotForHost||window.__agentEditorBridge.pollSnapshot;if(typeof fn!=="function")return JSON.stringify({error:"no pollSnapshot"});return JSON.stringify(fn.call(window.__agentEditorBridge));}catch(e){return JSON.stringify({error:String(e)});}})()"#;

const BRIDGE_CHECK_EXPR: &str = "Boolean(window.__agentEditorBridge)";

const BRIDGE_IS_LOADING_EXPR: &str = r#"(function(){try{if(!window.__agentEditorBridge||!window.__agentEditorBridge.isLoading)return "false";return window.__agentEditorBridge.isLoading()?"true":"false";}catch(e){return "false";}})()"#;

const BRIDGE_COPY_DEBUG_EXPR: &str = r#"(function(){try{if(!window.__agentEditorBridge)return JSON.stringify({error:"no bridge"});return JSON.stringify(window.__agentEditorBridge.getCopyToolDebug());}catch(e){return JSON.stringify({error:String(e)});}})()"#;

const BRIDGE_SCHEDULE_COPY_EXPR: &str = r#"(function(){try{if(window.__agentEditorBridge&&window.__agentEditorBridge.scheduleToolCopyRead)window.__agentEditorBridge.scheduleToolCopyRead();return "ok";}catch(e){return String(e);}})()"#;

const BRIDGE_DRAIN_COMM_LOGS_EXPR: &str = r#"(function(){try{if(!window.__agentEditorBridge||!window.__agentEditorBridge.drainPendingCommLogs)return "[]";return JSON.stringify(window.__agentEditorBridge.drainPendingCommLogs());}catch(e){return "[]";}})()"#;

const BRIDGE_DRAIN_CHAT_EXPR: &str = r#"(function(){try{if(!window.__agentEditorBridge||!window.__agentEditorBridge.drainPendingChatMessages)return "[]";return JSON.stringify(window.__agentEditorBridge.drainPendingChatMessages());}catch(e){return "[]";}})()"#;

const BRIDGE_TAKE_RESET_EXPR: &str = r#"(function(){try{if(!window.__agentEditorBridge||!window.__agentEditorBridge.takePendingResetBaseline)return "false";return window.__agentEditorBridge.takePendingResetBaseline()?"true":"false";}catch(e){return "false";}})()"#;

const BRIDGE_TAKE_NEWCHAT_ONLOAD_EXPR: &str = r#"(function(){try{if(!window.__agentEditorBridge||!window.__agentEditorBridge.takePendingNewChatOnloadAgentMode)return "false";return window.__agentEditorBridge.takePendingNewChatOnloadAgentMode()?"true":"false";}catch(e){return "false";}})()"#;

const BRIDGE_COMPOSER_READY_EXPR: &str = r#"(function(){try{if(!window.__agentEditorBridge||!window.__agentEditorBridge.getComposer)return false;var c=window.__agentEditorBridge.getComposer();return !!(c&&c.input);}catch(e){return false;}})()"#;

const BRIDGE_START_NEW_CHAT_EXPR: &str = r#"(function(){try{if(!window.__agentEditorBridge||!window.__agentEditorBridge.startNewChatSession)return JSON.stringify({ok:false,error:"no bridge"});return JSON.stringify(window.__agentEditorBridge.startNewChatSession());}catch(e){return JSON.stringify({ok:false,error:String(e)});}})()"#;

const BRIDGE_POLL_NEW_CHAT_EXPR: &str = r#"(function(){try{if(!window.__agentEditorBridge||!window.__agentEditorBridge.pollNewChatSessionStatus)return JSON.stringify({status:"done",ok:false,error:"no bridge"});return JSON.stringify(window.__agentEditorBridge.pollNewChatSessionStatus());}catch(e){return JSON.stringify({status:"done",ok:false,error:String(e)});}})()"#;

const DEBUG_DOM_EXPR: &str = r#"(function(){try{var items=document.querySelectorAll('[data-virtual-list-item-key]');var sample=[];for(var i=0;i<Math.min(items.length,5);i++){var item=items[i];sample.push({key:item.getAttribute('data-virtual-list-item-key'),html:item.outerHTML.substring(0,800)});}var input=null;var inputText='';var inputHtml='';var inputTag='';try{var list=document.querySelectorAll('[contenteditable="true"], textarea');var best=null;var maxY=-1;for(var i=0;i<list.length;i++){var el=list[i];var r=el.getBoundingClientRect();if(r.width>0&&r.height>0&&r.bottom>maxY){maxY=r.bottom;best=el;}}input=best;if(input){inputTag=input.tagName;inputText=String(input.innerText||input.value||'').trim();inputHtml=String(input.innerHTML||'').substring(0,2000);}}catch(e){}var sendBtn=null;var sendDisabled=null;try{var btns=document.querySelectorAll('button');for(var j=btns.length-1;j>=0;j--){var b=btns[j];if(b.offsetParent===null)continue;var label=(b.getAttribute('aria-label')||'')+(b.textContent||'');if(/发送|send/i.test(label)){sendBtn=label.trim().substring(0,80);sendDisabled=!!b.disabled;break;}}}catch(e){}var main=document.querySelector('main')||document.body;var mainText=main?String(main.innerText||'').trim():'';var bodyText=document.body?String(document.body.innerText||'').trim():'';var unsupported=[];var all=document.querySelectorAll('main *, [class*="toast"], [class*="message"], [class*="tip"], [class*="error"], [role="alert"]');for(var k=0;k<all.length;k++){var node=all[k];var t=(node.innerText||node.textContent||'').trim();if(!t||t.length>80)continue;if(t.indexOf('暂不支持该消息类型')===-1)continue;var r=node.getBoundingClientRect();unsupported.push({text:t,tag:node.tagName,cls:String(node.className||'').slice(0,120),w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.left),y:Math.round(r.top)});}var bridgeInput='';var bridgeMode='';try{if(window.__agentEditorBridge){if(window.__agentEditorBridge.getComposer){var c=window.__agentEditorBridge.getComposer();if(c&&c.input){bridgeInput=String(c.input.innerText||c.input.value||'').trim();}}bridgeMode=String((window.__agentEditorBridge._debugState&&window.__agentEditorBridge._debugState())||'');}}catch(e){}var lastRows=[];try{var rows=document.querySelectorAll('main [class*="message-list"] [data-message-id]');for(var ri=Math.max(0,rows.length-4);ri<rows.length;ri++){var row=rows[ri];lastRows.push({id:row.getAttribute('data-message-id'),cls:String(row.className||'').slice(0,100),text:String(row.innerText||'').trim().substring(0,300)});}}catch(e){}return{url:location.href,bridge:Boolean(window.__agentEditorBridge),virtualItemCount:items.length,title:document.title,inputTag:inputTag,inputText:inputText,inputTextLen:inputText.length,inputHtml:inputHtml,bridgeInput:bridgeInput,bridgeInputLen:bridgeInput.length,hasComposerInput:(function(){try{if(!window.__agentEditorBridge||!window.__agentEditorBridge.getComposer)return false;var c=window.__agentEditorBridge.getComposer();return !!(c&&c.input);}catch(e){return false;}})(),newChatOnloadDebug:(function(){try{if(!window.__agentEditorBridge||!window.__agentEditorBridge.getNewChatOnloadDebug)return null;return window.__agentEditorBridge.getNewChatOnloadDebug();}catch(e){return{error:String(e)};}})(),bridgeMode:bridgeMode,sendBtn:sendBtn,sendDisabled:sendDisabled,unsupported:unsupported,unsupportedCount:unsupported.length,lastRows:lastRows,mainTextTail:mainText.slice(-1200),bodyTextTail:bodyText.slice(-800)};}catch(e){return{error:String(e)};}})()"#;

const AGENT_INSPECT_EXPR: &str = r#"(function(){try{var inputs=[];document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]').forEach(function(el){var r=el.getBoundingClientRect();inputs.push({tag:el.tagName,ph:(el.placeholder||'').slice(0,40),w:Math.round(r.width),h:Math.round(r.height),b:Math.round(r.bottom),cls:String(el.className||'').slice(0,80)});});var btns=[];document.querySelectorAll('button,[role="button"]').forEach(function(b){if(b.offsetParent===null)return;var label=((b.getAttribute('aria-label')||'')+(b.textContent||'')).trim().slice(0,50);if(/发送|send|submit|提交/i.test(label)||b.type==='submit')btns.push({label:label,disabled:!!b.disabled,cls:String(b.className||'').slice(0,80)});});var blocks=[];document.querySelectorAll('[class*="dialog"] [class*="item"],[class*="message"],[class*="chat"],[class*="answer"],[class*="markdown"],[class*="bubble"]').forEach(function(el,i){var t=(el.innerText||'').trim();if(t.length>15&&t.length<2000)blocks.push({i:i,len:t.length,preview:t.slice(0,120),cls:String(el.className||'').slice(0,80)});});return{inputCount:inputs.length,inputs:inputs.slice(-8),btns:btns.slice(-10),blocks:blocks.slice(-8)};}catch(e){return{error:String(e)};}})()"#;

pub struct WebviewState {
    pub webviews: Mutex<HashMap<String, bool>>,
    pub responses: Mutex<HashMap<String, String>>,
    pub peek_cache: Mutex<HashMap<String, String>>,
    pub peek_key_cache: Mutex<HashMap<String, i64>>,
    pub injection_scripts: Mutex<HashMap<String, String>>,
    sync_states: Mutex<HashMap<String, AgentSyncState>>,
    pub active_syncs: Mutex<HashSet<String>>,
    pub visible_labels: Mutex<HashSet<String>>,
    /// Host 静默屏外窗：抢焦点时再钉回屏外
    pub silent_labels: Mutex<HashSet<String>>,
    eval_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl Default for WebviewState {
    fn default() -> Self {
        Self {
            webviews: Mutex::new(HashMap::new()),
            responses: Mutex::new(HashMap::new()),
            peek_cache: Mutex::new(HashMap::new()),
            peek_key_cache: Mutex::new(HashMap::new()),
            injection_scripts: Mutex::new(HashMap::new()),
            sync_states: Mutex::new(HashMap::new()),
            active_syncs: Mutex::new(HashSet::new()),
            visible_labels: Mutex::new(HashSet::new()),
            silent_labels: Mutex::new(HashSet::new()),
            eval_locks: Mutex::new(HashMap::new()),
        }
    }
}

fn eval_lock_for(state: &WebviewState, label: &str) -> Arc<Mutex<()>> {
    let mut locks = state
        .eval_locks
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    locks
        .entry(label.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

fn is_webview_visible(state: &WebviewState, label: &str) -> bool {
    // Agent Host 静默模式：隐藏窗仍需轮询 bridge
    if crate::is_agent_host_mode() {
        return true;
    }
    state
        .visible_labels
        .lock()
        .map(|visible| visible.contains(label))
        .unwrap_or(true)
}

fn agent_webview_alive(app: &AppHandle, label: &str) -> bool {
    if crate::is_agent_host_mode() {
        app.get_webview_window(label).is_some()
    } else {
        app.get_webview(label).is_some()
    }
}

/// Host 静默：屏外 show，避免 win.hide 触发 WebView2 节流导致无回复
fn place_host_window_silent(win: &tauri::WebviewWindow) -> Result<(), String> {
    let _ = win.set_skip_taskbar(true);
    // 保持合理尺寸，避免部分站点在极小窗下停更
    win.set_size(LogicalSize::new(960.0, 720.0))
        .map_err(|e| e.to_string())?;
    win.set_position(LogicalPosition::new(-32000.0, -32000.0))
        .map_err(|e| e.to_string())?;
    win.show().map_err(|e| e.to_string())?;
    // show 后系统可能把窗拉回屏幕，再钉一次且不抢焦点
    let _ = win.set_position(LogicalPosition::new(-32000.0, -32000.0));
    Ok(())
}

fn mark_host_window_silent(app: &AppHandle, label: &str, silent: bool) {
    let state = app.state::<WebviewState>();
    if let Ok(mut labels) = state.silent_labels.lock() {
        if silent {
            labels.insert(label.to_string());
        } else {
            labels.remove(label);
        }
    };
}

fn is_host_window_silent(app: &AppHandle, label: &str) -> bool {
    let state = app.state::<WebviewState>();
    state
        .silent_labels
        .lock()
        .map(|labels| labels.contains(label))
        .unwrap_or(false)
}

fn mark_agent_webview_gone(app: &AppHandle, label: &str) {
    let state = app.state::<WebviewState>();
    if let Ok(mut webviews) = state.webviews.lock() {
        webviews.remove(label);
    }
    if let Ok(mut visible) = state.visible_labels.lock() {
        visible.remove(label);
    }
    if let Ok(mut silent) = state.silent_labels.lock() {
        silent.remove(label);
    }
    let agent_id = label
        .strip_prefix("agent-")
        .unwrap_or(label)
        .to_string();
    let _ = app.emit(
        "agent-webview-closed",
        json!({ "agentId": agent_id, "label": label }),
    );
}

fn attach_host_window_close_cleanup(app: &AppHandle, window: &tauri::WebviewWindow, label: &str) {
    let app_for_event = app.clone();
    let label_for_event = label.to_string();
    window.on_window_event(move |event| {
        match event {
            WindowEvent::Destroyed => {
                mark_agent_webview_gone(&app_for_event, &label_for_event);
            }
            WindowEvent::Focused(true) => {
                // 静默窗被站点抢焦点时钉回屏外
                if is_host_window_silent(&app_for_event, &label_for_event) {
                    if let Some(win) = app_for_event.get_webview_window(&label_for_event) {
                        let _ = place_host_window_silent(&win);
                    }
                }
            }
            _ => {}
        }
    });
}

struct AgentSyncState {
    emitted_keys: HashSet<i64>,
    emitted_texts: HashMap<i64, String>,
    stable_tracker: HashMap<i64, (String, Instant)>,
    seeded: bool,
    bridge_baseline: String,
    baseline_user_index: Option<i64>,
    last_emitted_bridge_text: String,
    bridge_stable_tracker: Option<(String, Instant)>,
    last_logged_tool_capture: String,
}

impl AgentSyncState {
    fn new() -> Self {
        Self {
            emitted_keys: HashSet::new(),
            emitted_texts: HashMap::new(),
            stable_tracker: HashMap::new(),
            seeded: false,
            bridge_baseline: String::new(),
            baseline_user_index: None,
            last_emitted_bridge_text: String::new(),
            bridge_stable_tracker: None,
            last_logged_tool_capture: String::new(),
        }
    }

    fn on_send(&mut self, baseline: String, baseline_user_index: Option<i64>) {
        self.bridge_baseline = baseline;
        self.baseline_user_index = baseline_user_index;
        self.bridge_stable_tracker = None;
        self.last_logged_tool_capture.clear();
    }
}

fn is_incomplete_agent_message(text: &str) -> bool {
    let trimmed = text.trim();
    !trimmed.contains("BEGIN_TOOL") && trimmed.len() < 120
}

fn agent_emit_stable_ms(text: &str, base_ms: u64) -> u64 {
    if is_incomplete_agent_message(text) {
        base_ms.saturating_mul(3)
    } else if text.contains("BEGIN_TOOL") {
        base_ms.saturating_add(600)
    } else {
        base_ms
    }
}

fn should_skip_sync_message(sync_state: &AgentSyncState, message: &ChatMessage) -> bool {
    if !sync_state.emitted_keys.contains(&message.key) {
        return false;
    }
    let Some(prev) = sync_state.emitted_texts.get(&message.key) else {
        return true;
    };
    if prev == &message.text {
        return true;
    }
    // 同 index 下 tool 文案变化时再同步
    if message.text.contains("BEGIN_TOOL") && message.text != *prev {
        return false;
    }
    message.text.len() <= prev.len().saturating_add(40)
}

#[derive(Debug, Clone)]
struct ChatMessage {
    key: i64,
    role: String,
    text: String,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct WebviewBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// 与 VS Code 扩展一致：%APPDATA%\agent-editor
fn user_config_root() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata).join("agent-editor");
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        return PathBuf::from(home)
            .join("AppData")
            .join("Roaming")
            .join("agent-editor");
    }
    PathBuf::from("agent-editor")
}

fn copy_if_missing(src: &PathBuf, dest: &PathBuf) {
    if dest.exists() || !src.exists() {
        return;
    }
    if let Some(parent) = dest.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::copy(src, dest);
}

fn seed_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    // 开发：仓库根
    let mut dir = std::env::current_dir().unwrap_or_default();
    for _ in 0..8 {
        if dir.join("config").join("app.config.json").exists()
            || dir.join("scripts").join("bridge-default.js").exists()
        {
            roots.push(dir.clone());
        }
        if !dir.pop() {
            break;
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir);
    }
    roots
}

/// 首次启动：从模板填充用户配置目录
fn ensure_user_config(app: &AppHandle) -> PathBuf {
    let root = user_config_root();
    let _ = fs::create_dir_all(root.join("config"));
    let _ = fs::create_dir_all(root.join("scripts"));

    for seed in seed_roots(app) {
        copy_if_missing(
            &seed.join("config").join("app.config.json"),
            &root.join("config").join("app.config.json"),
        );
        let scripts_src = seed.join("scripts");
        if let Ok(entries) = fs::read_dir(&scripts_src) {
            for entry in entries.flatten() {
                let path = entry.path();
                let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                if !name.ends_with(".js") {
                    continue;
                }
                copy_if_missing(&path, &root.join("scripts").join(name));
            }
        }
    }
    root
}

fn config_search_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    roots.push(ensure_user_config(app));

    // 开发时仓库根（便于 private sync 到工作区后调试）
    let mut dir = std::env::current_dir().unwrap_or_default();
    for _ in 0..8 {
        if dir.join("config").join("app.config.json").exists()
            || dir.join("scripts").join("bridge-default.js").exists()
        {
            roots.push(dir.clone());
        }
        if !dir.pop() {
            break;
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.to_path_buf());
            if let Some(parent) = dir.parent() {
                roots.push(parent.to_path_buf());
            }
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir);
    }

    roots
}

fn resolve_config_path(app: &AppHandle, relative_path: &str) -> Result<PathBuf, String> {
    let mut tried = Vec::new();
    for root in config_search_roots(app) {
        let path = root.join(relative_path);
        if path.exists() {
            return Ok(path);
        }
        tried.push(path.display().to_string());
    }
    Err(format!(
        "Config file not found: {} (tried: {})",
        relative_path,
        tried.join(" | ")
    ))
}

#[tauri::command]
pub fn get_user_config_root(app: AppHandle) -> Result<String, String> {
    Ok(ensure_user_config(&app).display().to_string())
}

#[tauri::command]
pub fn read_config_file(app: AppHandle, relative_path: String) -> Result<String, String> {
    let path = resolve_config_path(&app, &relative_path)?;
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_config_file(
    app: AppHandle,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let path = match resolve_config_path(&app, &relative_path) {
        Ok(p) => p,
        Err(_) => ensure_user_config(&app).join(&relative_path),
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_bridge_script(app: AppHandle, relative_path: String) -> Result<String, String> {
    let path = resolve_config_path(&app, &relative_path)?;
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_bridge_scripts(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let root = ensure_user_config(&app);
    let scripts_dir = root.join("scripts");
    let mut out = Vec::new();
    let entries = fs::read_dir(&scripts_dir).map_err(|e| e.to_string())?;
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.ends_with(".js") {
                Some(name)
            } else {
                None
            }
        })
        .collect();
    names.sort();
    for name in names {
        let relative = format!("scripts/{name}");
        let path = scripts_dir.join(&name);
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        out.push(serde_json::json!({
            "relativePath": relative,
            "content": content,
        }));
    }
    Ok(out)
}

fn agent_data_dir(app: &AppHandle, agent_id: &str) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("agent-webviews")
        .join(agent_id);
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    Ok(base)
}

fn build_injection_script(template_script: &str, bridge_script: &str) -> String {
    format!(
        r#"
(function() {{
  {template}
  {bridge}
}})();
"#,
        template = template_script,
        bridge = bridge_script
    )
}

fn eval_webview_json(
    app: &AppHandle,
    label: &str,
    expr: &str,
) -> Result<String, String> {
    let state = app.state::<WebviewState>();
    let lock = eval_lock_for(&state, label);
    let _guard = lock
        .lock()
        .map_err(|e| format!("eval lock poisoned on {label}: {e}"))?;

    let label = label.to_string();
    let label_for_err = label.clone();
    let expr = expr.to_string();
    let app = app.clone();
    let (result_tx, result_rx) = mpsc::channel::<String>();

    app.clone()
        .run_on_main_thread(move || {
            if let Some(webview) = app.get_webview(&label) {
                let callback_tx = result_tx.clone();
                if webview
                    .eval_with_callback(expr, move |value| {
                        let _ = callback_tx.send(value);
                    })
                    .is_err()
                {
                    let _ = result_tx.send(String::new());
                }
            } else {
                let _ = result_tx.send(String::new());
            }
        })
        .map_err(|e| e.to_string())?;

    result_rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| format!("eval result timeout on webview: {}", label_for_err))
}

async fn async_delay(ms: u64) {
    tokio::time::sleep(Duration::from_millis(ms)).await;
}

fn emit_agent_chat_event(
    app: &AppHandle,
    agent_id: &str,
    role: &str,
    key: i64,
    text: &str,
) -> Result<(), String> {
    let payload = serde_json::json!({
        "agentId": agent_id,
        "role": role,
        "key": key,
        "text": text
    });
    if let Some(window) = app.get_webview_window("main") {
        window
            .emit("agent-chat-message", payload)
            .map_err(|e| e.to_string())
    } else {
        app.emit("agent-chat-message", payload)
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn emit_bridge_comm_log(
    app: AppHandle,
    agent_id: String,
    direction: String,
    content: String,
) -> Result<(), String> {
    emit_bridge_comm_log_inner(&app, &agent_id, &direction, &content);
    Ok(())
}

fn emit_bridge_comm_log_inner(app: &AppHandle, agent_id: &str, direction: &str, content: &str) {
    let payload = serde_json::json!({
        "agentId": agent_id,
        "direction": direction,
        "content": content,
    });
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("bridge-comm-log", payload);
    } else {
        let _ = app.emit("bridge-comm-log", payload);
    }
}

fn flush_bridge_comm_logs(app: &AppHandle, label: &str, agent_id: &str) {
    let raw =
        eval_webview_json(app, label, BRIDGE_DRAIN_COMM_LOGS_EXPR).unwrap_or_else(|_| "[]".to_string());
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };
    let Some(items) = value.as_array() else {
        return;
    };
    for item in items {
        let direction = item
            .get("direction")
            .and_then(|v| v.as_str())
            .unwrap_or("copy");
        let content = item.get("content").and_then(|v| v.as_str()).unwrap_or("");
        if content.is_empty() {
            continue;
        }
        emit_bridge_comm_log_inner(app, agent_id, direction, content);
    }
}

fn flush_bridge_chat_messages(app: &AppHandle, label: &str, agent_id: &str) {
    let raw =
        eval_webview_json(app, label, BRIDGE_DRAIN_CHAT_EXPR).unwrap_or_else(|_| "[]".to_string());
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };
    let Some(items) = value.as_array() else {
        return;
    };
    for item in items {
        let role = item.get("role").and_then(|v| v.as_str()).unwrap_or("user");
        let text = item.get("text").and_then(|v| v.as_str()).unwrap_or("");
        if text.is_empty() {
            continue;
        }
        let key = item.get("key").and_then(|v| v.as_i64()).unwrap_or(-1);
        let _ = emit_agent_chat_event(app, agent_id, role, key, text);
    }
}

fn flush_bridge_pending_reset(app: &AppHandle, label: &str, agent_id: &str) {
    let raw =
        eval_webview_json(app, label, BRIDGE_TAKE_RESET_EXPR).unwrap_or_else(|_| "false".to_string());
    if raw.trim() == "true" {
        reset_bridge_baseline_on_send(app, label, agent_id);
    }
}

fn emit_new_chat_onload_agent_mode(app: &AppHandle, agent_id: &str) {
    let payload = serde_json::json!({ "agentId": agent_id });
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("new-chat-onload-agent-mode", payload);
    } else {
        let _ = app.emit("new-chat-onload-agent-mode", payload);
    }
}

fn flush_bridge_new_chat_onload(app: &AppHandle, label: &str, agent_id: &str) {
    let raw = eval_webview_json(app, label, BRIDGE_TAKE_NEWCHAT_ONLOAD_EXPR)
        .unwrap_or_else(|_| "false".to_string());
    if raw.trim() == "true" {
        emit_new_chat_onload_agent_mode(app, agent_id);
    }
}

fn flush_bridge_queues(app: &AppHandle, label: &str, agent_id: &str) {
    flush_bridge_pending_reset(app, label, agent_id);
    flush_bridge_new_chat_onload(app, label, agent_id);
    flush_bridge_comm_logs(app, label, agent_id);
    flush_bridge_chat_messages(app, label, agent_id);
}

fn log_tool_capture_if_new(app: &AppHandle, agent_id: &str, source: &str, text: &str) {
    if !text.contains("BEGIN_TOOL") {
        return;
    }
    let state = app.state::<WebviewState>();
    let mut sync_states = match state.sync_states.lock() {
        Ok(value) => value,
        Err(_) => return,
    };
    let sync_state = match sync_states.get_mut(agent_id) {
        Some(value) => value,
        None => return,
    };
    if sync_state.last_logged_tool_capture == text {
        return;
    }
    sync_state.last_logged_tool_capture = text.to_string();
    let content = format!(
        "status: captured\nsource: {source}\nlength: {}\ntext:\n{text}",
        text.len()
    );
    emit_bridge_comm_log_inner(app, agent_id, "copy", &content);
}

fn emit_chat_message(app: &AppHandle, agent_id: &str, message: &ChatMessage) {
    if message.role == "agent" && message.text.contains("BEGIN_TOOL") {
        log_tool_capture_if_new(app, agent_id, "conversation", &message.text);
    }
    let _ = emit_agent_chat_event(app, agent_id, &message.role, message.key, &message.text);
}

struct BridgeResponseMeta {
    key: i64,
    text: String,
    loading: bool,
}

struct PollTurn {
    index: i64,
    text: String,
}

struct PollSnapshot {
    loading: bool,
    last_user: Option<PollTurn>,
    last_agent: Option<PollTurn>,
}

fn parse_poll_turn(value: Option<&serde_json::Value>) -> Option<PollTurn> {
    let obj = value?.as_object()?;
    let text = obj
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if text.is_empty() {
        return None;
    }
    let index = obj
        .get("index")
        .and_then(|v| v.as_i64())
        .or_else(|| obj.get("key").and_then(|v| v.as_i64()))
        .unwrap_or(-1);
    Some(PollTurn { index, text })
}

fn parse_poll_snapshot(raw: &str) -> PollSnapshot {
    if raw.is_empty() || raw == "null" || raw == "undefined" {
        return PollSnapshot {
            loading: false,
            last_user: None,
            last_agent: None,
        };
    }
    let Some(value) = parse_json_value_deep(raw) else {
        return PollSnapshot {
            loading: false,
            last_user: None,
            last_agent: None,
        };
    };
    if value.get("error").is_some() {
        return PollSnapshot {
            loading: false,
            last_user: None,
            last_agent: None,
        };
    }
    let loading = value
        .get("loading")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if loading {
        return PollSnapshot {
            loading: true,
            last_user: None,
            last_agent: None,
        };
    }
    let last_user = parse_poll_turn(value.get("lastUser")).or_else(|| parse_poll_turn(value.get("last_user")));
    let last_agent =
        parse_poll_turn(value.get("lastAgent")).or_else(|| parse_poll_turn(value.get("last_agent")));
    PollSnapshot {
        loading: false,
        last_user,
        last_agent,
    }
}

fn snapshot_to_response_meta(snap: &PollSnapshot) -> BridgeResponseMeta {
    if snap.loading {
        return BridgeResponseMeta {
            key: -1,
            text: String::new(),
            loading: true,
        };
    }
    match &snap.last_agent {
        Some(agent) => BridgeResponseMeta {
            key: agent.index,
            text: agent.text.clone(),
            loading: false,
        },
        None => BridgeResponseMeta {
            key: -1,
            text: String::new(),
            loading: false,
        },
    }
}

fn parse_json_value_deep(raw: &str) -> Option<serde_json::Value> {
    let mut current = raw.trim().to_string();
    for _ in 0..5 {
        let value = serde_json::from_str::<serde_json::Value>(&current).ok()?;
        if let serde_json::Value::String(inner) = value {
            let trimmed = inner.trim();
            if trimmed.starts_with('{') || trimmed.starts_with('[') {
                current = trimmed.to_string();
                continue;
            }
            return Some(serde_json::Value::String(inner));
        }
        return Some(value);
    }
    None
}

fn has_new_bridge_text(baseline: &str, text: &str) -> bool {
    if text.is_empty() {
        return false;
    }
    if baseline.is_empty() {
        return true;
    }
    if text == baseline {
        return false;
    }
    if text.contains("BEGIN_TOOL") && !baseline.contains("BEGIN_TOOL") {
        return true;
    }
    text != baseline
}

fn store_and_emit_agent_response(
    app: &AppHandle,
    state: &WebviewState,
    agent_id: &str,
    text: &str,
) -> Result<(), String> {
    if text.contains("BEGIN_TOOL") {
        log_tool_capture_if_new(app, agent_id, "bridge-response", text);
    }
    {
        let mut responses = state.responses.lock().map_err(|e| e.to_string())?;
        responses.insert(agent_id.to_string(), text.to_string());
    }
    {
        let mut cache = state.peek_cache.lock().map_err(|e| e.to_string())?;
        cache.insert(agent_id.to_string(), text.to_string());
    }
    let log_content = format!("text:\n{}", text);
    emit_bridge_comm_log_inner(app, agent_id, "response", &log_content);
    emit_agent_chat_event(app, agent_id, "agent", -1, text)
}

fn seed_sync_from_snapshot(sync_state: &mut AgentSyncState, snap: &PollSnapshot) {
    if snap.loading {
        return;
    }
    if let Some(user) = &snap.last_user {
        sync_state.emitted_keys.insert(user.index);
        sync_state
            .emitted_texts
            .insert(user.index, user.text.clone());
    }
    if let Some(agent) = &snap.last_agent {
        sync_state.emitted_keys.insert(agent.index);
        sync_state
            .emitted_texts
            .insert(agent.index, agent.text.clone());
        sync_state.bridge_baseline = agent.text.clone();
        sync_state.last_emitted_bridge_text = agent.text.clone();
    }
    sync_state.seeded = true;
}

fn messages_from_snapshot(snap: &PollSnapshot) -> Vec<ChatMessage> {
    let mut messages = Vec::new();
    if snap.loading {
        return messages;
    }
    if let Some(user) = &snap.last_user {
        messages.push(ChatMessage {
            key: user.index,
            role: "user".to_string(),
            text: user.text.clone(),
        });
    }
    if let Some(agent) = &snap.last_agent {
        messages.push(ChatMessage {
            key: agent.index,
            role: "agent".to_string(),
            text: agent.text.clone(),
        });
    }
    messages
}

fn emit_snapshot_conversation(
    app: &AppHandle,
    agent_id: &str,
    snap: &PollSnapshot,
    stable_ms: u64,
) {
    let messages = messages_from_snapshot(snap);
    if messages.is_empty() {
        return;
    }

    let mut ready_messages: Vec<ChatMessage> = Vec::new();
    {
        let state = app.state::<WebviewState>();
        let mut sync_states = match state.sync_states.lock() {
            Ok(value) => value,
            Err(_) => return,
        };
        let sync_state = sync_states
            .entry(agent_id.to_string())
            .or_insert_with(AgentSyncState::new);

        if !sync_state.seeded {
            seed_sync_from_snapshot(sync_state, snap);
            return;
        }

        for message in messages {
            if should_skip_sync_message(sync_state, &message) {
                continue;
            }

            let required_stable = if message.role == "agent" {
                agent_emit_stable_ms(&message.text, stable_ms)
            } else {
                stable_ms
            };

            let now = Instant::now();
            match sync_state.stable_tracker.get(&message.key) {
                Some((last_text, since)) if last_text == &message.text => {
                    if now.duration_since(*since) >= Duration::from_millis(required_stable) {
                        sync_state.emitted_keys.insert(message.key);
                        sync_state
                            .emitted_texts
                            .insert(message.key, message.text.clone());
                        sync_state.stable_tracker.remove(&message.key);
                        ready_messages.push(message);
                    }
                }
                _ => {
                    if message.role == "agent" {
                        if let Some((prev_text, _)) = sync_state.stable_tracker.get(&message.key) {
                            if prev_text.contains("BEGIN_TOOL")
                                && !message.text.contains("BEGIN_TOOL")
                            {
                                let already_emitted_tool = sync_state
                                    .emitted_texts
                                    .get(&message.key)
                                    .map(|t| t.contains("BEGIN_TOOL"))
                                    .unwrap_or(false);
                                if !already_emitted_tool {
                                    sync_state.emitted_keys.insert(message.key);
                                    sync_state
                                        .emitted_texts
                                        .insert(message.key, prev_text.clone());
                                    ready_messages.push(ChatMessage {
                                        key: message.key,
                                        role: message.role.clone(),
                                        text: prev_text.clone(),
                                    });
                                }
                            }
                        }
                    }
                    sync_state
                        .stable_tracker
                        .insert(message.key, (message.text.clone(), now));
                }
            }
        }
    }

    for message in ready_messages {
        emit_chat_message(app, agent_id, &message);
    }
}

fn reset_bridge_baseline_on_send(app: &AppHandle, label: &str, agent_id: &str) {
    let snap = eval_webview_json(app, label, POLL_SNAPSHOT_EXPR)
        .ok()
        .map(|raw| parse_poll_snapshot(&raw))
        .unwrap_or(PollSnapshot {
            loading: false,
            last_user: None,
            last_agent: None,
        });
    let baseline = snap
        .last_agent
        .as_ref()
        .map(|a| a.text.clone())
        .unwrap_or_default();
    let baseline_user_index = snap.last_user.as_ref().map(|u| u.index);

    let state = app.state::<WebviewState>();
    let mut sync_states = match state.sync_states.lock() {
        Ok(value) => value,
        Err(_) => return,
    };
    if let Some(sync_state) = sync_states.get_mut(agent_id) {
        sync_state.on_send(baseline, baseline_user_index);
    }
}

fn process_bridge_response_sync(
    app: &AppHandle,
    agent_id: &str,
    snap: &PollSnapshot,
    stable_ms: u64,
    conversation_empty: bool,
) {
    if snap.loading {
        let state = app.state::<WebviewState>();
        if let Ok(mut sync_states) = state.sync_states.lock() {
            if let Some(sync_state) = sync_states.get_mut(agent_id) {
                sync_state.bridge_stable_tracker = None;
            }
        }
        return;
    }

    let meta = snapshot_to_response_meta(snap);
    if meta.text.is_empty() {
        return;
    }

    // 即使会话 DOM 误检，bridge 侧有 BEGIN_TOOL 也同步
    if !conversation_empty && !meta.text.contains("BEGIN_TOOL") {
        return;
    }

    let now = Instant::now();
    let mut ready_text: Option<String> = None;

    {
        let state = app.state::<WebviewState>();
        let mut sync_states = match state.sync_states.lock() {
            Ok(value) => value,
            Err(_) => return,
        };
        let sync_state = sync_states
            .entry(agent_id.to_string())
            .or_insert_with(AgentSyncState::new);

        if meta.text == sync_state.last_emitted_bridge_text {
            return;
        }

        if let Some(baseline_user_index) = sync_state.baseline_user_index {
            if let Some(user) = &snap.last_user {
                if user.index <= baseline_user_index
                    && !has_new_bridge_text(&sync_state.bridge_baseline, &meta.text)
                {
                    sync_state.bridge_stable_tracker = None;
                    return;
                }
            }
        } else if !has_new_bridge_text(&sync_state.bridge_baseline, &meta.text) {
            sync_state.bridge_stable_tracker = None;
            return;
        }

        if meta.key >= 0 {
            sync_state.bridge_baseline = meta.text.clone();
        }

        match sync_state.bridge_stable_tracker.as_ref() {
            Some((last_text, since)) if last_text == &meta.text => {
                let required_stable = if meta.text.contains("BEGIN_TOOL")
                    && !sync_state.last_emitted_bridge_text.contains("BEGIN_TOOL")
                {
                    600
                } else {
                    stable_ms
                };
                if now.duration_since(*since) >= Duration::from_millis(required_stable) {
                    sync_state.last_emitted_bridge_text = meta.text.clone();
                    sync_state.bridge_stable_tracker = None;
                    ready_text = Some(meta.text.clone());
                }
            }
            _ => {
                sync_state.bridge_stable_tracker = Some((meta.text.clone(), now));
            }
        }
    }

    if let Some(text) = ready_text {
        eprintln!("[bridge-sync] emit agent={agent_id} len={}", text.len());
        let state = app.state::<WebviewState>();
        if let Err(err) = store_and_emit_agent_response(app, state.inner(), agent_id, &text) {
            eprintln!("[bridge-sync] emit failed: {err}");
        }
    }
}

fn eval_webview_script(app: &AppHandle, label: &str, script: &str) -> Result<(), String> {
    let label = label.to_string();
    let script = script.to_string();
    let app = app.clone();

    app.clone()
        .run_on_main_thread(move || {
            if let Some(webview) = app.get_webview(&label) {
                let _ = webview.eval(&script);
            }
        })
        .map_err(|e| e.to_string())
}

async fn ensure_bridge_injected(app: &AppHandle, label: &str, _agent_id: &str) {
    let bridge_ready = eval_webview_json(app, label, BRIDGE_CHECK_EXPR)
        .map(|value| value == "true")
        .unwrap_or(false);

    if bridge_ready {
        return;
    }

    let injection = {
        let scripts = app.state::<WebviewState>();
        let guard = scripts.injection_scripts.lock().ok();
        guard.and_then(|map| map.get(label).cloned())
    };

    let Some(script) = injection else {
        return;
    };

    let config_script = r#"
if (window.__agentEditorBridge) {
  window.__agentEditorBridge.onEditorMessage({
    type: 'config',
    pollIntervalMs: 1000,
    stableMs: 2000
  });
}
"#;
    let full = format!("{script}\n{config_script}");
    let _ = eval_webview_script(app, label, &full);
    let _ = eval_webview_json(app, label, BRIDGE_CHECK_EXPR);
}

async fn sync_conversation_task(app: AppHandle, label: String, agent_id: String) {
    let poll_interval_ms = 1000u64;
    let stable_ms = 1500u64;

    ensure_bridge_injected(&app, &label, &agent_id).await;
    if let Ok(raw) = eval_webview_json(&app, &label, POLL_SNAPSHOT_EXPR) {
        let snap = parse_poll_snapshot(&raw);
        if !snap.loading && (snap.last_user.is_some() || snap.last_agent.is_some()) {
            let state = app.state::<WebviewState>();
            let mut sync_states = match state.sync_states.lock() {
                Ok(value) => value,
                Err(_) => return,
            };
            let sync_state = sync_states
                .entry(agent_id.clone())
                .or_insert_with(AgentSyncState::new);
            seed_sync_from_snapshot(sync_state, &snap);
        }
    }

    loop {
        async_delay(poll_interval_ms).await;

        if !agent_webview_alive(&app, &label) {
            let state = app.state::<WebviewState>();
            if let Ok(mut active) = state.active_syncs.lock() {
                active.remove(&label);
            }
            break;
        }

        ensure_bridge_injected(&app, &label, &agent_id).await;
        // 隐藏时也要 drain，否则 @newChatOnload 无法通知 Host
        flush_bridge_queues(&app, &label, &agent_id);

        let state = app.state::<WebviewState>();
        if !is_webview_visible(&state, &label) {
            continue;
        }

        let _ = eval_webview_json(&app, &label, BRIDGE_SCHEDULE_COPY_EXPR);

        let raw = eval_webview_json(&app, &label, POLL_SNAPSHOT_EXPR).unwrap_or_default();
        let snap = parse_poll_snapshot(&raw);
        let conversation_empty = snap.last_user.is_none() && snap.last_agent.is_none();

        emit_snapshot_conversation(&app, &agent_id, &snap, stable_ms);
        process_bridge_response_sync(&app, &agent_id, &snap, stable_ms, conversation_empty);
    }
}

fn start_bridge_response_watch(app: &AppHandle, label: String, agent_id: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let stable_ms = 1200u64;
        let poll_ms = 1000u64;
        for _ in 0..225 {
            async_delay(poll_ms).await;
            if !agent_webview_alive(&app, &label) {
                break;
            }
            let raw = eval_webview_json(&app, &label, POLL_SNAPSHOT_EXPR).unwrap_or_default();
            let snap = parse_poll_snapshot(&raw);
            let conversation_empty = snap.last_user.is_none() && snap.last_agent.is_none();
            let _ = eval_webview_json(&app, &label, BRIDGE_SCHEDULE_COPY_EXPR);
            flush_bridge_queues(&app, &label, &agent_id);
            emit_snapshot_conversation(&app, &agent_id, &snap, stable_ms);
            process_bridge_response_sync(&app, &agent_id, &snap, stable_ms, conversation_empty);
        }
    });
}

fn start_conversation_sync(app: &AppHandle, label: String, agent_id: String) {
    let state = app.state::<WebviewState>();
    let should_start = {
        let mut active = match state.active_syncs.lock() {
            Ok(value) => value,
            Err(_) => return,
        };
        if active.contains(&label) {
            false
        } else {
            active.insert(label.clone());
            true
        }
    };

    if !should_start {
        return;
    }

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        sync_conversation_task(app_clone, label, agent_id).await;
    });
}

static POPUP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[cfg(windows)]
fn configure_webview2_settings(
    platform_webview: &tauri::webview::PlatformWebview,
    enable_devtools: bool,
) {
    unsafe {
        let Ok(core) = platform_webview.controller().CoreWebView2() else {
            return;
        };
        let Ok(settings) = core.Settings() else {
            return;
        };
        let _ = settings.SetAreDefaultContextMenusEnabled(true);
        let _ = settings.SetAreDevToolsEnabled(enable_devtools);
    }
}

/// debug 或 adminMode 时启用 DevTools
pub fn should_enable_devtools() -> bool {
    crate::is_admin_mode() || cfg!(debug_assertions)
}

pub fn apply_webview_devtools(window: &tauri::WebviewWindow, enable: bool) {
    #[cfg(windows)]
    {
        let _ = window.with_webview(move |platform_webview| {
            configure_webview2_settings(&platform_webview, enable);
        });
    }
    let _ = enable;
}

fn open_agent_popup_window(
    app: &AppHandle,
    parent_label: &str,
    url: url::Url,
    features: NewWindowFeatures,
) -> NewWindowResponse<tauri::Wry> {
    let popup_id = POPUP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let popup_label = format!("{}-popup-{}", parent_label, popup_id);
    let app_for_nested = app.clone();
    let parent_for_nested = popup_label.clone();

    #[cfg(windows)]
    let webview_environment = features.opener().environment.clone();

    let mut builder = WebviewWindowBuilder::new(app, &popup_label, WebviewUrl::External(url.clone()))
        .window_features(features)
        .title("登录")
        .inner_size(960.0, 720.0)
        .center()
        .devtools(should_enable_devtools())
        .initialization_script(
            r#"(function(){window.addEventListener('contextmenu',function(e){e.stopImmediatePropagation();},true);})();"#,
        )
        .on_new_window(move |nested_url, nested_features| {
            open_agent_popup_window(&app_for_nested, &parent_for_nested, nested_url, nested_features)
        });

    #[cfg(windows)]
    {
        builder = builder.with_environment(webview_environment);
    }

    match builder.build() {
        Ok(window) => {
            #[cfg(windows)]
            {
                let enable = should_enable_devtools();
                let _ = window.with_webview(move |platform_webview| {
                    configure_webview2_settings(&platform_webview, enable);
                });
            }
            NewWindowResponse::Create { window }
        }
        Err(err) => {
            eprintln!("[agent-webview] popup create failed: {}", err);
            NewWindowResponse::Allow
        }
    }
}

#[tauri::command]
pub async fn create_agent_webview(
    app: AppHandle,
    state: State<'_, WebviewState>,
    label: String,
    url: String,
    agent_id: String,
    bounds: WebviewBounds,
    bridge_script: String,
    template_script: String,
    bridge_config: serde_json::Value,
) -> Result<(), String> {
    {
        let mut webviews = state.webviews.lock().map_err(|e| e.to_string())?;
        if webviews.contains_key(&label) && !agent_webview_alive(&app, &label) {
            webviews.remove(&label);
        }
        if webviews.contains_key(&label) {
            drop(webviews);
            return Ok(());
        }
    }

    let data_dir = agent_data_dir(&app, &agent_id)?;
    let parsed_url: url::Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;

    let injection = build_injection_script(&template_script, &bridge_script);
    let poll_interval = 1000;
    let stable_ms = 2000;

    let init_script = format!(
        r#"
{injection}
(function(){{
  // 允许 WebView 默认右键菜单，阻止页面拦截
  window.addEventListener('contextmenu', function (e) {{
    e.stopImmediatePropagation();
  }}, true);
}})();
(function(cfg){{
  if (!window.__agentEditorBridge) return;
  var msg = {{ type: 'config', pollIntervalMs: {poll_interval}, stableMs: {stable_ms} }};
  if (cfg && typeof cfg === 'object') {{
    if (cfg.selectors) msg.selectors = cfg.selectors;
    if (cfg.inputMode) msg.inputMode = cfg.inputMode;
    if (cfg.typeDelayMs != null) msg.typeDelayMs = cfg.typeDelayMs;
    if (cfg.typeStrategy) msg.typeStrategy = cfg.typeStrategy;
    if (cfg.waitBeforeSend != null) msg.waitBeforeSend = cfg.waitBeforeSend;
    if (cfg.newChatOnload != null) msg.newChatOnload = cfg.newChatOnload;
    if (cfg.readFileLineLimit != null) msg.readFileLineLimit = cfg.readFileLineLimit;
    if (cfg.writeFileLineLimit != null) msg.writeFileLineLimit = cfg.writeFileLineLimit;
  }}
  window.__agentEditorBridge.onEditorMessage(msg);
  window.__agentEditorBridge.onEditorMessage({{ type: 'config', agentId: '{agent_id}' }});
}})({bridge_config});
"#,
        injection = injection,
        bridge_config = bridge_config.to_string(),
        poll_interval = poll_interval,
        stable_ms = stable_ms
    );

    {
        let mut scripts = state.injection_scripts.lock().map_err(|e| e.to_string())?;
        scripts.insert(label.clone(), init_script.clone());
    }

    {
        let mut sync_states = state.sync_states.lock().map_err(|e| e.to_string())?;
        sync_states.insert(agent_id.clone(), AgentSyncState::new());
    }

    let app_for_create = app.clone();
    let label_for_create = label.clone();
    let agent_id_for_title = agent_id.clone();
    let init_for_create = init_script.clone();

    if crate::is_agent_host_mode() {
        // Host：独立窗口，仅显示 Agent 页
        run_on_main_thread_sync(&app, move || {
            let app_for_popup = app_for_create.clone();
            let parent_label = label_for_create.clone();
            let width = if bounds.width > 0.0 { bounds.width } else { 1000.0 };
            let height = if bounds.height > 0.0 { bounds.height } else { 750.0 };
            let builder = WebviewWindowBuilder::new(
                &app_for_create,
                &label_for_create,
                WebviewUrl::External(parsed_url),
            )
            .title(format!("WAB · {}", agent_id_for_title))
            .inner_size(width, height)
            .center()
            .visible(false)
            .devtools(should_enable_devtools())
            .initialization_script(&init_for_create)
            .data_directory(data_dir)
            .on_new_window(move |url, features| {
                open_agent_popup_window(&app_for_popup, &parent_label, url, features)
            });

            let window = builder.build().map_err(|e| e.to_string())?;
            #[cfg(windows)]
            {
                let enable = should_enable_devtools();
                let _ = window.with_webview(move |platform_webview| {
                    configure_webview2_settings(&platform_webview, enable);
                });
            }
            attach_host_window_close_cleanup(&app_for_create, &window, &label_for_create);
            // 屏外显示以保持页面活跃，勿 hide（否则闪一下且脚本被节流）
            place_host_window_silent(&window)?;
            mark_host_window_silent(&app_for_create, &label_for_create, true);
            Ok(())
        })?;
    } else {
        // 桌面编辑器：挂到 main 的子 WebView
        run_on_main_thread_sync(&app, move || {
            let window = app_for_create
                .get_window("main")
                .ok_or_else(|| "Main window not found".to_string())?;

            let app_for_popup = app_for_create.clone();
            let parent_label = label_for_create.clone();
            let builder = tauri::webview::WebviewBuilder::new(
                &label_for_create,
                WebviewUrl::External(parsed_url),
            )
            .initialization_script(&init_for_create)
            .data_directory(data_dir)
            .auto_resize()
            .devtools(should_enable_devtools())
            .on_new_window(move |url, features| {
                open_agent_popup_window(&app_for_popup, &parent_label, url, features)
            });

            let child = window
                .add_child(
                    builder,
                    LogicalPosition::new(bounds.x, bounds.y),
                    LogicalSize::new(bounds.width, bounds.height),
                )
                .map_err(|e| e.to_string())?;

            child
                .set_position(LogicalPosition::new(bounds.x, bounds.y))
                .map_err(|e| e.to_string())?;
            child
                .set_size(LogicalSize::new(bounds.width, bounds.height))
                .map_err(|e| e.to_string())?;
            child.show().map_err(|e| e.to_string())?;

            #[cfg(windows)]
            {
                let enable = should_enable_devtools();
                let _ = child.with_webview(move |platform_webview| {
                    configure_webview2_settings(&platform_webview, enable);
                });
            }
            Ok(())
        })?;
    }

    let mut webviews = state.webviews.lock().map_err(|e| e.to_string())?;
    webviews.insert(label.clone(), true);
    drop(webviews);

    if crate::is_agent_host_mode() {
        start_conversation_sync(&app, label, agent_id);
    }

    Ok(())
}

fn run_on_main_thread_sync<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(10))
        .map_err(|_| "主线程操作超时".to_string())?
}

#[tauri::command]
pub async fn show_agent_webview(
    app: AppHandle,
    label: String,
    bounds: WebviewBounds,
) -> Result<(), String> {
    let app_for_ui = app.clone();
    let label_for_ui = label.clone();
    run_on_main_thread_sync(&app, move || {
        if crate::is_agent_host_mode() {
            let win = match app_for_ui.get_webview_window(&label_for_ui) {
                Some(w) => w,
                None => {
                    mark_agent_webview_gone(&app_for_ui, &label_for_ui);
                    return Err(format!("Webview window not found: {}", label_for_ui));
                }
            };
            let width = if bounds.width > 0.0 { bounds.width } else { 1000.0 };
            let height = if bounds.height > 0.0 { bounds.height } else { 750.0 };
            let _ = win.unminimize();
            win.set_size(LogicalSize::new(width, height))
                .map_err(|e| e.to_string())?;
            let _ = win.center();
            let _ = win.set_skip_taskbar(false);
            win.show().map_err(|e| e.to_string())?;
            let _ = win.set_focus();
            mark_host_window_silent(&app_for_ui, &label_for_ui, false);
        } else {
            let webview = app_for_ui
                .get_webview(&label_for_ui)
                .ok_or_else(|| format!("Webview not found: {}", label_for_ui))?;
            webview
                .set_position(LogicalPosition::new(bounds.x, bounds.y))
                .map_err(|e| e.to_string())?;
            webview
                .set_size(LogicalSize::new(bounds.width, bounds.height))
                .map_err(|e| e.to_string())?;
            webview.show().map_err(|e| e.to_string())?;
        }

        let state = app_for_ui.state::<WebviewState>();
        if let Ok(mut visible) = state.visible_labels.lock() {
            visible.insert(label_for_ui);
        }
        Ok(())
    })?;

    let agent_id = label
        .strip_prefix("agent-")
        .unwrap_or(&label)
        .to_string();
    start_conversation_sync(&app, label, agent_id);
    Ok(())
}

#[tauri::command]
pub async fn hide_agent_webview(app: AppHandle, label: String) -> Result<(), String> {
    let app_for_ui = app.clone();
    let label_for_ui = label.clone();
    run_on_main_thread_sync(&app, move || {
        if crate::is_agent_host_mode() {
            if let Some(win) = app_for_ui.get_webview_window(&label_for_ui) {
                // 勿 hide：屏外静默，保持 WebView2 脚本可跑
                place_host_window_silent(&win)?;
                mark_host_window_silent(&app_for_ui, &label_for_ui, true);
            }
        } else if let Some(webview) = app_for_ui.get_webview(&label_for_ui) {
            webview.hide().map_err(|e| e.to_string())?;
        }

        let state = app_for_ui.state::<WebviewState>();
        if let Ok(mut visible) = state.visible_labels.lock() {
            visible.remove(&label_for_ui);
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn send_agent_message(
    app: AppHandle,
    label: String,
    agent_id: String,
    text: String,
) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview not found: {}", label))?;

    let escaped: String = text
        .chars()
        .map(|c| match c {
            '\\' => "\\\\".to_string(),
            '"' => "\\\"".to_string(),
            '\n' => "\\n".to_string(),
            '\r' => "\\r".to_string(),
            '\t' => "\\t".to_string(),
            c if c.is_control() => format!("\\u{:04x}", c as u32),
            c => c.to_string(),
        })
        .collect();

    let script = format!(
        r#"
if (window.__agentEditorBridge) {{
  window.__agentEditorBridge.onEditorMessage({{
    type: 'send',
    text: "{escaped}",
    agentId: "{agent_id}"
  }});
}}
"#,
        escaped = escaped,
        agent_id = agent_id
    );

    let log_content = format!("type: send\nagentId: {}\ntext:\n{}", agent_id, text);
    emit_bridge_comm_log_inner(&app, &agent_id, "request", &log_content);

    webview.eval(&script).map_err(|e| e.to_string())?;
    reset_bridge_baseline_on_send(&app, &label, &agent_id);
    start_bridge_response_watch(&app, label, agent_id);
    Ok(())
}

#[tauri::command]
pub async fn click_agent_send(app: AppHandle, agent_id: String) -> Result<(), String> {
    let label = format!("agent-{}", agent_id);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview not found: {}", label))?;
    let script = r#"
(function(){
  try {
    if (!window.__agentEditorBridge) return;
    var fn = window.__agentEditorBridge.clickSendWithRetry || window.__agentEditorBridge.clickSend;
    if (typeof fn === 'function') Promise.resolve(fn.call(window.__agentEditorBridge));
  } catch (e) {}
})();
"#;
    webview.eval(script).map_err(|e| e.to_string())?;
    reset_bridge_baseline_on_send(&app, &label, &agent_id);
    start_bridge_response_watch(&app, label, agent_id);
    Ok(())
}

#[tauri::command]
pub async fn push_agent_bridge_config(
    app: AppHandle,
    agent_id: String,
    input_mode: Option<String>,
    type_strategy: Option<String>,
    wait_before_send: Option<i64>,
) -> Result<(), String> {
    let label = format!("agent-{}", agent_id);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview not found: {}", label))?;
    let input_mode_js = match input_mode.as_deref() {
        Some("type") | Some("fill") => format!(r#", inputMode: "{}""#, input_mode.as_ref().unwrap()),
        _ => String::new(),
    };
    let type_strategy_js = match type_strategy.as_deref() {
        Some("keyboard") | Some("exec") | Some("paste") => {
            format!(r#", typeStrategy: "{}""#, type_strategy.as_ref().unwrap())
        }
        _ => String::new(),
    };
    let wait_js = match wait_before_send {
        Some(n) if n >= 0 => format!(", waitBeforeSend: {}", n),
        _ => String::new(),
    };
    let script = format!(
        r#"
if (window.__agentEditorBridge) {{
  window.__agentEditorBridge.onEditorMessage({{
    type: 'config',
    agentId: '{agent_id}'{input_mode_js}{type_strategy_js}{wait_js}
  }});
}}
"#,
        agent_id = agent_id,
        input_mode_js = input_mode_js,
        type_strategy_js = type_strategy_js,
        wait_js = wait_js
    );
    webview.eval(&script).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn fill_agent_message(
    app: AppHandle,
    label: String,
    agent_id: String,
    text: String,
) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview not found: {}", label))?;

    let escaped: String = text
        .chars()
        .map(|c| match c {
            '\\' => "\\\\".to_string(),
            '"' => "\\\"".to_string(),
            '\n' => "\\n".to_string(),
            '\r' => "\\r".to_string(),
            '\t' => "\\t".to_string(),
            c if c.is_control() => format!("\\u{:04x}", c as u32),
            c => c.to_string(),
        })
        .collect();

    let script = format!(
        r#"
if (window.__agentEditorBridge) {{
  window.__agentEditorBridge.onEditorMessage({{
    type: 'fill',
    text: "{escaped}",
    agentId: "{agent_id}"
  }});
}}
"#,
        escaped = escaped,
        agent_id = agent_id
    );

    let log_content = format!("type: fill\nagentId: {}\ntext:\n{}", agent_id, text);
    emit_bridge_comm_log_inner(&app, &agent_id, "request", &log_content);

    webview.eval(&script).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn emit_agent_chat_message(
    app: AppHandle,
    agent_id: String,
    role: String,
    key: i64,
    text: String,
) -> Result<(), String> {
    emit_agent_chat_event(&app, &agent_id, &role, key, &text)
}

#[tauri::command]
pub async fn reset_agent_bridge_tracking(
    app: AppHandle,
    agent_id: String,
) -> Result<(), String> {
    let label = format!("agent-{}", agent_id);
    reset_bridge_baseline_on_send(&app, &label, &agent_id);
    Ok(())
}

#[tauri::command]
pub async fn agent_composer_ready(app: AppHandle, agent_id: String) -> Result<bool, String> {
    let label = format!("agent-{}", agent_id);
    Ok(debug_eval_composer_ready(&app, &label))
}

pub fn debug_eval_composer_ready(app: &AppHandle, label: &str) -> bool {
    let raw =
        eval_webview_json(app, label, BRIDGE_COMPOSER_READY_EXPR).unwrap_or_else(|_| "false".to_string());
    raw.trim() == "true"
}

#[tauri::command]
pub async fn new_agent_chat_session(app: AppHandle, agent_id: String) -> Result<(), String> {
    let label = format!("agent-{}", agent_id);
    let start_raw = eval_webview_json(&app, &label, BRIDGE_START_NEW_CHAT_EXPR)?;
    // WebView2 回传可能多层 JSON 字符串，需 deep parse
    let start = parse_json_value_deep(&start_raw).unwrap_or_else(|| json!({ "ok": false }));
    if start.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let err = start
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("failed to start newChatSession");
        return Err(err.to_string());
    }

    // 最长约 90s，等待站点打开新会话
    for _ in 0..450 {
        async_delay(200).await;
        let poll_raw =
            eval_webview_json(&app, &label, BRIDGE_POLL_NEW_CHAT_EXPR).unwrap_or_default();
        let poll =
            parse_json_value_deep(&poll_raw).unwrap_or_else(|| json!({ "status": "running" }));
        let status = poll.get("status").and_then(|v| v.as_str()).unwrap_or("running");
        if status == "running" {
            continue;
        }
        if status == "idle" {
            return Err("newChatSession status lost".into());
        }
        if poll.get("ok").and_then(|v| v.as_bool()) == Some(true) {
            reset_bridge_baseline_on_send(&app, &label, &agent_id);
            return Ok(());
        }
        let err = poll
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("newChatSession failed");
        return Err(err.to_string());
    }
    Err("newChatSession timeout".into())
}

#[tauri::command]
pub async fn store_agent_response(
    app: AppHandle,
    state: State<'_, WebviewState>,
    agent_id: String,
    text: String,
) -> Result<(), String> {
    store_and_emit_agent_response(&app, &state, &agent_id, &text)
}

#[tauri::command]
pub async fn agent_bridge_is_loading(app: AppHandle, agent_id: String) -> Result<bool, String> {
    let label = format!("agent-{}", agent_id);
    let raw = eval_webview_json(&app, &label, BRIDGE_IS_LOADING_EXPR).unwrap_or_else(|_| "false".to_string());
    Ok(raw.trim() == "true")
}

#[tauri::command]
pub async fn peek_agent_response(
    state: State<'_, WebviewState>,
    agent_id: String,
    text: String,
    response_key: Option<i64>,
) -> Result<(), String> {
    {
        let mut cache = state.peek_cache.lock().map_err(|e| e.to_string())?;
        cache.insert(agent_id.clone(), text);
    }
    if let Some(key) = response_key {
        let mut key_cache = state.peek_key_cache.lock().map_err(|e| e.to_string())?;
        key_cache.insert(agent_id, key);
    }
    Ok(())
}

#[tauri::command]
pub async fn poll_agent_response(
    state: State<'_, WebviewState>,
    agent_id: String,
) -> Result<Option<String>, String> {
    let mut responses = state.responses.lock().map_err(|e| e.to_string())?;
    Ok(responses.remove(&agent_id))
}

pub fn debug_query_agent(app: &AppHandle, agent_id: &str) -> Result<serde_json::Value, String> {
    let label = format!("agent-{}", agent_id);
    let webview_exists = app.get_webview(&label).is_some();

    let state = app.state::<WebviewState>();
    let webviews_registered = state
        .webviews
        .lock()
        .map_err(|e| e.to_string())?
        .contains_key(&label);
    let sync_active = state
        .active_syncs
        .lock()
        .map_err(|e| e.to_string())?
        .contains(&label);
    let sync_info = {
        let sync_states = state.sync_states.lock().map_err(|e| e.to_string())?;
        if let Some(sync_state) = sync_states.get(agent_id) {
            serde_json::json!({
                "seeded": sync_state.seeded,
                "emittedKeyCount": sync_state.emitted_keys.len(),
                "pendingKeyCount": sync_state.stable_tracker.len(),
                "bridgeBaselineLen": sync_state.bridge_baseline.len(),
                "lastEmittedBridgeLen": sync_state.last_emitted_bridge_text.len(),
                "bridgeStablePending": sync_state.bridge_stable_tracker.is_some(),
            })
        } else {
            serde_json::json!({
                "seeded": false,
                "emittedKeyCount": 0,
                "pendingKeyCount": 0,
                "bridgeBaselineLen": 0,
                "lastEmittedBridgeLen": 0,
                "bridgeStablePending": false,
            })
        }
    };

    if !webview_exists {
        return Ok(serde_json::json!({
            "ok": false,
            "agentId": agent_id,
            "label": label,
            "webviewExists": false,
            "webviewsRegistered": webviews_registered,
            "syncActive": sync_active,
            "sync": sync_info,
            "error": "webview not found",
        }));
    }

    let bridge_raw = eval_webview_json(app, &label, BRIDGE_CHECK_EXPR)
        .unwrap_or_else(|err| format!("\"{err}\""));
    let snapshot_raw = eval_webview_json(app, &label, POLL_SNAPSHOT_EXPR).unwrap_or_default();
    let snap = parse_poll_snapshot(&snapshot_raw);
    let messages = messages_from_snapshot(&snap);
    let dom_raw = eval_webview_json(app, &label, DEBUG_DOM_EXPR).unwrap_or_default();
    let inspect_raw = eval_webview_json(app, &label, AGENT_INSPECT_EXPR).unwrap_or_default();
    let dom_value = parse_json_value_deep(&dom_raw).unwrap_or(serde_json::Value::Null);
    let inspect_value = parse_json_value_deep(&inspect_raw).unwrap_or(serde_json::Value::Null);
    let virtual_item_count = dom_value
        .get("virtualItemCount")
        .and_then(|value| value.as_i64())
        .unwrap_or(0);

    Ok(serde_json::json!({
        "ok": true,
        "agentId": agent_id,
        "label": label,
        "webviewExists": webview_exists,
        "webviewsRegistered": webviews_registered,
        "syncActive": sync_active,
        "bridgeReady": bridge_raw == "true",
        "bridgeRaw": bridge_raw,
        "virtualItemCount": virtual_item_count,
        "conversation": messages.iter().map(|message| serde_json::json!({
            "key": message.key,
            "role": message.role,
            "text": message.text,
        })).collect::<Vec<_>>(),
        "snapshotRaw": snapshot_raw,
        "snapshot": {
            "loading": snap.loading,
            "lastUser": snap.last_user.as_ref().map(|u| serde_json::json!({
                "index": u.index,
                "text": u.text,
            })),
            "lastAgent": snap.last_agent.as_ref().map(|a| serde_json::json!({
                "index": a.index,
                "text": a.text,
            })),
        },
        "dom": dom_value,
        "inspect": inspect_value,
        "sync": sync_info,
    }))
}

pub fn debug_reset_sync(app: &AppHandle, agent_id: &str) -> Result<(), String> {
    let state = app.state::<WebviewState>();
    let mut sync_states = state.sync_states.lock().map_err(|e| e.to_string())?;
    sync_states.remove(agent_id);
    Ok(())
}

const LAST_FILE_OP_EXPR: &str = "JSON.stringify(window.__agentEditorLastFileOp||null)";

pub fn debug_query_bridge_response(app: &AppHandle, agent_id: &str) -> Result<serde_json::Value, String> {
    let label = format!("agent-{}", agent_id);
    let raw = eval_webview_json(app, &label, POLL_SNAPSHOT_EXPR).unwrap_or_default();
    let snap = parse_poll_snapshot(&raw);
    let parsed = snapshot_to_response_meta(&snap);
    let copy_raw = eval_webview_json(app, &label, BRIDGE_COPY_DEBUG_EXPR).unwrap_or_default();
    let copy_debug = serde_json::from_str::<serde_json::Value>(&copy_raw)
        .unwrap_or(serde_json::Value::String(copy_raw));
    Ok(serde_json::json!({
        "ok": true,
        "agentId": agent_id,
        "raw": raw,
        "meta": {
            "key": parsed.key,
            "text": parsed.text,
            "loading": parsed.loading,
        },
        "snapshot": {
            "loading": snap.loading,
            "lastUser": snap.last_user.as_ref().map(|u| serde_json::json!({
                "index": u.index,
                "text": u.text,
            })),
            "lastAgent": snap.last_agent.as_ref().map(|a| serde_json::json!({
                "index": a.index,
                "text": a.text,
            })),
        },
        "copy": copy_debug,
    }))
}

pub fn debug_query_last_file_op(app: &AppHandle) -> Result<serde_json::Value, String> {
    let raw = eval_webview_json(app, "main", LAST_FILE_OP_EXPR).unwrap_or_default();
    if raw.is_empty() || raw == "null" || raw == "undefined" {
        return Ok(serde_json::json!({ "ok": true, "lastFileOp": serde_json::Value::Null }));
    }
    let last_file_op = serde_json::from_str::<serde_json::Value>(&raw)
        .unwrap_or(serde_json::Value::String(raw));
    Ok(serde_json::json!({
        "ok": true,
        "lastFileOp": last_file_op,
    }))
}
