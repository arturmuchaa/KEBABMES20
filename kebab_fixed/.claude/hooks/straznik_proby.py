#!/usr/bin/env python3
"""Strażnik próby PROTRIMA — hook PreToolUse dla Claude Code.

Działa przed KAŻDYM poleceniem Bash i każdą edycją pliku w sesji uruchomionej
w worktree próby (/opt/kebab/protrima/kebab_fixed). Blokuje to, co mogłoby
dotknąć produkcji stojącej na tym samym serwerze: wdrożenie, usługę
kebab-mes, nginx, bazę produkcyjną i jej sekrety, kanał aktualizacji, tagi
i wypchnięcia poza gałąź próby, zapis w katalogach produkcji oraz zmiany backendu.

Kod wyjścia 2 = Claude Code nie wykona akcji, a treść ze stderr wraca do
modelu jako powód. Kod 0 = brak sprzeciwu (dalej działają zwykłe uprawnienia).

Reguły są celowo ostre. Jeśli coś z listy jest naprawdę potrzebne, robi to
człowiek ręcznie albo świadomie zmienia ten plik.
Test: python3 .claude/hooks/test_straznik_proby.py
"""
from __future__ import annotations

import json
import os
import re
import shlex
import sys

GALAZ = "protrima-ui"
BAZA_PROBY = "kebab_protrima"
ZNAK_PROBY = "protrima"
WORKFLOW_PROBY = "tauri-protrima-test"

KATALOGI_PRODUKCJI = ("/opt/kebab/app", "/opt/kebab/kebab_new")
ENV_PRODUKCJI = "/opt/kebab/config/.env"
KATALOGI_SYSTEMU = ("/etc/nginx", "/etc/systemd/system", "/opt/kebab/config")
WOLNE_DO_RM = ("/opt/kebab/protrima", "/tmp/")

# Pliki w repo, których próba nie zmienia (wdrożenie i buildy produkcji).
PLIKI_ZAMKNIETE = re.compile(
    r"(^|/)(deploy/(deploy|rollback|smoke|straznik_hosta|proba_generalna|backup_db)\.(sh|py)"
    r"|src-tauri/tauri\.(conf|kiosk\.conf|magazyn\.conf|masowanie\.conf|produkcja\.conf|rozbior-v\d+\.conf)\.json"
    r"|\.github/workflows/(?!tauri-protrima-test\.yml$)[^/]+\.ya?ml)$"
)
SQL_NISZCZACY = re.compile(
    r"drop\s+database|\bdropdb\b|drop\s+schema|drop\s+table|\btruncate\b|delete\s+from|alter\s+database"
    r"|update\s+[\w.\"]+\s+set\b|pg_restore\b[^\n]*--clean|vacuum\s+full",
    re.IGNORECASE,
)
ZAPISUJACE = {"mv", "rm", "rmdir", "chmod", "chown", "ln", "truncate", "tee", "dd", "touch", "mkdir", "unzip", "tar", "patch"}
KOPIUJACE = {"cp", "rsync", "install", "scp"}
GIT_MUTUJACE = {"checkout", "switch", "reset", "merge", "rebase", "pull", "commit", "stash", "clean",
                "restore", "cherry-pick", "am", "apply", "revert", "rm", "mv"}


def blokuj(powod: str) -> None:
    print(f"STRAŻNIK PRÓBY PROTRIMA: {powod}", file=sys.stderr)
    print("Zasady: docs/protrima-ui/ZASADY_PROBY.md. Jeśli to naprawdę potrzebne, poproś człowieka, "
          "żeby zrobił to ręcznie.", file=sys.stderr)
    sys.exit(2)


def w_produkcji(sciezka: str) -> bool:
    return sciezka.startswith(KATALOGI_PRODUKCJI) or sciezka.startswith(ENV_PRODUKCJI)


def w_systemie_obcy(sciezka: str) -> bool:
    return sciezka.startswith(KATALOGI_SYSTEMU) and ZNAK_PROBY not in sciezka.lower() and not w_produkcji(sciezka)


def nazwa_bazy_produkcji() -> str | None:
    """Nazwa bazy z DATABASE_URL produkcji (bez wypisywania haseł)."""
    try:
        with open(os.environ.get("STRAZNIK_PLIK_ENV", ENV_PRODUKCJI), encoding="utf-8") as f:
            for linia in f:
                m = re.match(r"\s*(?:export\s+)?DATABASE_URL\s*=\s*['\"]?([^'\"\s]+)", linia)
                if m:
                    return m.group(1).rstrip("/").rsplit("/", 1)[-1].split("?")[0] or None
    except OSError:
        return None
    return None


