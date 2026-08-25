use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Listener, Manager, PhysicalPosition,
};

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

/*
Window position persistence (Option B):
The frontend saves the widget position after every settle point (drag end,
startup clamp, resizes). On the next launch the saved position is applied
here in `setup` while the window is STILL HIDDEN, so the widget reappears
exactly where the user left it — with no visible movement.
*/
#[derive(serde::Serialize, serde::Deserialize)]
struct WindowPosition {
    x: i32,
    y: i32,
}

fn window_state_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("window-state.json"))
}

fn read_window_position_from_disk(app: &tauri::AppHandle) -> Option<WindowPosition> {
    let path = window_state_path(app).ok()?;
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

#[tauri::command]
fn load_window_position(app: tauri::AppHandle) -> Option<WindowPosition> {
    read_window_position_from_disk(&app)
}

#[tauri::command]
fn save_window_position(app: tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json =
        serde_json::to_string(&WindowPosition { x, y }).map_err(|e| e.to_string())?;
    fs::write(window_state_path(&app)?, json).map_err(|e| e.to_string())
}

fn toggle_tray_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            let _ = app.emit("tray://hidden", ());
        } else {
            let _ = window.show();
            let _ = window.set_focus();
            let _ = app.emit("tray://shown", ());
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            is_mouse_down,
            save_window_position,
            load_window_position
        ])
        .setup(|app| {
            /*
            Restore the last window position BEFORE anything is on screen.
            The window is configured "visible": false, so this move happens
            entirely off-screen; the frontend reveals the window once the
            UI is fully prepared.
            */
            let window = app.get_webview_window("main");

            if let Some(ref webview_window) = window {
                if let Some(saved) = read_window_position_from_disk(app.handle()) {
                    let _ = webview_window.set_position(PhysicalPosition::new(saved.x, saved.y));
                }
            }

            /*
            Startup watchdog:
            If the webview/frontend ever fails to boot, the window would stay
            hidden forever. The frontend emits "widget://ready" right after it
            reveals itself; if that hasn't happened within 3 seconds, force-show
            the window so the app can never end up permanently invisible.
            */
            let ready = Arc::new(AtomicBool::new(false));

            let ready_flag = Arc::clone(&ready);
            app.listen("widget://ready", move |_| {
                ready_flag.store(true, Ordering::SeqCst);
            });

            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(3));
                if !ready.load(Ordering::SeqCst) {
                    if let Some(webview_window) = window {
                        let _ = webview_window.show();
                    }
                }
            });

            // System tray (quick-access area): show/hide the widget, open settings or quit.
            // Essential for eye-off (water-tracker-only) mode where the app hides from the desktop.
            let toggle = MenuItem::with_id(app, "toggle", "Show / Hide", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &settings_item, &quit])?;

            let mut tray = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("BlinkEye")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle" => toggle_tray_window(app),
                    "settings" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = app.emit("tray://settings", ());
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_tray_window(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }

            tray.build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
