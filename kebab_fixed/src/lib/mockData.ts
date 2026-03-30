/**
 * mockData.ts — Czyste dane startowe
 * 
 * Brak danych demo - wszystko dodajesz sam!
 * Dane są przechowywane w pamięci przeglądarki (odświeżenie = reset)
 */
import type { RawBatch, DeboningSession, MeatStock, Supplier, User } from '@/types'

// ─── DOSTAWCY ─────────────────────────────────────────────────────────────────
// Pusta lista - dodaj swoich dostawców przez panel "Dostawcy"
export const MOCK_SUPPLIERS: Supplier[] = []

// ─── UŻYTKOWNICY / PRACOWNICY ─────────────────────────────────────────────────
// Jeden admin do startu - dodaj pracowników przez panel "Pracownicy"
export const MOCK_USERS: User[] = [
  { id:'u1', login:'admin', name:'Administrator', role:'ADMIN', active:true },
]

// ─── PARTIE ĆWIARTKI ──────────────────────────────────────────────────────────
// Pusta lista - dodaj partie przez "Przyjęcie ćwiartki"
export const MOCK_BATCHES: RawBatch[] = []

// ─── SESJE ROZBIORU ───────────────────────────────────────────────────────────
// Pusta lista - sesje tworzą się automatycznie podczas rozbioru na tablecie
export const MOCK_DEBONINGS: DeboningSession[] = []

// ─── MAGAZYN MIĘSA ────────────────────────────────────────────────────────────
// Pusta lista - mięso tworzy się automatycznie po rozbiorze
export const MOCK_MEAT: MeatStock[] = []
