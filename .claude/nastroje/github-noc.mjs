// GitHub pro noční směnu (NOCNI-SMENA.md).
// Cloud Claude Code nepustí GraphQL, takže gh issue/pr nefungují a zbývá REST přes gh api.
// Zápis přes gh api hook v noci zamítá. Noční směna proto zapisuje jen tímto nástrojem,
// který umí jen povolené akce a pravidla hlídá sám: jen issues od vlastníka, jen stavové
// štítky, PR jen z větví claude/ukol-*, komentáře jen od vlastníka.
// Nástroj leží v chráněné složce .claude/. Hook zamítá běžné způsoby zápisu do ní, skript
// (node -e) ale nezachytí. Změnu pak ráno ukáže jen PR a kontrola chranene-soubory.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SMI_PRIDAT = /^(stav:[\w-]+|blokovano|pro-vlastnika)$/;
export const SMI_ODEBRAT = /^(stav:[\w-]+|noc:ano)$/;
export const VETEV = /^claude\/ukol-\d+-[\w.-]+$/;
export const MAX_UKOLU = 3;
export const POVINNE_KONTROLY = ['testy', 'gitleaks'];
const VYLUCUJICI = ['vetsi-akce', 'blokovano', 'pro-vlastnika'];
const ZELENA = new Set(['success', 'skipped', 'neutral']);
const MAX_TEXT = 20000;

