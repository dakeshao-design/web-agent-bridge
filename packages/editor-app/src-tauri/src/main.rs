// 正式版不显示控制台
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    wab_editor_lib::run();
}
