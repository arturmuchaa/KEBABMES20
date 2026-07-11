/**
 * PlanningPage — Planowanie masowania.
 *
 * Masowanie = półprodukt. Cała strona to plan dnia (MixingDayPlanEditor):
 * kolejka receptur z obowiązkowym przypisaniem partii mięsa FEFO, edytowalna
 * w ciągu dnia. Wynik masowania idzie do planowania produkcji.
 */
import { MixingDayPlanEditor } from '../components/MixingDayPlanEditor'

export function PlanningPage() {
  return (
    <div className="space-y-4 animate-fade-in">
      <p className="text-[11px] text-muted-foreground">
        Masowanie = półprodukt. Plan dnia: kolejka receptur z partiami mięsa.
        Wynik masowania idzie do planowania produkcji. Bez HMI na masownicy —
        po fizycznym wymieszaniu pozycji kliknij „Potwierdź" przy statusie,
        żeby mięso przyprawione trafiło na magazyn.
      </p>
      <MixingDayPlanEditor />
    </div>
  )
}
