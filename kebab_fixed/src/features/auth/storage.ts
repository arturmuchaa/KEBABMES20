const TOKEN_KEY = 'kebab.token'
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY) || '',
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}
export const KIOSK_DEPT_KEY = 'kebab.kiosk.department'
