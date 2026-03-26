#!/bin/bash
# ============================================================
# Kebab MES — Pobierz folder kebab-mes-desktop
# Uruchom na swoim komputerze (Linux/Mac) lub Git Bash (Windows)
# bash get-desktop.sh
# ============================================================

REPO="https://github.com/arturmuchaa/KEBABMES20.git"
BRANCH="claude/add-traceability-system-UxumS"
FOLDER="kebab-mes-desktop"

echo "Pobieranie kebab-mes-desktop z GitHub..."

# Opcja 1: sparse checkout (szybko, tylko potrzebny folder)
if command -v git &>/dev/null; then
    rm -rf _tmp_kebab
    git clone --depth 1 --branch "$BRANCH" --filter=blob:none --sparse "$REPO" _tmp_kebab
    cd _tmp_kebab
    git sparse-checkout set "$FOLDER"
    cd ..
    cp -r "_tmp_kebab/$FOLDER" .
    rm -rf _tmp_kebab
    echo "Gotowe! Folder kebab-mes-desktop jest w bieżącym katalogu."
    echo ""
    echo "Następne kroki:"
    echo "  cd kebab-mes-desktop"
    echo "  npm install"
    echo "  npx tauri build"
else
    echo "Git nie jest zainstalowany. Pobierz z https://git-scm.com"
fi
