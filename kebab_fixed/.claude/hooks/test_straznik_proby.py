#!/usr/bin/env python3
"""Test strażnika próby: python3 .claude/hooks/test_straznik_proby.py"""
import json
import os
import subprocess
import sys
import tempfile

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "straznik_proby.py")
env_tmp = tempfile.NamedTemporaryFile("w", delete=False, suffix=".env")
env_tmp.write("DATABASE_URL=postgresql://kebab:sekret@127.0.0.1:5433/kebab_mes\n")
env_tmp.close()
ENV = dict(os.environ, STRAZNIK_PLIK_ENV=env_tmp.name)
CWD = "/opt/kebab/protrima/kebab_fixed"


def bash(cmd, cwd=CWD):
    return run({"tool_name": "Bash", "tool_input": {"command": cmd}, "cwd": cwd})


def plik(path, tool="Edit"):
    return run({"tool_name": tool, "tool_input": {"file_path": path}, "cwd": CWD})


def run(payload):
    r = subprocess.run([sys.executable, HOOK], input=json.dumps(payload), capture_output=True, text=True, env=ENV)
    return r.returncode


DOZWOLONE = [
    "npx tsc --noEmit",
    "npm run build -- --mode proba",
    "npx vitest run src/protrima",
    "git status && git diff --stat",
    'git add -A && git commit -m "Faza 1: szkielet PROTRIMA"',
    "git push origin protrima-ui",
    "git push -u origin protrima-ui",
    "git tag",
    "git tag -l 'protrima*'",
    "git -C /opt/kebab/kebab_new worktree list",
    "git -C /opt/kebab/kebab_new fetch",
    "git -C /opt/kebab/kebab_new log --oneline -5",
    "systemctl restart protrima-proba",
    "systemctl status kebab-mes",
    "journalctl -u kebab-mes -n 50 --no-pager",
    "diff -rq /opt/kebab/app/backend/app /opt/kebab/protrima/kebab_fixed/backend/app",
    "ls -la /opt/kebab/app/dist",
    "cp /opt/kebab/app/dist/index.html /tmp/prod-index.html",
    "su - postgres -c 'pg_dump -p 5433 --no-owner --no-privileges kebab_mes' | head",
    "psql -h 127.0.0.1 -p 5433 -U protrima_test -d kebab_protrima -c 'select count(*) from client_orders'",
    "psql -h 127.0.0.1 -p 5433 -U protrima_test -d kebab_protrima -c 'DELETE FROM x WHERE id=1'",
    "deploy/protrima_proba.sh odswiez-baze",
    "sudo deploy/protrima_proba.sh status",
    "nginx -t",
    "curl -s http://127.0.0.1:8090/api/health",
    "ln -s /etc/nginx/sites-available/protrima-proba /etc/nginx/sites-enabled/protrima-proba",
    "cp deploy/protrima-proba.service /etc/systemd/system/protrima-proba.service",
    "systemctl daemon-reload",
    "ufw status",
    "rm -rf dist node_modules/.vite",
    "rm -rf /opt/kebab/protrima/kebab_fixed/dist",
    "mkdir -p src/protrima/shell",
    "TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest -q",
    "DATABASE_URL=postgresql://protrima_test:x@127.0.0.1:5433/kebab_protrima /opt/kebab/venv/bin/python -c 'print(1)'",
    "gh workflow run tauri-protrima-test.yml --ref protrima-ui",
    "gh run list --workflow tauri-protrima-test.yml",
    "npx playwright screenshot http://127.0.0.1:8090/protrima.html /tmp/a.png",
    "cat /opt/kebab/app/dist/assets/index.js > /tmp/x.js",
    "ls /opt/kebab/config/",
    "deploy/protrima_proba.sh status",
]
ZABLOKOWANE = [
    "deploy/deploy.sh frontend",
    "bash deploy/deploy.sh",
    "./deploy/rollback.sh --lista",
    "KEBAB_FORCE_DEPLOY=1 /opt/kebab/kebab_new/kebab_fixed/deploy/deploy.sh all",
    "systemctl restart kebab-mes",
    "systemctl stop kebab-mes.service",
    "service kebab-mes restart",
    "systemctl daemon-reload && systemctl restart kebab-mes",
    "systemctl reload nginx",
    "nginx -s reload",
    "systemctl restart nginx",
    "pkill -f gunicorn",
    "killall nginx",
    "fuser -k 8010/tcp",
    "cp -r dist /opt/kebab/app/",
    "rsync -a dist/ /opt/kebab/app/dist/",
    "echo X >> /opt/kebab/config/.env",
    "sed -i 's/a/b/' /opt/kebab/config/.env",
    "rm -rf /opt/kebab/app/dist",
    "cd /opt/kebab/app && rm -rf dist",
    "cd /opt/kebab/kebab_new && git checkout main",
    "git -C /opt/kebab/kebab_new pull",
    "git push",
    "git push origin main",
    "git push origin HEAD:main",
    "git push --tags",
    "git push -f origin protrima-ui",
    "git push --force-with-lease origin protrima-ui",
    "git tag v2.5.141",
    "git tag -a protrima-1 -m x",
    "git tag -d v1",
    "gh workflow run tauri-build.yml --ref protrima-ui",
    "gh release create v9",
    "gh pr merge 5 --merge",
    "curl -X POST 'http://91.98.105.107:8080/api/admin/desktop-updates/publish?version=1'",
    "psql -p 5433 -d kebab_mes -c 'select 1'",
    "su - postgres -c \"psql -p 5433 -c 'DROP DATABASE kebab_mes'\"",
    "DATABASE_URL=postgresql://u:p@127.0.0.1:5433/kebab_mes /opt/kebab/venv/bin/python -c 'from app.migrations import run_migrations; run_migrations()'",
    "psql -c 'TRUNCATE client_orders'",
    "ufw allow 8090/tcp",
    "iptables -F",
    "apt-get install -y docker.io",
    "/opt/kebab/venv/bin/pip install requests",
    "pip install x",
    "npm install -g serve",
    "reboot",
    "rm -rf /etc/nginx/sites-enabled/default",
    "rm -rf /var/lib/postgresql",
    "echo 'x' > /etc/nginx/sites-available/default",
    "cp nowy.conf /etc/nginx/sites-available/kebab",
    "cat /opt/kebab/config/.env",
    "grep DATABASE_URL /opt/kebab/config/.env",
    "set -a; . /opt/kebab/config/.env; echo $DATABASE_URL",
    "npx playwright install --with-deps chromium",
    "npx playwright install-deps",
]
PLIKI_OK = [
    "/opt/kebab/protrima/kebab_fixed/src/protrima/App.tsx",
    "/opt/kebab/protrima/kebab_fixed/src/lib/api.ts",
    "/opt/kebab/protrima/kebab_fixed/src-tauri/src/lib.rs",
    "/opt/kebab/protrima/kebab_fixed/src-tauri/tauri.protrima-test.conf.json",
    "/opt/kebab/protrima/.github/workflows/tauri-protrima-test.yml",
    "/etc/nginx/sites-available/protrima-proba",
    "/etc/systemd/system/protrima-proba.service",
    "/opt/kebab/config/protrima.env",
    "/opt/kebab/protrima/kebab_fixed/docs/protrima-ui/BRAKI_API.md",
]
PLIKI_ZLE = [
    "/opt/kebab/app/backend/app/main.py",
    "/opt/kebab/config/.env",
    "/opt/kebab/kebab_new/kebab_fixed/src/App.tsx",
    "/etc/nginx/sites-available/kebab",
    "/etc/systemd/system/kebab-mes.service",
    "/opt/kebab/protrima/kebab_fixed/backend/app/routes/orders.py",
    "/opt/kebab/protrima/kebab_fixed/deploy/deploy.sh",
    "/opt/kebab/protrima/kebab_fixed/src-tauri/tauri.conf.json",
    "/opt/kebab/protrima/.github/workflows/tauri-build.yml",
]

bledy = 0
for c in DOZWOLONE:
    if bash(c) != 0:
        bledy += 1
        print("✗ powinno przejść:", c)
for c in ZABLOKOWANE:
    if bash(c) != 2:
        bledy += 1
        print("✗ powinno być zablokowane:", c)
for f in PLIKI_OK:
    if plik(f) != 0 or plik(f, "Write") != 0:
        bledy += 1
        print("✗ edycja powinna przejść:", f)
for f in PLIKI_ZLE:
    if plik(f) != 2:
        bledy += 1
        print("✗ edycja powinna być zablokowana:", f)
if bash("rm -rf dist", cwd="/opt/kebab/app") != 2:
    bledy += 1
    print("✗ rm w cwd produkcji powinno być zablokowane")
os.unlink(env_tmp.name)
n = len(DOZWOLONE) + len(ZABLOKOWANE) + len(PLIKI_OK) + len(PLIKI_ZLE) + 1
print(f"{n - bledy}/{n} przypadków OK")
sys.exit(1 if bledy else 0)
