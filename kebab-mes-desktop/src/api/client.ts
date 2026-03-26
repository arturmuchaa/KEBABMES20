/**
 * HTTP API Client
 * Thin axios wrapper that reads the base URL from config store.
 * All API modules import from here — never hardcode URLs.
 */
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios'
import { getApiUrl } from '@/store/config'

let _client: AxiosInstance | null = null

function buildClient(): AxiosInstance {
  const baseURL = getApiUrl() || 'http://localhost:8000'
  return axios.create({
    baseURL,
    timeout: 15_000,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Returns (or creates) the singleton axios instance. */
export function getClient(): AxiosInstance {
  if (!_client) _client = buildClient()
  return _client
}

/** Call this when the API URL is changed so a fresh client is built. */
export function resetClient(): void {
  _client = null
}

// ─── Convenience wrappers ─────────────────────────────────────

export async function apiGet<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const { data } = await getClient().get<T>(path, { params })
  return data
}

export async function apiPost<T>(path: string, body?: unknown, cfg?: AxiosRequestConfig): Promise<T> {
  const { data } = await getClient().post<T>(path, body, cfg)
  return data
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await getClient().patch<T>(path, body)
  return data
}

export async function apiDelete<T>(path: string): Promise<T> {
  const { data } = await getClient().delete<T>(path)
  return data
}

export const apiPut = <T>(path: string, body?: unknown): Promise<T> =>
  getClient().put(path, body).then(r => r.data)

/** Check backend connectivity — used by the connection status indicator. */
export async function checkHealth(): Promise<boolean> {
  try {
    const url = getApiUrl()
    if (!url) return false
    await axios.get(`${url}/api/health`, { timeout: 4_000 })
    return true
  } catch {
    return false
  }
}
