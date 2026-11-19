/** Typy okna druku — odpowiadają komendom `druk_*` w src-tauri/src/druk. */

export interface Drukarka { nazwa: string; domyslna: boolean }
export interface Opcja { id: string; nazwa: string }
export interface Funkcja { id: string; nazwa: string; opcje: Opcja[]; wybrana: string | null }
export interface Mozliwosci {
  funkcje: Funkcja[]
  ticket: string
  kopieMax: number
  /** [id funkcji zasobnika, id opcji „zasobnik 1”] */
  zasobnikDomyslny: [string, string] | null
}

export interface UstawieniaDokumentu { drukarka: string; ticket: string; kopie: number }
