#!/usr/bin/env bash
# Builds the game and publishes dist/ to the gh-pages branch (GitHub Pages). The main branch stays untouched.
# The frozen singleplayer version (the `singleplayer` branch) is published alongside it at /singleplayer/.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REMOTE="$(git remote get-url origin)"
NAME="$(git config user.name)"
EMAIL="$(git config user.email)"

npm run --silent build

TMP="$(mktemp -d)"
SP="$(mktemp -d)"
trap 'git worktree remove --force "$SP" 2>/dev/null || true; rm -rf "$TMP" "$SP"' EXIT
cp -r dist/. "$TMP/"
rm -f "$TMP/mp-test.html"

git worktree add -q --detach "$SP" singleplayer
ln -s "$PWD/node_modules" "$SP/node_modules"
(cd "$SP" && node tools/build.mjs > /dev/null)
mkdir -p "$TMP/singleplayer"
cp -r "$SP/dist/." "$TMP/singleplayer/"
touch "$TMP/.nojekyll"

git -C "$TMP" init -q -b gh-pages
git -C "$TMP" add -A
git -C "$TMP" -c user.name="$NAME" -c user.email="$EMAIL" commit -q -m "Publish game"
git -C "$TMP" push -q -f "$REMOTE" gh-pages

echo "Pushed to gh-pages. The site updates in about a minute."
