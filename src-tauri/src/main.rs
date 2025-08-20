#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
	let builder = uni_schedule_lib::schedule::tauri_api::register(builder);
	builder
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}

fn main() {
	run()
}
