/**
 * API Configuration Store
 * Persists the backend server URL in localStorage.
 * On first launch the user is prompted to enter the URL (SetupPage).
 */

const KEY = 'mes_api_url'
const FACILITY_KEY = 'mes_facility_name'

export function getApiUrl(): string | null {
  return localStorage.getItem(KEY)
}

export function setApiUrl(url: string): void {
  // Normalise: strip trailing slash
  const normalised = url.replace(/\/+$/, '')
  localStorage.setItem(KEY, normalised)
}

export function clearApiUrl(): void {
  localStorage.removeItem(KEY)
}

export function getFacilityName(): string {
  return localStorage.getItem(FACILITY_KEY) || 'Kebab MES'
}

export function setFacilityName(name: string): void {
  localStorage.setItem(FACILITY_KEY, name)
}

export function isConfigured(): boolean {
  const url = getApiUrl()
  return !!url && url.startsWith('http')
}
