# Źródło postępu zamówień — decyzja 16.10.2026

## Obecny tryb: magazyn wyrobu

Na prośbę właściciela GOTOWE, pozostała ilość i zapotrzebowanie na mieszanie
wynikają z wyrobu dodanego do magazynu, przydzielonego globalnie do zamówień.
Obowiązuje istniejące `qty_stock + qty_delivered` z `orders_service`.
Wydania pozostają w postępie, żeby wysyłka nie cofała realizacji.
To pokrycie zamówienia, nie pomiar produkcji brutto.

Raporty planów/HMI (`production_plan_lines.qty_done`) nie zwiększają postępu,
nie pomniejszają mieszania i nie blokują obliczenia przy różnicy/niepewnym
nakładaniu z magazynem. Projekcja `production` pozostaje diagnostyczna.
Nie dodajemy drugi raz palet, kartonów ani raportów do tego samego wyrobu.
Warianty, globalna alokacja i dotychczasowa konwencja zamkniętych zamówień
pozostają bez zmian. Zamknięte/anulowane zamówienia nie wymagają mieszania.

## Docelowo: skan każdej wyprodukowanej sztuki

**Po faktycznym uruchomieniu skanowania KAŻDEJ sztuki zweryfikowane skany
produkcji mają być nadrzędnym, wiążącym źródłem.** Nie są nim ręczne sumy
raportów HMI ani liczba wydrukowanych etykiet, palet lub kartonów.

Przełączenie wymaga osobnej, jawnej decyzji wdrożeniowej i ustalenia granicy
starego/nowego sposobu pracy. Nie przełączamy automatycznie po pojawieniu się
pierwszego skanu. Istniejąca obsługa skanera nie dowodzi pełnego skanowania.
Przy wdrożeniu należy zweryfikować unikalność sztuk, ponowne skany, anulowania,
przypisania do wariantu/zamówienia i odróżnienie produkcji od dostępnego zapasu.
Skany i przyjęcie magazynowe tej samej sztuki nie mogą się sumować.

Punkty wdrożenia: `src/features/orders/orderPlanning.ts` (`lineProgress`),
`backend/app/services/order_planning_service.py` (`project_line`).
