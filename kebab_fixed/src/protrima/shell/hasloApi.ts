/** Zmiana hasła przez wspólnego klienta API (token, bez credentials — patrz lib/api.ts). */
import { kontoApi } from '@/lib/api'

export async function zmienHaslo(obecne: string, nowe: string): Promise<void> {
  await kontoApi.zmienHaslo(obecne, nowe)
}
