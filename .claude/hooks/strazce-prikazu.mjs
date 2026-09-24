// PreToolUse hook pro Bash: blokuje nebezpečné příkazy (PROCES.md, sekce 8).
// Druhá vrstva ochrany: hledání textu v příkazu jde obejít, obcházení je porušení procesu.
// Hlavní pojistka je ochrana větve main na GitHubu (PROCES.md, sekce 6), tohle je druhá vrstva.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CHRANENE_CESTY = String.raw`(PROCES\.md|CLAUDE\.md|\.gitleaks\.toml|\.claude[\\/]|\.github[\\/])`;

const ZAKAZANE = [
  [/\bgit\b[^|;&]*\bpush\b[^|;&]*(\s--force\b|\s--force-with-lease\b|\s-[a-zA-Z]*f\b|\s\+\S+)/, 'Force push je zakázaný.'],
  [/--no-verify\b/, 'Přeskočení git hooků (--no-verify) je zakázané.'],
  [/\bgit\b[^|;&]*\bpush\b[^|;&]*(\s(origin\s+)?|:)(refs\/heads\/)?(main|master)\b/, 'Přímý push do main je zakázaný. Použij větev a PR.'],
  [/\bgh\s+repo\s+(edit|delete|rename|archive)\b/, 'Změna nastavení repozitáře je větší akce pro vlastníka.'],
  [/\bgh\s+(secret|gist|auth|ssh-key|gpg-key)\b/, 'Práce s tajnými klíči, gisty a přihlášením je zakázaná.'],
  [/(^|[\s'"/=<>])\.env(\.[\w.-]+)?\b/, 'Soubory .env agenti nečtou ani nezapisují.'],
  [/\bgh\b[^|;&]*\bapi\b[^|;&]*\/merges?\b/, 'Sloučení přes gh api obchází kontrolu CI. Použij gh pr merge <číslo>.'],
  [/\bgh\b[^|;&]*\bapi\b[^|;&]*\bgraphql\b[\s\S]*\bmergePullRequest\b/, 'Sloučení přes GraphQL obchází kontrolu CI. Použij gh pr merge <číslo>.'],
];

const DOTAZ = [
  [/\bgh\s+api\b[^|;&]*(-X|--method)[\s=]*(DELETE|PUT|PATCH|POST)\b/i, 'Zápis přes gh api obchází proces. Schvaluje vlastník.'],
  [/\bgh\s+api\b[^|;&]*\bgraphql\b[\s\S]*\bmutation\b/i, 'GraphQL mutace obchází proces. Schvaluje vlastník.'],
  // gh api s poli bez -X posílá POST. Čtení přes -X GET zůstává bez dotazu.
  [/\bgh\s+api\b(?![^|;&]*(-X|--method)[\s=]*GET\b)[^|;&]*\s(-f|-F|--field|--raw-field|--input)\b/i, 'gh api s poli nebo vstupem je zápis. Schvaluje vlastník.'],
  [/\b(npm|pnpm|yarn)\s+(install|i|add)\s+\S/, 'Nová závislost je větší akce (PROCES.md, sekce 5).'],
  [/\bpip3?\s+install\b/, 'Nová závislost je větší akce (PROCES.md, sekce 5).'],
  [/schvaleno-vlastnikem/, 'Štítek schvaleno-vlastnikem smí dát jen vlastník. Potvrď, jen pokud jsi to právě schválil ty.'],
  [new RegExp(String.raw`(\bsed\s+(-\w*\s+)*-i|\btee\b|\bcp\b|\bmv\b|\brm\b|>)[^|;&]*` + CHRANENE_CESTY), 'Zápis do chráněného souboru přes příkazovou řádku. Změnu schvaluje vlastník (PROCES.md, sekce 6).'],
];

// Náhrada ochrany větve z GitHub Pro: sloučit jde jen PR se zelenou CI (PROCES.md, sekce 4).
const ZELENA = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);
const MERGE = /\bgh(\.exe)?\s+pr\s+["']?merge\b[^|;&\n]*/g;

function posudMerge(prikaz, zjistiPR) {
  const vyskyty = [...prikaz.matchAll(MERGE)].map((m) => m[0]);
  for (const merge of vyskyty) {
    if (/\s(-R|--repo)\b|\s--admin\b|\s--auto\b/.test(merge))
      return { rozhodnuti: 'deny', duvod: 'gh pr merge s -R, --admin nebo --auto je zakázaný (obchází kontrolu CI).' };
    const cislo = merge.match(/merge["']?\s+#?(\d+)\b/)?.[1];
    if (!cislo) return { rozhodnuti: 'deny', duvod: 'U gh pr merge uveď číslo PR hned za merge, aby šly ověřit štítky a CI.' };
    const pr = zjistiPR(cislo);
    if (pr === null) return { rozhodnuti: 'ask', duvod: `Nepodařilo se ověřit štítky a CI PR #${cislo}.` };
    if (!pr.kontroly.length) return { rozhodnuti: 'deny', duvod: `PR #${cislo} nemá žádnou kontrolu CI. Počkej, až CI proběhne.` };
    const cervene = pr.kontroly.filter((k) => !ZELENA.has(k.vysledek));
    if (cervene.length)
      return { rozhodnuti: 'deny', duvod: `CI PR #${cislo} není zelená: ${cervene.map((k) => `${k.nazev}=${k.vysledek || 'běží'}`).join(', ')}.` };
    if (pr.stitky.includes('vetsi-akce') && !pr.stitky.includes('schvaleno-vlastnikem'))
      return { rozhodnuti: 'deny', duvod: `PR #${cislo} je větší akce bez štítku schvaleno-vlastnikem.` };
  }
  return null;
}

// Každý git push musí jmenovat vzdálený repozitář i větev a cílem nesmí být main.
// Bez výslovné větve by šlo pushnout main, na který se agent přepnul dřív v témže příkazu.
function posudPush(prikaz) {
  for (const [, zbytek] of prikaz.matchAll(/\bgit\s+push\b([^|;&\n]*)/g)) {
    const argumenty = zbytek.replace(/["']/g, '').trim().split(/\s+/).filter(Boolean);
    if (argumenty.some((a) => /^--(all|mirror)$/.test(a)))
      return { rozhodnuti: 'deny', duvod: 'git push --all a --mirror jsou zakázané.' };
    const [, ...refspecy] = argumenty.filter((a) => !a.startsWith('-'));
    if (!refspecy.length)
      return { rozhodnuti: 'deny', duvod: 'U git push uveď repozitář a větev: git push origin <větev>.' };
    const cile = refspecy.map((r) => r.split(':').pop().replace(/^refs\/heads\//, ''));
    if (cile.some((c) => /^(main|master|HEAD)$/i.test(c)))
      return { rozhodnuti: 'deny', duvod: 'Přímý push do main je zakázaný. Použij větev a PR.' };
  }
  return null;
}

export function posud(prikaz, zjistiPR = infoPR) {
  for (const [vzor, duvod] of ZAKAZANE) if (vzor.test(prikaz)) return { rozhodnuti: 'deny', duvod };
  const push = posudPush(prikaz);
  if (push) return push;
  const merge = posudMerge(prikaz, zjistiPR);
  if (merge) return merge;
  for (const [vzor, duvod] of DOTAZ) if (vzor.test(prikaz)) return { rozhodnuti: 'ask', duvod };
  return null;
}

function infoPR(cislo) {
  try {
    const data = JSON.parse(execFileSync('gh', ['pr', 'view', cislo, '--json', 'labels,statusCheckRollup'], { encoding: 'utf8', timeout: 20000 }));
    return {
      stitky: data.labels.map((s) => s.name),
      kontroly: data.statusCheckRollup.map((k) => ({ nazev: k.name ?? k.context, vysledek: k.conclusion || k.state || '' })),
    };
  } catch {
    return null;
  }
}

async function main() {
  let vstup = '';
  for await (const kus of process.stdin) vstup += kus;
  let prikaz;
  try {
    prikaz = JSON.parse(vstup).tool_input?.command ?? '';
  } catch {
    vystup({ rozhodnuti: 'ask', duvod: 'Strážce příkazů nedostal platný vstup. Příkaz nešlo ověřit.' });
    return;
  }
  const vysledek = posud(prikaz);
  if (vysledek) vystup(vysledek);
}

function vystup({ rozhodnuti, duvod }) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: rozhodnuti, permissionDecisionReason: duvod },
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
