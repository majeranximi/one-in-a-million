#!/usr/bin/env bash
# Buduje grę i publikuje dist/ na gałęzi gh-pages (GitHub Pages). Główna gałąź zostaje bez zmian.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REMOTE="$(git remote get-url origin)"
NAME="$(git config user.name)"
EMAIL="$(git config user.email)"

npm run --silent build

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -r dist/. "$TMP/"
touch "$TMP/.nojekyll"

git -C "$TMP" init -q -b gh-pages
git -C "$TMP" add -A
git -C "$TMP" -c user.name="$NAME" -c user.email="$EMAIL" commit -q -m "Publikacja gry"
git -C "$TMP" push -q -f "$REMOTE" gh-pages

echo "Wysłano na gh-pages. Strona odświeży się po około minucie."
