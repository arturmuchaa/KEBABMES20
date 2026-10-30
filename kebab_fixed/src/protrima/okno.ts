/** Przyciski okna: w Tauri sterują oknem bez ramki, w przeglądarce są ukryte (okno należy do przeglądarki). */
export const jestTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export async function okno(akcja: 'minimize' | 'toggleMaximize' | 'close') {
  if (!jestTauri()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const w = getCurrentWindow()
  if (akcja === 'minimize') await w.minimize()
  else if (akcja === 'toggleMaximize') await w.toggleMaximize()
  else await w.close()
}
