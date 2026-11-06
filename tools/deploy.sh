#!/usr/bin/env bash
# Builds the game and publishes dist/ to the gh-pages branch (GitHub Pages). The main branch stays untouched.
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
git -C "$TMP" -c user.name="$NAME" -c user.email="$EMAIL" commit -q -m "Publish game"
git -C "$TMP" push -q -f "$REMOTE" gh-pages

echo "Pushed to gh-pages. The site updates in about a minute."
