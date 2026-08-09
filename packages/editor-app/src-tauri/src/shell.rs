use serde::Serialize;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowershellResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowershellPollResult {
    output: String,
    exited: bool,
    exit_code: Option<i32>,
    killed: bool,
}

struct SessionInner {
    pid: u32,
    output: Arc<Mutex<String>>,
    exit_code: Arc<Mutex<Option<i32>>>,
    killed: Arc<Mutex<bool>>,
    done: Arc<Mutex<bool>>,
}

#[derive(Default)]
pub struct PowershellState {
    sessions: Mutex<HashMap<String, SessionInner>>,
}

fn make_id() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut h = std::collections::hash_map::DefaultHasher::new();
    std::thread::current().id().hash(&mut h);
    ms.hash(&mut h);
    format!("{ms}-{:x}", h.finish())
}

fn start_powershell_inner(
    command: String,
    cwd: Option<String>,
    state: &PowershellState,
) -> Result<String, String> {
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &command])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd.filter(|s| !s.trim().is_empty()) {
        cmd.current_dir(dir);
    }

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let output = Arc::new(Mutex::new(String::new()));
    let exit_code = Arc::new(Mutex::new(None));
    let killed = Arc::new(Mutex::new(false));
    let done = Arc::new(Mutex::new(false));

    let output_c = Arc::clone(&output);
    let exit_code_c = Arc::clone(&exit_code);
    let done_c = Arc::clone(&done);

    thread::spawn(move || {
        let out_handle = stdout.map(|out| {
            let output_c = Arc::clone(&output_c);
            thread::spawn(move || {
                let mut reader = BufReader::new(out);
                let mut buf = String::new();
                loop {
                    buf.clear();
                    match reader.read_line(&mut buf) {
                        Ok(0) => break,
                        Ok(_) => {
                            if let Ok(mut o) = output_c.lock() {
                                o.push_str(&buf);
                            }
                        }
                        Err(_) => break,
                    }
                }
            })
        });
        let err_handle = stderr.map(|err| {
            let output_c = Arc::clone(&output_c);
            thread::spawn(move || {
                let mut reader = BufReader::new(err);
                let mut buf = String::new();
                loop {
                    buf.clear();
                    match reader.read_line(&mut buf) {
                        Ok(0) => break,
                        Ok(_) => {
                            if let Ok(mut o) = output_c.lock() {
                                o.push_str(&buf);
                            }
                        }
                        Err(_) => break,
                    }
                }
            })
        });

        let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
        if let Some(h) = out_handle {
            let _ = h.join();
        }
        if let Some(h) = err_handle {
            let _ = h.join();
        }
        if let Ok(mut ec) = exit_code_c.lock() {
            *ec = Some(code);
        }
        if let Ok(mut d) = done_c.lock() {
            *d = true;
        }
    });

    let id = make_id();
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    sessions.insert(
        id.clone(),
        SessionInner {
            pid,
            output,
            exit_code,
            killed,
            done,
        },
    );
    Ok(id)
}

fn poll_powershell_inner(id: &str, state: &PowershellState) -> Result<PowershellPollResult, String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let s = sessions
        .get(id)
        .ok_or_else(|| format!("session not found: {id}"))?;
    let output = s.output.lock().map_err(|e| e.to_string())?.clone();
    let exit_code = *s.exit_code.lock().map_err(|e| e.to_string())?;
    let killed = *s.killed.lock().map_err(|e| e.to_string())?;
    let done = *s.done.lock().map_err(|e| e.to_string())?;
    Ok(PowershellPollResult {
        output,
        exited: done,
        exit_code,
        killed,
    })
}

fn kill_session_by_id(id: &str, state: &PowershellState, mark_killed: bool) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let Some(s) = sessions.get(id) else {
        return Ok(());
    };
    if mark_killed {
        if let Ok(mut k) = s.killed.lock() {
            *k = true;
        }
    }
    let done = *s.done.lock().map_err(|e| e.to_string())?;
    if done {
        return Ok(());
    }
    let pid = s.pid;
    drop(sessions);
    let _ = Command::new("taskkill")
        .args(["/pid", &pid.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    Ok(())
}

fn remove_session(id: &str, state: &PowershellState) {
    if let Ok(mut sessions) = state.sessions.lock() {
        sessions.remove(id);
    }
}

/// 兼容：等待完成并一次性返回
#[tauri::command]
pub async fn run_powershell(
    command: String,
    cwd: Option<String>,
    state: State<'_, PowershellState>,
) -> Result<PowershellResult, String> {
    let id = start_powershell_inner(command, cwd, &state)?;
    loop {
        let poll = poll_powershell_inner(&id, &state)?;
        if poll.exited {
            remove_session(&id, &state);
            return Ok(PowershellResult {
                stdout: poll.output,
                stderr: String::new(),
                exit_code: poll.exit_code.unwrap_or(-1),
            });
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}

#[tauri::command]
pub fn start_powershell(
    command: String,
    cwd: Option<String>,
    state: State<'_, PowershellState>,
) -> Result<String, String> {
    start_powershell_inner(command, cwd, &state)
}

#[tauri::command]
pub fn poll_powershell(
    id: String,
    state: State<'_, PowershellState>,
) -> Result<PowershellPollResult, String> {
    poll_powershell_inner(&id, &state)
}

#[tauri::command]
pub fn kill_powershell(id: String, state: State<'_, PowershellState>) -> Result<(), String> {
    kill_session_by_id(&id, &state, true)
}

#[tauri::command]
pub fn remove_powershell(id: String, state: State<'_, PowershellState>) -> Result<(), String> {
    remove_session(&id, &state);
    Ok(())
}

#[tauri::command]
pub fn kill_all_powershell(state: State<'_, PowershellState>) -> Result<u32, String> {
    let ids: Vec<String> = {
        let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        sessions
            .iter()
            .filter(|(_, s)| {
                !*s.done
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
            })
            .map(|(id, _)| id.clone())
            .collect()
    };
    let mut n = 0u32;
    for id in &ids {
        kill_session_by_id(id, &state, true)?;
        n += 1;
    }
    Ok(n)
}
