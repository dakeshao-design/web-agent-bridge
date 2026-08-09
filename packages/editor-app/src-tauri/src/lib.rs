#[cfg(debug_assertions)]
mod debug_server;
mod host_server;
mod shell;
mod webview_bridge;

use tauri::Manager;

#[cfg(debug_assertions)]
use debug_server::start_debug_server;
use host_server::start_host_server;
use shell::{
    kill_all_powershell, kill_powershell, poll_powershell, remove_powershell, run_powershell,
    start_powershell, PowershellState,
};
use webview_bridge::{
    agent_bridge_is_loading, create_agent_webview, emit_agent_chat_message, emit_bridge_comm_log,
    fill_agent_message, get_user_config_root, hide_agent_webview, peek_agent_response,
    poll_agent_response, read_bridge_script, read_config_file, reset_agent_bridge_tracking,
    send_agent_message, show_agent_webview, store_agent_response, write_config_file, WebviewState,
};

pub fn is_agent_host_mode() -> bool {
    std::env::var("AGENT_HOST")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
        || std::env::args().any(|a| a == "--agent-host")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let agent_host = is_agent_host_mode();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(WebviewState::default())
        .manage(PowershellState::default())
        .invoke_handler(tauri::generate_handler![
            get_user_config_root,
            read_config_file,
            write_config_file,
            read_bridge_script,
            run_powershell,
            start_powershell,
            poll_powershell,
            kill_powershell,
            remove_powershell,
            kill_all_powershell,
            create_agent_webview,
            show_agent_webview,
            hide_agent_webview,
            send_agent_message,
            fill_agent_message,
            emit_agent_chat_message,
            emit_bridge_comm_log,
            reset_agent_bridge_tracking,
            store_agent_response,
            peek_agent_response,
            poll_agent_response,
            agent_bridge_is_loading,
        ])
        .setup(move |app| {
            let _ = get_user_config_root(app.handle().clone());
            let window = app.get_webview_window("main").expect("main window");
            if agent_host {
                window.set_title("WABEditor Host").ok();
                let _ = window.hide();
                start_host_server(app.handle().clone());
            } else {
                window.set_title("WABEditor").ok();
                #[cfg(debug_assertions)]
                start_debug_server(app.handle().clone());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
