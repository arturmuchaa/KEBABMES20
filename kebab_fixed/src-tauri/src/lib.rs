#[cfg(not(feature = "kiosk"))]
use tauri_plugin_updater::UpdaterExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init());

    // Updater tylko w pełnej aplikacji — kiosk rozbioru jest instalacją jednorazową
    // (bez auto-update, żeby nie „przeszedł" w pełną aplikację).
    #[cfg(not(feature = "kiosk"))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .on_window_event(|_window, _event| {
            // Kiosk: operator nie może zamknąć okna (Alt+F4 / żądania zamknięcia ignorowane).
            #[cfg(feature = "kiosk")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
                api.prevent_close();
            }
        })
        .setup(|_app| {
            #[cfg(not(feature = "kiosk"))]
            {
                let handle = _app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = check_for_updates(handle.clone()).await {
                        eprintln!("Update check failed: {e}");
                        let _ = tauri_plugin_dialog::DialogExt::dialog(&handle)
                            .message(format!(
                                "Aktualizacja nie powiodła się:\n\n{e}\n\nMożesz pobrać najnowszą wersję ręcznie:\nhttp://204.168.166.34:8080/api/desktop-updates/latest-installer"
                            ))
                            .title("Błąd aktualizacji")
                            .blocking_show();
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(not(feature = "kiosk"))]
async fn check_for_updates(app: tauri::AppHandle) -> tauri_plugin_updater::Result<()> {
    if let Some(update) = app.updater()?.check().await? {
        let version = update.version.clone();
        let body = update.body.clone().unwrap_or_default();

        let yes = tauri_plugin_dialog::DialogExt::dialog(&app)
            .message(format!(
                "Dostępna nowa wersja: {version}\n\n{body}\n\nCzy zainstalować teraz?"
            ))
            .title("Aktualizacja Kebab MES")
            .blocking_show();

        if yes {
            update.download_and_install(|_, _| {}, || {}).await?;
            app.restart();
        }
    }
    Ok(())
}