def segmenty(polecenie: str) -> list[str]:
    """Rozbija polecenie złożone na części (&&, ||, ;, |, nowa linia, podpowłoki)."""
    plaskie = re.sub(r"[()`]|\$\(", " ; ", polecenie)
    return [s.strip() for s in re.split(r"&&|\|\||;|\||\n", plaskie) if s.strip()]


def tokeny(segment: str) -> list[str]:
    try:
        return shlex.split(segment, posix=True)
    except ValueError:
        return segment.split()


def bez_prefiksow(tok: list[str]) -> list[str]:
    """Pomija VAR=x, sudo, env, nohup, time, timeout N."""
    i = 0
    while i < len(tok):
        t = tok[i]
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", t) or t in ("sudo", "env", "nohup", "time", "command", "builtin", "exec"):
            i += 1
            continue
        if t == "timeout" and i + 1 < len(tok):
            i += 2
            continue
        break
    return tok[i:]


def cele_przekierowan(seg: str) -> list[str]:
    return [m.group(1) for m in re.finditer(r"\d?>{1,2}\|?\s*([^\s;&|<>]+)", seg)]


def sprawdz_git(tok: list[str], w_prod: bool) -> None:
    i, sub = 1, None
    while i < len(tok):
        if tok[i] in ("-C", "-c", "--git-dir", "--work-tree"):
            if tok[i] == "-C" and i + 1 < len(tok) and w_produkcji(tok[i + 1]):
                w_prod = True
            i += 2
            continue
        if tok[i].startswith("-"):
            i += 1
            continue
        sub = tok[i]
        break
    if sub is None:
        return
    reszta = tok[i + 1:]

    if sub == "push":
        if any(a in ("--tags", "--mirror", "--all", "--delete", "-d", "-f", "--prune") or a.startswith("--force") for a in reszta):
            blokuj("git push z --tags/--force/--delete/--all/--mirror jest zablokowany.")
        cele = [a for a in reszta if not a.startswith("-")]
        if any(re.search(r"(^|:)(main|master)$", a) or a.startswith(":") or a.startswith("+") for a in cele):
            blokuj("wypchnięcie do main/master jest zablokowane. Merge robi człowiek po akceptacji próby.")
        if not any(a == GALAZ or a.endswith(":" + GALAZ) for a in cele):
            blokuj(f"wypychaj tylko jawnie gałąź próby: git push origin {GALAZ}")
        return

    if sub == "tag":
        listowanie = any(a in ("-l", "--list") for a in reszta) and not any(a in ("-d", "--delete", "-a", "-s", "-f", "-m") for a in reszta) \
            or all(a.startswith(("-n", "--sort", "--contains", "--points-at", "--format")) for a in reszta)
        if reszta and not listowanie:
            blokuj("tworzenie i usuwanie tagów jest zablokowane: tagi v*, magazyn-*, kiosk-v* itd. uruchamiają "
                   "buildy publikujące na produkcję.")
        return

    if w_prod and (sub in GIT_MUTUJACE or sub == "branch" and any(a in ("-d", "-D", "-m", "-M", "-f") for a in reszta)):
        blokuj("zmiany w repo produkcyjnym /opt/kebab/kebab_new są zablokowane. Pracuj w worktree "
               "/opt/kebab/protrima na gałęzi protrima-ui.")


