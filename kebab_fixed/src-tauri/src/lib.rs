use tauri_plugin_updater::UpdaterExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = check_for_updates(handle).await {
                    eprintln!("Update check failed: {e}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

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
