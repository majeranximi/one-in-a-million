// Składa grę do dist/: game.js (bundle z wbudowanymi modelami) i index.html.
import fs from 'node:fs';
import { build } from 'esbuild';

fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  loader: { '.glb': 'binary' },
  outfile: 'dist/game.js',
  logLevel: 'warning',
});

const page = fs.readFileSync('src/page.html', 'utf8');
fs.writeFileSync('dist/index.html', `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body>
${page}
</body>
</html>
`);
console.log('dist gotowy:', (fs.statSync('dist/game.js').size / 1024).toFixed(0), 'kB game.js');
