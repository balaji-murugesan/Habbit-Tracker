// Copies the shared web UI (../public) into www/ for Capacitor.
// The service worker is skipped: the native app doesn't need it.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', '..', 'public');
const dest = path.join(__dirname, '..', 'www');
const SKIP = new Set(['sw.js']);

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true, filter: (p) => !SKIP.has(path.basename(p)) });
console.log(`Copied web UI ${path.relative(process.cwd(), src)} -> ${path.relative(process.cwd(), dest)}`);
