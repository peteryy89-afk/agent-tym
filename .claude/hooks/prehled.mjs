// SessionStart hook: na začátku session vypíše manažerovi stav úkolů podle štítků.
// Když gh nefunguje, vypíše jen režim, aby nezablokoval start session.
import { execFileSync } from 'node:child_process';
import { jeNoc } from './rezim.mjs';

function issues(stitek) {
  try {
    const vystup = execFileSync('gh', ['issue', 'list', '--state', 'open', '--label', stitek, '--limit', '50',
      '--json', 'number,title', '--jq', '.[] | "#\\(.number) \\(.title)"'], { encoding: 'utf8', timeout: 15000 });
    return vystup.split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

const SEKCE = [
  ['ranni-zprava', 'Ranní zpráva noční směny'],
  ['pro-vlastnika', 'Otázky pro vlastníka'],
  ['stav:ceka-na-vlastnika', 'Čeká na schválení vlastníkem'],
  ['blokovano', 'Blokováno'],
  ['stav:revize', 'V revizi'],
  ['stav:rozpracovano', 'Rozpracováno'],
  ['stav:pripraveno', 'Připraveno'],
  ['noc:ano', 'Ve frontě na noční směnu'],
];

// Režim vypíše vždy, i když gh nefunguje: vlastník tak hned vidí, že mu chybí denní režim.
console.log(jeNoc()
  ? 'REŽIM: noc (pojistky noční směny, nic se neslučuje). Pro práci s vlastníkem chybí AGENT_TYM_DEN=1 v .claude/settings.local.json.'
  : 'REŽIM: den.');

const radky = [];
for (const [stitek, nazev] of SEKCE) {
  const seznam = issues(stitek);
  if (seznam === null) process.exit(0);
  if (seznam.length) radky.push(`${nazev} (${seznam.length}):`, ...seznam.map((s) => `  ${s}`));
}
console.log(radky.length
  ? ['STAV TÝMU (z GitHub issues):', ...radky, 'Manažer: shrň vlastníkovi otázky (nejvýše 5 bodů) a navrhni další krok.'].join('\n')
  : 'STAV TÝMU: žádné otevřené úkoly.');