// Kořen repozitáře, ve kterém nástroj leží (.claude/nastroje/ → dvě úrovně nahoru).
const KOREN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Repozitář jen z origin repozitáře, ve kterém nástroj leží. GH_REPO záměrně ne:
// proměnnou si agent nastaví před příkaz a poslal by nástroj do jiného repozitáře.
export function repozitar(origin = () => execFileSync('git', ['-C', KOREN, 'remote', 'get-url', 'origin'], { encoding: 'utf8' })) {
  const shoda = origin().trim().match(/github\.com[/:]([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+?)(\.git)?$/);
  if (!shoda || shoda[2].includes('..')) throw new Error('Origin nemíří na repozitář na GitHubu.');
  return `${shoda[1]}/${shoda[2]}`;
}

// Texty pro GitHub jen z jedné pracovní složky, aby nástroj nešel použít ke zveřejnění
// libovolného souboru (klíče, /proc/self/environ).
export const SLOZKA_TEXTU = process.platform === 'win32' ? path.join(os.tmpdir(), 'agent-tym-noc') : '/tmp/agent-tym-noc';
const TAJNE = [
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/, /\bsk-ant-[A-Za-z0-9_-]{20,}/,
  /\bsk-[A-Za-z0-9]{32,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bxox[abpr]-[A-Za-z0-9-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export function nactiText(cesta, slozka = SLOZKA_TEXTU) {
  const skutecnaCesta = (p, chyba) => {
    try {
      return fs.realpathSync(p);
    } catch {
      throw new Error(chyba);
    }
  };
  const koren = skutecnaCesta(slozka, `Texty pro GitHub čtu jen ze složky ${slozka}/, ta zatím neexistuje.`);
  const skutecna = skutecnaCesta(cesta, `Soubor ${cesta} neexistuje. Texty piš do ${slozka}/.`);
  if (!skutecna.startsWith(koren + path.sep)) throw new Error(`Texty pro GitHub čtu jen ze složky ${slozka}/.`);
  const obsah = fs.readFileSync(skutecna, 'utf8');
  if (TAJNE.some((vzor) => vzor.test(obsah))) throw new Error('Text vypadá, že obsahuje tajný klíč. Neodesláno.');
  return obsah;
}

// Datum v Praze ve tvaru RRRR-MM-DD, podle něj se jmenuje ranní zpráva.
export const dnes = (datum = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(datum);

const stitky = (issue) => issue.labels.map((s) => (typeof s === 'string' ? s : s.name));
const stejny = (a, b) => a.toLowerCase() === b.toLowerCase();

// Fronta noční směny z otevřených issues. Používá ji i Velín, aby ukazoval stejné úkoly.
export function vyberFrontu(otevrene, vlastnik) {
  return otevrene
    .filter((i) => !i.pull_request && stejny(i.user?.login ?? '', vlastnik))
    .filter((i) => stitky(i).includes('noc:ano') && stitky(i).includes('stav:pripraveno'))
    .filter((i) => !stitky(i).some((s) => VYLUCUJICI.includes(s)))
    .sort((a, b) => a.number - b.number)
    .slice(0, MAX_UKOLU)
    .map((i) => ({ cislo: i.number, nazev: i.title }));
}

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

  // V noci pracuje jen na vlastních věcech: issues vlastníka a PR z nočních větví tohoto repozitáře.
  function overCil(n, { jenPR = false } = {}) {
    const c = cislo(n);
    const issue = gh.jeden(`repos/${repo}/issues/${c}`);
    if (issue.pull_request) {
      const hlava = gh.jeden(`repos/${repo}/pulls/${c}`).head;
      if (!VETEV.test(hlava.ref) || hlava.repo?.full_name !== repo)
        throw new Error(`PR #${c} není z noční větve claude/ukol-* tohoto repozitáře. V noci na něj nesahej.`);
    } else if (jenPR) {
      throw new Error(`#${c} není PR.`);
    } else if (!stejny(issue.user.login, vlastnik())) {
      throw new Error(`#${c} nezaložil vlastník repozitáře. V noci ho nečti ani needituj.`);
    }
    return c;
  }

  return {
    stav() {
      const otevrene = gh.seznam(`repos/${repo}/issues?state=open&per_page=100`).filter((i) => !i.pull_request);
      const zpravy = gh.seznam(`repos/${repo}/issues?state=all&labels=ranni-zprava&per_page=100`);
      const fronta = vyberFrontu(otevrene, vlastnik());
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
      return gh.seznam(`repos/${repo}/issues/${overCil(n)}/comments?per_page=100`)
        .filter((k) => stejny(k.user.login, vlastnik()))
        .map((k) => ({ kdy: k.created_at, text: k.body }));
    },

    diff(pr) {
      return gh.surovy(`repos/${repo}/pulls/${overCil(pr, { jenPR: true })}`, 'application/vnd.github.diff');
    },

    stitky(n, pridat = [], odebrat = []) {
      for (const s of pridat) if (!SMI_PRIDAT.test(s)) throw new Error(`V noci nesmíš přidat štítek ${s}.`);
      for (const s of odebrat) if (!SMI_ODEBRAT.test(s)) throw new Error(`V noci nesmíš odebrat štítek ${s}.`);
      if (!pridat.length && !odebrat.length) throw new Error('Zadej --pridat nebo --odebrat.');
      // Přidáním neexistujícího štítku by ho GitHub založil. V noci jen existující.
      if (pridat.length) {
        const existujici = new Set(gh.seznam(`repos/${repo}/labels?per_page=100`).map((s) => s.name));
        for (const s of pridat) if (!existujici.has(s)) throw new Error(`Štítek ${s} v repozitáři neexistuje. V noci nové štítky nezakládej.`);
      }
      const c = overCil(n);
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
      const k = gh.jeden(`repos/${repo}/issues/${overCil(n)}/comments`, 'POST', { body: text(obsah) });
      return { url: k.html_url };
    },

    pr(vetev, nazev, obsah) {
      if (!VETEV.test(vetev)) throw new Error('PR v noci jen z větve claude/ukol-<číslo>-<popis>.');
      const p = gh.jeden(`repos/${repo}/pulls`, 'POST', { title: text(nazev), head: vetev, base: 'main', body: text(obsah) });
      return { cislo: p.number, url: p.html_url };
    },

    // Čeká nejvýše `limit` sekund (pod limitem 10 minut nástroje Bash), dokud neskončí
    // všechny kontroly CI a mezi nimi i povinné.
    kontroly(pr, { limit = 540, krok = 30, povinne = POVINNE_KONTROLY } = {}) {
      const konec = ted() + limit * 1000;
      for (;;) {
        const sha = gh.jeden(`repos/${repo}/pulls/${cislo(pr)}`).head.sha;
        const behy = gh.jeden(`repos/${repo}/commits/${sha}/check-runs?per_page=100`).check_runs
          .map((b) => ({ nazev: b.name, stav: b.status, vysledek: b.conclusion }));
        const hotovo = povinne.every((n) => behy.some((b) => b.nazev === n)) && behy.every((b) => b.stav === 'completed');
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
  kontroly <pr>                     počká na CI (nejvýše 9 min), kód 0 = zelená
  zprava <soubor>                   zavře starou a založí dnešní ranní zprávu
Texty piš nástrojem Write do složky ${SLOZKA_TEXTU}/, jiné soubory nástroj neodešle.
Bash spouštěj s časovým limitem 600000 ms, jinak ho kontroly nestihnou.`;

const seznamZ = (argumenty, prepinac) => {
  const i = argumenty.indexOf(prepinac);
  return i === -1 ? [] : (argumenty[i + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
};

export function spust(argumenty, nastroj, soubor = nactiText) {
  const [prikaz, ...zbytek] = argumenty;
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
