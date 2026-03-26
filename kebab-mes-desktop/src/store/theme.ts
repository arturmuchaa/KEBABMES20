const KEY = 'mes_theme'

export type Theme = 'dark' | 'light'

export function getTheme(): Theme {
  return (localStorage.getItem(KEY) as Theme) || 'dark'
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme)
  applyTheme(theme)
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'light') {
    root.classList.remove('dark')
    root.classList.add('light')
  } else {
    root.classList.remove('light')
    root.classList.add('dark')
  }
}
