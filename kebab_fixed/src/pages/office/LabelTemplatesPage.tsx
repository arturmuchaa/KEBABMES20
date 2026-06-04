/**
 * LabelTemplatesPage — lista zapisanych szablonów etykiet (per klient + receptura).
 * Umożliwia przejście do edytora istniejącego szablonu lub tworzenie nowego.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Tag, Pencil, CheckCircle2, MinusCircle, Trash2 } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import { labelTemplatesApi, recipesApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

export function LabelTemplatesPage() {
  const navigate = useNavigate()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const templatesRes = useApi(() => labelTemplatesApi.list(), [])
  const recipesRes   = useApi(() => recipesApi.list(), [])

  const templates = templatesRes.data ?? []
  const recipes   = recipesRes.data ?? []

  // mapa recipeId → nazwa receptury
  const recipeMap = Object.fromEntries(recipes.map(r => [r.id, r.name]))

  const loading = templatesRes.loading || recipesRes.loading
  const error   = templatesRes.error   || recipesRes.error

  async function handleDelete(id: string) {
    if (!window.confirm('Usunąć szablon etykiety? Tej operacji nie można cofnąć.')) return
    setDeletingId(id)
    try {
      await labelTemplatesApi.remove(id)
      templatesRes.refetch()
    } finally {
      setDeletingId(null)
    }
  }

  function formatDate(raw: string) {
    if (!raw) return '—'
    try {
      return new Date(raw).toLocaleDateString('pl-PL', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      })
    } catch {
      return raw.slice(0, 10) || '—'
    }
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Tag size={22} /> Szablony etykiet
          </h1>
          <p className="text-sm text-muted-foreground">
            Zapisane konfiguracje etykiet dla par klient&nbsp;+&nbsp;receptura.
          </p>
        </div>
        <Button onClick={() => navigate('/etykiety/szablon')} className="gap-2">
          <Plus size={14} /> Nowy szablon
        </Button>
      </div>

      {/* Table card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Lista ({loading ? '…' : templates.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && (
            <div className="py-8 text-center text-sm text-muted-foreground">Ładowanie…</div>
          )}
          {!loading && error && (
            <div className="py-6 rounded bg-red-50 px-4 text-sm text-red-700">
              Błąd pobierania danych: {String(error)}
            </div>
          )}
          {!loading && !error && templates.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Brak zapisanych szablonów — kliknij «Nowy szablon»
            </div>
          )}
          {!loading && !error && templates.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Klient</TableHead>
                  <TableHead>Receptura</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead className="text-center">Tło</TableHead>
                  <TableHead>Zaktualizowano</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((tpl) => {
                  const recipeName = recipeMap[tpl.recipeId] ?? tpl.recipeId
                  const formatLabel = `${tpl.labelsPerSheet}/${(tpl.pageSize ?? 'a4').toUpperCase()}`
                  const editUrl = `/etykiety/szablon?clientId=${encodeURIComponent(tpl.clientId)}&recipeId=${encodeURIComponent(tpl.recipeId)}`

                  return (
                    <TableRow key={tpl.id}>
                      <TableCell className="font-semibold">{tpl.clientId || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        {recipeName && recipeName !== tpl.recipeId
                          ? recipeName
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{formatLabel}</Badge>
                        {tpl.kind && tpl.kind !== 'overlay' && (
                          <Badge variant="secondary" className="ml-1">{tpl.kind}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {tpl.hasBackground
                          ? <CheckCircle2 size={15} className="text-emerald-600 inline" />
                          : <MinusCircle  size={15} className="text-gray-300 inline" />}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(tpl.updatedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => navigate(editUrl)}
                        >
                          <Pencil size={13} /> Edytuj
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(tpl.id)}
                          disabled={deletingId === tpl.id}
                        >
                          <Trash2 size={13} /> Usuń
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
