# Strażnik hosta — wspólny dla deploy.sh, rollback.sh i proba_generalna.sh.
# Plik do `source`, nie do uruchamiania.
#
# POWÓD ISTNIENIA: 29.09.2026 wdrożenie poszło na STARY serwer (Helsinki),
# który po przenosinach produkcji tylko przekierowuje ruch (nginx: 308 na
# nowy adres). Skrypty nie odróżniały go od produkcji: wgrały pliki,
# zmigrowały starą bazę, a jedynym sygnałem był „cichy" exit 1 przy
# sprawdzaniu bundla. Przekierowanie to informacja „tu nie ma produkcji",
# więc zatrzymujemy się, zamiast za nim iść.
#
# Adresu produkcji NIE wpisujemy na sztywno — bierzemy go z przekierowania,
# więc strażnik działa także po kolejnej przeprowadzce.

KEBAB_LOCAL_URL="${KEBAB_LOCAL_URL:-http://127.0.0.1:8080/}"

straznik_hosta() {
  local wynik kod cel
  # Bez -L: chcemy zobaczyć samo przekierowanie, nie to, dokąd prowadzi.
  wynik="$(curl -s -o /dev/null -m 10 -w '%{http_code} %{redirect_url}' "$KEBAB_LOCAL_URL" 2>/dev/null || true)"
  kod="${wynik%% *}"
  cel="${wynik#* }"
  case "$kod" in
    301|302|303|307|308)
      echo "✗ To NIE jest serwer produkcyjny ($(hostname))." >&2
      echo "  $KEBAB_LOCAL_URL przekierowuje (HTTP $kod) na: ${cel:-nieznany adres}" >&2
      echo "  Uruchom skrypt na serwerze, który obsługuje ten adres. Nic nie zmieniono." >&2
      exit 1 ;;
  esac
  # Brak odpowiedzi (000) nie blokuje: rollback musi działać także wtedy,
  # gdy nginx leży. Czy strona wstaje, sprawdzają dalsze kroki skryptu.
}
