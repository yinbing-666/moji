#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|argument| argument == "--mcp") {
        xiaohei_daily_lib::mcp::run_stdio();
    } else {
        xiaohei_daily_lib::run()
    }
}
