use tauri_plugin_updater::UpdaterExt;

// Moduł wagi tylko dla kiosku (i testów) — build biurowy nie kompiluje
// ścieżek dotykających portów szeregowych.
#[cfg(any(feature = "kiosk", test))]
mod scale;

// Kod serwisowy kiosku (0099 na numpadzie wagi, wpisany szybko) wywołuje to
// z JS — wylogowuje operatora z Windows (wraca do ekranu logowania Windows),
// żeby technik mógł zalogować się na konto Administrator ze zwykłym
// explorer.exe. Konto operatora ma powłokę = ten kiosk (per-user Shell w
// rejestrze), więc bez tego jedyną drogą powrotu do pulpitu byłby fizyczny
// dostęp do klawiatury/BIOS-u.
#[tauri::command]
fn windows_logoff() {
    let _ = std::process::Command::new("shutdown").args(["/l"]).spawn();
}

// Diagnostyka wagi dla menu serwisowego (0099) — pokazuje jaki port HMI
// otwiera i czy plik scale.json jest czytany. Poza kioskiem waga nie istnieje.
#[tauri::command]
fn scale_diagnose(_app: tauri::AppHandle) -> String {
    #[cfg(feature = "kiosk")]
    {
        scale::diagnose(&_app)
    }
    #[cfg(not(feature = "kiosk"))]
    {
        "Waga dostępna tylko w kiosku.".into()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![windows_logoff, scale_diagnose])
        .on_window_event(|_window, _event| {
            // Kiosk: operator nie może zamknąć okna (Alt+F4 / żądania zamknięcia ignorowane).
            #[cfg(feature = "kiosk")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
                api.prevent_close();
            }
        })
        .setup(|_app| {
            #[cfg(feature = "kiosk")]
            {
                // Most wagowy RS232 (HMI rozbiór v10): wątek czyta wagę
                // najazdową i emituje `scale://weight`. Tylko kiosk — appka
                // biurowa nie ma prawa dotykać portów szeregowych.
                scale::spawn_reader(_app.handle().clone());

                // Kiosk: cichy auto-update w tle, BEZ dialogu — nikt nie ma dostępu
                // do Windowsa żeby kliknąć "zainstaluj". Sprawdzenie od razu przy
                // starcie, potem co godzinę; jeśli jest nowsza wersja, pobiera,
                // instaluje i restartuje aplikację samodzielnie. Endpoint jest
                // per-build (config kiosku wskazuje własny manifest, np.
                // .../rozbior-v10/latest.json) — nigdy nie ściągnie pełnej appki.
                let handle = _app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        if let Err(e) = silent_auto_update(handle.clone()).await {
                            eprintln!("Kiosk silent update check failed: {e}");
                        }
                        tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
                    }
                });
            }
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

#[cfg(feature = "kiosk")]
async fn silent_auto_update(app: tauri::AppHandle) -> tauri_plugin_updater::Result<()> {
    if let Some(update) = app.updater()?.check().await? {
        update.download_and_install(|_, _| {}, || {}).await?;
        app.restart();
    }
    Ok(())
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
