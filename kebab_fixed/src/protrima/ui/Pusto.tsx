import React from 'react'

/**
 * Pusty widok — mówi, co się stało, i podaje następny krok (wyczyść filtry,
 * pokaż wszystko, dodaj nowe), zamiast samego „brak danych”.
 */
export function Pusto({ ikona, tytul, children, akcja }: { ikona?: React.ReactNode; tytul: string; children?: React.ReactNode; akcja?: React.ReactNode }) {
  return (
    <div className="empty">
      {ikona && <span className="empty-ico" aria-hidden="true">{ikona}</span>}
      <h3>{tytul}</h3>
      {children && <p>{children}</p>}
      {akcja && <div className="empty-act">{akcja}</div>}
    </div>
  )
}
