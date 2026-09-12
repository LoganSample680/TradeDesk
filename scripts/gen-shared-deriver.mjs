#!/usr/bin/env node
// ONE DERIVER, TWO RUNTIMES (owner 2026-09-11).
//
// "any update to deriver logic means changes port to the server side right
// away, no need to look at duplicate code."
//
// js/geo-derive.js is the rules (CLAUDE.md 17). It is a plain browser script:
// no imports, no exports, no window, no DOM, 1,700 lines of pure arithmetic.
// Deno needs an ES module, so this writes one: the SAME bytes with an export
// line appended, and nothing else changed. Not a port, not a copy somebody
// maintains, a build artifact.
//
// `node scripts/gen-shared-deriver.mjs --check` fails when the generated file
// does not match what this would write, and migration-lint runs it on every
// PR, so editing js/geo-derive.js without regenerating cannot reach main.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'js', 'geo-derive.js');
const OUT = path.join(root, 'supabase', 'functions', '_shared', 'geo-derive.mjs');

// Everything the server needs to turn a day of raw events into rows. Keep this
// list minimal: a symbol exported here is a symbol the edge function may lean
// on, and the point is that it leans on the rules, not on the internals.
const EXPORTS = ['geoDeriveDay', 'geoDeriveRows', 'geoFenceAt', 'geoSpanClaim'];

const src = fs.readFileSync(SRC, 'utf8');
for (const name of EXPORTS) {
  if (!new RegExp('^function ' + name + '\\s*\\(', 'm').test(src)) {
    console.error(`gen-shared-deriver: js/geo-derive.js no longer declares ${name}() at the top level.`);
    process.exit(2);
  }
}
const banner = `// GENERATED FILE. DO NOT EDIT.
//
// Built from js/geo-derive.js by scripts/gen-shared-deriver.mjs. That file is
// the one deriver (CLAUDE.md 17); this is the same bytes with an export line,
// so the phone and the server can never be running different rules. Change the
// rules there, run the generator, commit both.
`;
const out = banner + src + `\nexport { ${EXPORTS.join(', ')} };\n`;

if (process.argv.includes('--check')) {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (have === out) { console.log('gen-shared-deriver: in sync'); process.exit(0); }
  console.error('gen-shared-deriver: supabase/functions/_shared/geo-derive.mjs is STALE.');
  console.error('js/geo-derive.js changed without regenerating it, so the server would');
  console.error('be deriving by older rules than the phone. Run:');
  console.error('  node scripts/gen-shared-deriver.mjs');
  console.error('and commit the result alongside your change.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log(`gen-shared-deriver: wrote ${path.relative(root, OUT)} (${out.length} bytes, exports ${EXPORTS.join(', ')})`);
