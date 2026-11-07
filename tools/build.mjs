// Build: copy the engine into public/src so the static site is self-contained.
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
const out = new URL('../public/src/', import.meta.url);
if (existsSync(out)) rmSync(out, { recursive: true });
mkdirSync(out, { recursive: true });
for (const f of ['engine.js', 'genome.js', 'params.js', 'sweep.js']) cpSync(new URL('../src/' + f, import.meta.url), new URL(f, out));
console.log('built public/ (engine copied to public/src)');
