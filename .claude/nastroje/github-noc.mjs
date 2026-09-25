// GitHub pro noční směnu (NOCNI-SMENA.md).
// Cloud Claude Code nepustí GraphQL, takže gh issue/pr nefungují a zbývá REST přes gh api.
// Zápis přes gh api hook v noci zamítá. Noční směna proto zapisuje jen tímto nástrojem,
// který umí jen povolené akce a pravidla hlídá sám: jen issues od vlastníka, jen stavové
// štítky, PR jen z větví claude/ukol-*, komentáře jen od vlastníka.
// Nástroj leží v chráněné složce .claude/, v noci ho agent nemůže měnit.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SMI_PRIDAT = /^(stav:[\w-]+|blokovano|pro-vlastnika)$/;
export const SMI_ODEBRAT = /^(stav:[\w-]+|noc:ano)$/;
export const VETEV = /^claude\/ukol-\d+-[\w.-]+$/;
export const MAX_UKOLU = 3;
const VYLUCUJICI = ['vetsi-akce', 'blokovano', 'pro-vlastnika'];
const ZELENA = new Set(['success', 'skipped', 'neutral']);
const MAX_TEXT = 20000;

export function repozitar(prostredi = process.env, origin = () => execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' })) {
  if (/^[\w.-]+\/[\w.-]+$/.test(prostredi.GH_REPO ?? '')) return prostredi.GH_REPO;
  const shoda = origin().trim().match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(\.git)?$/);
  if (!shoda) throw new Error('Nepodařilo se zjistit repozitář (chybí GH_REPO a origin nemíří na GitHub).');
  return `${shoda[1]}/${shoda[2]}`;
}