def sprawdz_bash(polecenie: str, cwd: str) -> None:
    p = polecenie
    low = p.lower()

    # 1. Wdrożenie produkcji
    if re.search(r"(^|[\s/'\"])(deploy|rollback)\.sh\b", p) or "KEBAB_FORCE_DEPLOY" in p:
        blokuj("deploy.sh i rollback.sh dotyczą PRODUKCJI. Próby nie wdraża się tymi skryptami.")

    # 2. Usługa produkcyjna, nginx, procesy
    for m in re.finditer(r"\b(systemctl|service)\b([^;&|\n]*)", p):
        reszta = m.group(2)
        if re.search(r"\bkebab-mes\b", reszta) and not re.search(r"\b(status|is-active|is-enabled|is-failed|show|cat|list-units)\b", reszta):
            blokuj("usługa kebab-mes to produkcja: nie zatrzymuj, nie restartuj, nie przeładowuj. "
                   "Backend próby to usługa protrima-proba.")
        if re.search(r"\bnginx\b", reszta) and re.search(r"\b(reload|restart|stop|start|kill|disable|mask)\b", reszta):
            blokuj("nginx obsługuje produkcję. Przygotuj plik, sprawdź `nginx -t`, a przeładowanie zostaw człowiekowi.")
    if re.search(r"\bnginx\s+-s\b", p):
        blokuj("nginx -s jest zablokowany. Przeładowanie nginx robi człowiek.")
    if re.search(r"\b(pkill|killall)\b", p) and ZNAK_PROBY not in low:
        blokuj("pkill/killall może trafić w produkcję (gunicorn próby i produkcji ma tę samą nazwę procesu). "
               "Używaj: systemctl restart protrima-proba.")
    if re.search(r"\bfuser\b[^;&|\n]*\s-[a-zA-Z]*k", p):
        blokuj("fuser -k jest zablokowany.")

    # 3. Kanał aktualizacji i GitHub
    if re.search(r"desktop-updates/[^\s'\"]*publish|/api/admin/", p):
        blokuj("publikacja na kanał aktualizacji trafia do wszystkich komputerów biura. Zablokowane.")
    if re.search(r"\bgh\s+workflow\s+run\b", p) and WORKFLOW_PROBY not in p:
        blokuj(f"wolno uruchamiać tylko workflow {WORKFLOW_PROBY}.yml. Pozostałe publikują instalatory produkcji.")
    if re.search(r"\bgh\s+(release\s+(create|upload|edit|delete)|pr\s+merge)\b|\bgh\s+api\b[^;&|\n]*(-X|--method)\s*(POST|PUT|PATCH|DELETE)", p):
        blokuj("wydania, merge PR i zapisy przez gh api są w próbie zablokowane.")

    # 4. Baza danych
    for m in re.finditer(r"(?<![A-Za-z_])DATABASE_URL\s*=\s*['\"]?([^'\"\s]+)", p):
        baza = m.group(1).rstrip("/").rsplit("/", 1)[-1].split("?")[0]
        if baza != BAZA_PROBY and not baza.startswith("$"):
            blokuj(f"DATABASE_URL wskazuje bazę „{baza}”. W próbie wolno tylko {BAZA_PROBY}.")
    if SQL_NISZCZACY.search(p) and BAZA_PROBY not in p:
        blokuj(f"polecenie niszczące lub zmieniające dane bez jawnego wskazania bazy {BAZA_PROBY}.")
    if ENV_PRODUKCJI in p:
        blokuj("/opt/kebab/config/.env to sekrety produkcji: nie czytaj i nie zmieniaj tego pliku. "
               "Nazwę bazy produkcji i izolację próby pokazuje: deploy/protrima_proba.sh status.")
    prod_db = nazwa_bazy_produkcji()
    if prod_db and prod_db != BAZA_PROBY:
        wzor_bazy = re.compile(rf"(^|[\s'\"=/]){re.escape(prod_db)}($|[\s'\";)])")
        for seg in segmenty(p):
            if re.search(r"\b(psql|pg_restore|createdb|dropdb|pg_dumpall|vacuumdb|reindexdb|clusterdb)\b", seg) and wzor_bazy.search(seg):
                blokuj(f"dostęp do bazy produkcyjnej „{prod_db}” jest zablokowany (jedyny wyjątek to pg_dump "
                       f"w deploy/protrima_proba.sh). Porównania rób na {BAZA_PROBY}.")

    # 5. System serwera
    if re.search(r"\b(ufw|iptables|ip6tables|nft)\b", p) and not re.search(r"\bufw\s+status\b|\biptables\s+-[LS]\b|\bnft\s+list\b", p):
        blokuj("zapora sieciowa jest wspólna z produkcją. Porty otwiera człowiek.")
    if re.search(r"\b(apt|apt-get|dpkg|snap)\b\s+(install|remove|purge|upgrade|dist-upgrade|full-upgrade|autoremove|-i)\b", p):
        blokuj("instalowanie pakietów systemowych na serwerze produkcyjnym jest zablokowane.")
    if re.search(r"\bplaywright\b[^;&|\n]*(--with-deps|\binstall-deps\b)", p):
        blokuj("playwright --with-deps / install-deps instaluje pakiety systemowe (apt) na serwerze produkcji. "
               "Zrzuty rób przeglądarką, która już jest, albo na swoim komputerze.")
    if re.search(r"\bpip3?\s+install\b|-m\s+pip\s+install\b|\buv\s+pip\s+install\b", p):
        blokuj("pip install jest zablokowany: venv /opt/kebab/venv jest wspólny z produkcją, a próba nie zmienia backendu.")
    if re.search(r"\bnpm\s+(i|install|add)\b[^;&|\n]*\s(-g|--global)\b", p):
        blokuj("globalne instalacje npm są zablokowane. Instaluj tylko lokalnie w worktree.")
    if re.search(r"(^|[\s;&|(])(reboot|shutdown|poweroff|halt)(\s|$)", p):
        blokuj("restart i wyłączenie serwera są zablokowane.")

    # 6. Zapis w katalogach produkcji i systemu + git
    w_prod = w_produkcji(cwd or "")
    for seg in segmenty(p):
        tok = bez_prefiksow(tokeny(seg))
        if not tok:
            continue
        prog = os.path.basename(tok[0])
        argumenty = tok[1:]

        if prog in ("cd", "pushd"):
            cel = argumenty[0] if argumenty else ""
            w_prod = w_produkcji(cel) if cel.startswith("/") else w_prod
            continue

        for cel in cele_przekierowan(seg):
            if w_produkcji(cel) or (w_prod and not cel.startswith("/")):
                blokuj("przekierowanie zapisu do katalogu produkcji jest zablokowane.")
            if w_systemie_obcy(cel):
                blokuj("zapis w /etc/nginx, /etc/systemd/system i /opt/kebab/config tylko do plików z „protrima” w nazwie.")

        if prog == "git":
            sprawdz_git(tok, w_prod)
            continue

        edycja_sed = prog == "sed" and any(re.match(r"^-[a-zA-Z]*i", a) or a.startswith("--in-place") for a in argumenty)
        if prog in KOPIUJACE:
            nazwy = [a for a in argumenty if not a.startswith("-")]
            if nazwy:
                cel = nazwy[-1]
                if w_produkcji(cel) or (w_prod and not cel.startswith("/")):
                    blokuj("kopiowanie DO katalogu produkcji jest zablokowane (z produkcji do próby wolno).")
                if w_systemie_obcy(cel):
                    blokuj("zapis w /etc/nginx, /etc/systemd/system i /opt/kebab/config tylko do plików z „protrima” w nazwie.")
        elif prog in ZAPISUJACE or edycja_sed:
            if w_prod or any(w_produkcji(a) for a in argumenty) or any(k in seg for k in KATALOGI_PRODUKCJI) or ENV_PRODUKCJI in seg:
                blokuj(f"{prog} w katalogu produkcji (/opt/kebab/app, /opt/kebab/kebab_new, /opt/kebab/config/.env) jest zablokowany.")
            if any(w_systemie_obcy(a) for a in argumenty if a.startswith("/")):
                blokuj("zapis w /etc/nginx, /etc/systemd/system i /opt/kebab/config tylko do plików z „protrima” w nazwie.")
            if prog in ("rm", "rmdir") and any(re.match(r"^-[a-zA-Z]*[rR]", a) or a == "--recursive" for a in argumenty):
                sciezki = [a for a in argumenty if a.startswith("/")]
                if any(not a.startswith(WOLNE_DO_RM) for a in sciezki):
                    blokuj("rm -r poza /opt/kebab/protrima i /tmp jest zablokowane.")


