import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { wzApi, WzDoc } from '@/lib/api'
import { WzDocumentView } from '@/components/wz/WzDocumentView'

export function WzPrintPage() {
  const { id = '' } = useParams()
  const [sp] = useSearchParams()
  const isPdf = sp.get('pdf') === '1'
  const [doc, setDoc] = useState<WzDoc | null>(null)

  useEffect(() => { wzApi.byId(id).then(setDoc) }, [id])
  useEffect(() => { if (doc && !isPdf) setTimeout(() => window.print(), 300) }, [doc, isPdf])

  if (!doc) return <div style={{ padding: 24 }}>Ładowanie…</div>
  return <WzDocumentView doc={doc} />
}