// Datum v Praze ve tvaru RRRR-MM-DD, podle něj se jmenuje ranní zpráva.
export const dnes = (datum = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(datum);

const stitky = (issue) => issue.labels.map((s) => (typeof s === 'string' ? s : s.name));
const stejny = (a, b) => a.toLowerCase() === b.toLowerCase();

function cislo(hodnota) {
  if (!/^\d+$/.test(String(hodnota))) throw new Error(`Neplatné číslo issue nebo PR: ${hodnota}`);
  return Number(hodnota);
}

function text(hodnota) {
  if (!hodnota.trim()) throw new Error('Text je prázdný.');
  if (hodnota.length > MAX_TEXT) throw new Error(`Text je delší než ${MAX_TEXT} znaků.`);
  return hodnota;
}

// gh: { seznam(cesta) → pole, jeden(cesta, metoda, data) → objekt, surovy(cesta, accept) → text }
export function vytvorNastroj(gh, repo, { spi = () => {}, ted = () => Date.now() } = {}) {
  let vlastnikCache;
  const vlastnik = () => (vlastnikCache ??= gh.jeden(`repos/${repo}`).owner.login);

  function issueOdVlastnika(n) {
    const issue = gh.jeden(`repos/${repo}/issues/${cislo(n)}`);
    if (!stejny(issue.user.login, vlastnik())) throw new Error(`#${n} nezaložil vlastník repozitáře. V noci ho nečti ani needituj.`);
    return issue;
  }

  return {
    stav() {
      const otevrene = gh.seznam(`repos/${repo}/issues?state=open&per_page=100`).filter((i) => !i.pull_request);
      const zpravy = gh.seznam(`repos/${repo}/issues?state=all&labels=ranni-zprava&per_page=100`);
      const fronta = otevrene
        .filter((i) => stejny(i.user.login, vlastnik()))
        .filter((i) => stitky(i).includes('noc:ano') && stitky(i).includes('stav:pripraveno'))
        .filter((i) => !stitky(i).some((s) => VYLUCUJICI.includes(s)))
        .sort((a, b) => a.number - b.number)
        .slice(0, MAX_UKOLU)
        .map((i) => ({ cislo: i.number, nazev: i.title }));
      return {
        vlastnik: vlastnik(),
        dnes: dnes(),
        nocStop: otevrene.some((i) => stitky(i).includes('noc:stop')),
        dnesniZprava: zpravy.some((i) => i.title === `Ranní zpráva ${dnes()}`),
        fronta,
      };
    },

    issue(n) {
      const i = issueOdVlastnika(n);
      return { cislo: i.number, nazev: i.title, stitky: stitky(i), text: i.body ?? '' };
    },

    komentare(n) {
      return gh.seznam(`repos/${repo}/issues/${cislo(n)}/comments?per_page=100`)
        .filter((k) => stejny(k.user.login, vlastnik()))
        .map((k) => ({ kdy: k.created_at, text: k.body }));
    },

    diff(pr) {
      return gh.surovy(`repos/${repo}/pulls/${cislo(pr)}`, 'application/vnd.github.diff');
    },

    stitky(n, pridat = [], odebrat = []) {
      for (const s of pridat) if (!SMI_PRIDAT.test(s)) throw new Error(`V noci nesmíš přidat štítek ${s}.`);
      for (const s of odebrat) if (!SMI_ODEBRAT.test(s)) throw new Error(`V noci nesmíš odebrat štítek ${s}.`);
      if (!pridat.length && !odebrat.length) throw new Error('Zadej --pridat nebo --odebrat.');
      const c = cislo(n);
      if (pridat.length) gh.jeden(`repos/${repo}/issues/${c}/labels`, 'POST', { labels: pridat });
      for (const s of odebrat) {
        try {
          gh.jeden(`repos/${repo}/issues/${c}/labels/${encodeURIComponent(s)}`, 'DELETE');
        } catch {
          // štítek na issue nebyl, výsledek je stejný
        }
      }
      return { cislo: c, pridano: pridat, odebrano: odebrat };
    },

    komentar(n, obsah) {
      const k = gh.jeden(`repos/${repo}/issues/${cislo(n)}/comments`, 'POST', { body: text(obsah) });
      return { url: k.html_url };
    },

    pr(vetev, nazev, obsah) {
      if (!VETEV.test(vetev)) throw new Error('PR v noci jen z větve claude/ukol-<číslo>-<popis>.');
      const p = gh.jeden(`repos/${repo}/pulls`, 'POST', { title: text(nazev), head: vetev, base: 'main', body: text(obsah) });
      return { cislo: p.number, url: p.html_url };
    },

    // Čeká nejvýše `limit` sekund, dokud všechny kontroly CI neskončí.
    kontroly(pr, { limit = 1200, krok = 30 } = {}) {
      const konec = ted() + limit * 1000;
      for (;;) {
        const sha = gh.jeden(`repos/${repo}/pulls/${cislo(pr)}`).head.sha;
        const behy = gh.jeden(`repos/${repo}/commits/${sha}/check-runs?per_page=100`).check_runs
          .map((b) => ({ nazev: b.name, stav: b.status, vysledek: b.conclusion }));
        const hotovo = behy.length > 0 && behy.every((b) => b.stav === 'completed');
        if (hotovo) return { zelena: behy.every((b) => ZELENA.has(b.vysledek)), behy };
        if (ted() >= konec) return { zelena: false, casovyLimit: true, behy };
        spi(krok);
      }
    },

    zprava(obsah) {
      const nazev = `Ranní zpráva ${dnes()}`;
      const zpravy = gh.seznam(`repos/${repo}/issues?state=all&labels=ranni-zprava&per_page=100`);
      if (zpravy.some((i) => i.title === nazev)) throw new Error(`${nazev} už existuje. Jedna směna za noc.`);
      for (const stara of zpravy.filter((i) => i.state === 'open' && stejny(i.user.login, vlastnik())))
        gh.jeden(`repos/${repo}/issues/${stara.number}`, 'PATCH', { state: 'closed' });
      const i = gh.jeden(`repos/${repo}/issues`, 'POST', { title: nazev, body: text(obsah), labels: ['ranni-zprava', 'pro-vlastnika'] });
      return { cislo: i.number, url: i.html_url };
    },
  };
}

function ghCli() {
  const spust = (argumenty, vstup) => execFileSync('gh', argumenty, { encoding: 'utf8', input: vstup, maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
  return {
    seznam: (cesta) => JSON.parse(spust(['api', '--paginate', '--slurp', cesta])).flat(),
    jeden: (cesta, metoda = 'GET', data) => {
      const vystup = data === undefined
        ? spust(['api', '--method', metoda, cesta])
        : spust(['api', '--method', metoda, cesta, '--input', '-'], JSON.stringify(data));
      return vystup.trim() ? JSON.parse(vystup) : {};
    },
    surovy: (cesta, accept) => spust(['api', '-H', `Accept: ${accept}`, cesta]),
  };
}

const NAPOVEDA = `Použití: node .claude/nastroje/github-noc.mjs <příkaz>
  stav                              vlastník, noc:stop, dnešní zpráva, fronta (nejvýše ${MAX_UKOLU})
  issue <č>                         text issue (jen od vlastníka)
  komentare <č>                     komentáře vlastníka
  diff <pr>                         změny v PR
  stitky <č> [--pridat a,b] [--odebrat c]
  komentar <č> <soubor>             komentář z textového souboru
  pr <větev> <soubor> <název…>      PR z claude/ukol-* do main, popis ze souboru
  kontroly <pr>                     počká na CI (nejvýše 20 min), kód 0 = zelená
  zprava <soubor>                   zavře starou a založí dnešní ranní zprávu
Delší texty piš nástrojem Write do souboru, ne do příkazu.`;

const seznamZ = (argumenty, prepinac) => {
  const i = argumenty.indexOf(prepinac);
  return i === -1 ? [] : (argumenty[i + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
};

export function spust(argumenty, nastroj) {
  const [prikaz, ...zbytek] = argumenty;
  const soubor = (cesta) => fs.readFileSync(cesta, 'utf8');
  switch (prikaz) {
    case 'stav': return nastroj.stav();
    case 'issue': return nastroj.issue(zbytek[0]);
    case 'komentare': return nastroj.komentare(zbytek[0]);
    case 'diff': return nastroj.diff(zbytek[0]);
    case 'stitky': return nastroj.stitky(zbytek[0], seznamZ(zbytek, '--pridat'), seznamZ(zbytek, '--odebrat'));
    case 'komentar': return nastroj.komentar(zbytek[0], soubor(zbytek[1]));
    case 'pr': return nastroj.pr(zbytek[0], zbytek.slice(2).join(' '), soubor(zbytek[1]));
    case 'kontroly': return nastroj.kontroly(zbytek[0]);
    case 'zprava': return nastroj.zprava(soubor(zbytek[0]));
    default: return null;
  }
}

function main() {
  const argumenty = process.argv.slice(2);
  try {
    const spi = (s) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, s * 1000);
    const vysledek = spust(argumenty, vytvorNastroj(ghCli(), repozitar(), { spi }));
    if (vysledek === null) {
      console.log(NAPOVEDA);
      process.exitCode = argumenty[0] === '--help' ? 0 : 1;
      return;
    }
    console.log(typeof vysledek === 'string' ? vysledek : JSON.stringify(vysledek, null, 2));
    if (argumenty[0] === 'kontroly' && !vysledek.zelena) process.exitCode = 1;
  } catch (chyba) {
    const podrobnosti = chyba.stderr?.toString().trim() || chyba.message;
    console.error(`Chyba: ${podrobnosti.split('\n').slice(0, 3).join(' ')}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