def sprawdz_plik(sciezka: str) -> None:
    s = sciezka.replace("\\", "/")
    if w_produkcji(s):
        blokuj(f"edycja pliku produkcji ({s}) jest zablokowana. Pracuj w /opt/kebab/protrima.")
    if s.startswith(KATALOGI_SYSTEMU) and ZNAK_PROBY not in os.path.basename(s).lower():
        blokuj(f"w {os.path.dirname(s)} wolno tworzyć tylko pliki próby (z „protrima” w nazwie).")
    if PLIKI_ZAMKNIETE.search(s):
        blokuj(f"{s} należy do wdrożenia lub buildów produkcji. Próba go nie zmienia.")
    if re.search(r"(^|/)kebab_fixed/backend/|^backend/", s):
        blokuj("próba nie zmienia backendu. Brakującą funkcję API zapisz w docs/protrima-ui/BRAKI_API.md "
               "i pokaż w UI jako wyłączoną.")


def main() -> None:
    try:
        dane = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)
    narzedzie = dane.get("tool_name", "")
    wej = dane.get("tool_input", {}) or {}
    if narzedzie == "Bash":
        sprawdz_bash(str(wej.get("command", "")), str(dane.get("cwd", "")))
    elif narzedzie in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        sprawdz_plik(str(wej.get("file_path") or wej.get("notebook_path") or ""))
    sys.exit(0)


if __name__ == "__main__":
    main()
