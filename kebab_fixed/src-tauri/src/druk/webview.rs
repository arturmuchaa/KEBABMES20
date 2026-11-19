//! Bieżąca strona → PDF przez WebView2 (DevTools `Page.printToPDF`): honoruje
//! `@page` dokumentu (kartki palet mają własny format), tło, zero marginesów.

use tokio::sync::oneshot;
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2;
use windows::core::PCWSTR;

const PARAMETRY: &str = r#"{"printBackground":true,"preferCSSPageSize":true,"marginTop":0,"marginBottom":0,"marginLeft":0,"marginRight":0,"scale":1,"displayHeaderFooter":false}"#;

/// Wywołać na wątku webview (w `with_webview`); wynik (PDF base64) przychodzi kanałem.
pub fn zamow_pdf(core: &ICoreWebView2, tx: oneshot::Sender<Result<String, String>>) {
    let tx = std::sync::Mutex::new(Some(tx));
    let wyslij = move |r: Result<String, String>| { if let Some(t) = tx.lock().ok().and_then(|mut g| g.take()) { let _ = t.send(r); } };
    let wyslij = std::sync::Arc::new(wyslij);
    let w2 = wyslij.clone();
    let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |wynik, json: String| {
        let r = wynik.map_err(|e| e.message().to_string()).and_then(|_| {
            serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())?
                .get("data").and_then(|d| d.as_str()).map(str::to_string)
                .ok_or_else(|| "WebView2 nie zwrócił PDF".to_string())
        });
        w2(r);
        Ok(())
    }));
    let metoda = super::win::w("Page.printToPDF");
    let par = super::win::w(PARAMETRY);
    if let Err(e) = unsafe { core.CallDevToolsProtocolMethod(PCWSTR(metoda.as_ptr()), PCWSTR(par.as_ptr()), &handler) } {
        wyslij(Err(format!("Nie można zamienić strony na PDF: {}", e.message())));
    }
}
