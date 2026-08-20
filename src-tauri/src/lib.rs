// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn is_mouse_down() -> bool {
    #[cfg(windows)]
    unsafe {
        #[link(name = "user32")]
        extern "system" {
            fn GetAsyncKeyState(vKey: i32) -> i16;
        }
        (GetAsyncKeyState(0x01) as u16 & 0x8000) != 0
    }
    #[cfg(not(windows))]
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, is_mouse_down])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
