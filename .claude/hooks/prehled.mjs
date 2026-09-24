// SessionStart hook: na začátku session vypíše manažerovi stav úkolů podle štítků.
// Když gh nefunguje, mlčí, aby nezablokoval start session.
import { execFileSync } from 'node:child_process';

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
  ['pro-vlastnika', 'Otázky pro vlastníka'],
  ['stav:ceka-na-vlastnika', 'Čeká na schválení vlastníkem'],
  ['blokovano', 'Blokováno'],
  ['stav:revize', 'V revizi'],
  ['stav:rozpracovano', 'Rozpracováno'],
  ['stav:pripraveno', 'Připraveno'],
];

const radky = [];
for (const [stitek, nazev] of SEKCE) {
  const seznam = issues(stitek);
  if (seznam === null) process.exit(0);
  if (seznam.length) radky.push(`${nazev} (${seznam.length}):`, ...seznam.map((s) => `  ${s}`));
}
console.log(radky.length
  ? ['STAV TÝMU (z GitHub issues):', ...radky, 'Manažer: shrň vlastníkovi otázky (nejvýše 5 bodů) a navrhni další krok.'].join('\n')
  : 'STAV TÝMU: žádné otevřené úkoly.');
