// Velín: místní přehled práce týmu. Kdo teď pracuje a na čem, stav úkolů a PR, co čeká na vlastníka
// a noční směna. Jen čte: stav se dál vede štítky na GitHubu.
// Zdroje: definice agentů (.claude/agents), GitHub REST přes `gh api` a záznam aktivity
// z hooku zaznam-aktivity (.agent-tym/aktivita.jsonl, jen tento počítač).
// Server poslouchá jen na 127.0.0.1, odpovídá jen na GET a stránka nemá žádný JavaScript.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { repozitar } from '../.claude/nastroje/github-noc.mjs';
import { SOUBOR as SOUBOR_ZAZNAMU } from '../.claude/hooks/zaznam-aktivity.mjs';

export const KOREN = fileURLToPath(new URL('../', import.meta.url));
export const PORT = 4380;
const OBNOVA_S = 30;
const KES_MS = 60_000;
const NEJASNE_MS = 6 * 3600_000;
const RELACE_MS = 12 * 3600_000;
const TYDEN_MS = 7 * 24 * 3600_000;
export const KONTROLY = ['testy', 'gitleaks', 'chranene-soubory'];
const STAVY = [
  ['stav:napad', 'Nápad'], ['stav:pripraveno', 'Připraveno'], ['stav:rozpracovano', 'Rozpracováno'],
  ['stav:revize', 'V revizi'], ['stav:ceka-na-vlastnika', 'Čeká na vlastníka'], ['blokovano', 'Blokováno'],
];
const NAZVY_TYMU = {
  produkt: 'Produkt', vyvoj: 'Vývoj', kvalita: 'Kvalita', provoz: 'Provoz', marketing: 'Marketing',
  objevovani: 'Objevování', revize: 'Revize', pravo: 'Právo', platforma: 'Platforma',
};

// ---------- agenti a týmy ----------

export function nactiAgenty(slozka = path.join(KOREN, '.claude', 'agents')) {
  return fs.readdirSync(slozka).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const text = fs.readFileSync(path.join(slozka, f), 'utf8').replace(/\r\n/g, '\n');
    const pole = {};
    for (const r of (text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '').split('\n')) {
      const i = r.indexOf(':');
      if (i > 0) pole[r.slice(0, i).trim()] = r.slice(i + 1).trim();
    }
    const clenove = pole.tools?.match(/Agent\(([^)]*)\)/)?.[1].split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    return { jmeno: pole.name ?? path.basename(f, '.md'), popis: pole.description ?? '', model: pole.model ?? '?', clenove };
  });
}

// Týmy podle `tools: Agent(...)` vedoucích, stejně jako je čte test/agenti.test.mjs.
export function sestavTymy(agenti) {
  const podleJmena = new Map(agenti.map((a) => [a.jmeno, a]));
  const zarazeni = new Set();
  const tymy = agenti.filter((a) => a.jmeno.endsWith('-vedouci')).map((v) => {
    const klic = v.jmeno.replace(/-vedouci$/, '');
    const clenove = [v, ...v.clenove.map((c) => podleJmena.get(c)).filter(Boolean)];
    for (const c of clenove) zarazeni.add(c.jmeno);
    return { nazev: NAZVY_TYMU[klic] ?? klic, vedouci: v.jmeno, clenove: clenove.map((c) => c.jmeno) };
  });
  // Pořadí jako v PROCES.md, sekce 1.
  const poradi = Object.values(NAZVY_TYMU);
  tymy.sort((a, b) => (poradi.indexOf(a.nazev) + 1 || 99) - (poradi.indexOf(b.nazev) + 1 || 99));
  const mimo = agenti.filter((a) => !zarazeni.has(a.jmeno)).map((a) => a.jmeno);
  if (mimo.length) tymy.push({ nazev: 'Mimo tým', vedouci: null, clenove: mimo });
  return tymy;
}

// Porušení řetězu velení (PROCES.md, sekce 1): manažer spouští jen vedoucí, vedoucí jen svůj tým,
// členové nikoho. Vestavěné agenty Claude Code (Explore, general-purpose) se nehodnotí.
export function mimoRetez(spustil, cil, tymy) {
  const nasi = new Set(tymy.flatMap((t) => t.clenove));
  if (!spustil || spustil === '?' || !nasi.has(cil)) return false;
  if (spustil === 'manažer') return !cil.endsWith('-vedouci');
  const tym = tymy.find((t) => t.vedouci === spustil);
  if (tym) return !tym.clenove.includes(cil) || cil === spustil;
  return nasi.has(spustil);
}

// ---------- záznam aktivity ----------

export function nactiZaznam(soubor = SOUBOR_ZAZNAMU) {
  const udalosti = [];
  for (const s of [soubor.replace(/\.jsonl$/, '.1.jsonl'), soubor]) {
    let text = '';
    try {
      text = fs.readFileSync(s, 'utf8');
    } catch {
      continue;
    }
    for (const r of text.split('\n')) {
      try {
        const u = JSON.parse(r);
        if (u && typeof u === 'object' && typeof u.udalost === 'string') udalosti.push(u);
      } catch {}
    }
  }
  return udalosti;
}

export function vyhodnotAktivitu(udalosti, ted = Date.now()) {
  const behy = new Map();
  const relace = new Map();
  const cekajici = [];
  for (const u of udalosti) {
    const t = Date.parse(u.cas);
    if (Number.isNaN(t)) continue;
    if (u.udalost === 'session-start') relace.set(u.session, { session: u.session, rezim: u.rezim, start: t, konec: null });
    else if (u.udalost === 'session-konec' && relace.has(u.session)) relace.get(u.session).konec = t;
    else if (u.udalost === 'spusteni') cekajici.push({ ...u, t });
    else if (u.udalost === 'start' && u.agent) {
      // Spuštění přes nástroj Agent nese popis a volajícího, start podagenta jeho ID. Páruje se
      // podle session a typu agenta, nejstarší nespárované spuštění do 2 minut.
      const i = cekajici.findIndex((c) => c.session === u.session && c.cil === u.typ && t >= c.t && t - c.t < 120_000);
      const sp = i >= 0 ? cekajici.splice(i, 1)[0] : null;
      behy.set(u.agent, {
        id: u.agent, typ: u.typ ?? '?', popis: sp?.popis ?? u.popis ?? null, model: sp?.model ?? null,
        rezim: u.rezim, start: t, konec: null,
        spustil: sp ? (sp.volajiciTyp ?? (sp.volajici ? '?' : 'manažer')) : null,
      });
    } else if (u.udalost === 'konec' && behy.has(u.agent)) behy.get(u.agent).konec = t;
  }
  const vse = [...behy.values()].sort((a, b) => b.start - a.start);
  const posledni = {};
  const zaTyden = {};
  for (const b of vse) {
    const k = b.konec ?? b.start;
    if (!(posledni[b.typ] >= k)) posledni[b.typ] = k;
    if (ted - b.start <= TYDEN_MS) zaTyden[b.typ] = (zaTyden[b.typ] ?? 0) + 1;
  }
  return {
    bezi: vse.filter((b) => !b.konec && ted - b.start <= NEJASNE_MS),
    nejasne: vse.filter((b) => !b.konec && ted - b.start > NEJASNE_MS),
    relace: [...relace.values()].filter((r) => !r.konec && ted - r.start <= RELACE_MS),
    historie: vse.slice(0, 25),
    posledni,
    zaTyden,
  };
}

// ---------- GitHub ----------

function ghApi(cesta) {
  return new Promise((hotovo, chyba) => {
    execFile('gh', ['api', cesta], { timeout: 15000, maxBuffer: 20e6, windowsHide: true }, (e, vystup) => {
      if (e) return chyba(e);
      try {
        hotovo(JSON.parse(vystup));
      } catch (e2) {
        chyba(e2);
      }
    });
  });
}

const stitky = (x) => (x.labels ?? []).map((l) => l.name);

export async function nactiGitHub(repo, api = ghApi) {
  const [info, issues, prs, zpravy] = await Promise.all([
    api(`repos/${repo}`),
    api(`repos/${repo}/issues?state=open&per_page=100`),
    api(`repos/${repo}/pulls?state=open&per_page=50`),
    api(`repos/${repo}/issues?state=all&labels=ranni-zprava&per_page=3`),
  ]);
  const pr = await Promise.all(prs.map(async (p) => {
    let kontroly = null;
    if (/^[0-9a-f]{40}$/.test(p.head?.sha ?? '')) {
      try {
        const vysledek = await api(`repos/${repo}/commits/${p.head.sha}/check-runs?per_page=100`);
        // Stejná kontrola může běžet víckrát (např. po přidání štítku), platí nejnovější.
        const nejnovejsi = {};
        for (const k of vysledek.check_runs ?? []) {
          if (KONTROLY.includes(k.name) && !(nejnovejsi[k.name]?.id > k.id)) nejnovejsi[k.name] = k;
        }
        kontroly = Object.fromEntries(Object.entries(nejnovejsi).map(([n, k]) => [n, k.status === 'completed' ? k.conclusion : k.status]));
      } catch {}
    }
    return { cislo: p.number, nazev: p.title, vetev: p.head?.ref ?? '', stitky: stitky(p), kontroly };
  }));
  return {
    vlastnik: info.owner?.login ?? null,
    issues: issues.filter((i) => !i.pull_request).map((i) => ({ cislo: i.number, nazev: i.title, stitky: stitky(i), autor: i.user?.login ?? null })),
    pr,
    zpravy: zpravy.filter((z) => !z.pull_request).map((z) => ({ cislo: z.number, nazev: z.title, stav: z.state, vytvoreno: z.created_at })),
  };
}

// ---------- stav pro stránku ----------

export function sestavStav({ agenti, udalosti, github, chybaGitHubu = null, repo = null, ted = Date.now() }) {
  const tymy = sestavTymy(agenti);
  const aktivita = vyhodnotAktivitu(udalosti, ted);
  const modely = Object.fromEntries(agenti.map((a) => [a.jmeno, a.model]));
  const tymAgenta = Object.fromEntries(tymy.flatMap((t) => t.clenove.map((c) => [c, t.nazev])));
  const doplnit = (b) => ({ ...b, model: b.model ?? modely[b.typ] ?? null, tym: tymAgenta[b.typ] ?? null, mimoRetez: mimoRetez(b.spustil, b.typ, tymy) });
  const stav = {
    cas: new Date(ted).toISOString(), repo, chybaGitHubu,
    tymy: tymy.map((t) => ({
      ...t,
      clenove: t.clenove.map((jmeno) => {
        const a = agenti.find((x) => x.jmeno === jmeno);
        return {
          jmeno, model: a.model, popis: a.popis,
          pracuje: aktivita.bezi.some((b) => b.typ === jmeno),
          naposledy: aktivita.posledni[jmeno] ? new Date(aktivita.posledni[jmeno]).toISOString() : null,
          zaTyden: aktivita.zaTyden[jmeno] ?? 0,
        };
      }),
    })),
    bezi: aktivita.bezi.map(doplnit),
    nejasne: aktivita.nejasne.map(doplnit),
    relace: aktivita.relace,
    historie: aktivita.historie.map(doplnit),
    github: null,
  };
  if (github) {
    const { issues, pr, vlastnik } = github;
    const ma = (x, s) => x.stitky.includes(s);
    stav.github = {
      vlastnik,
      sloupce: STAVY.map(([stitek, nazev]) => ({ stitek, nazev, issues: issues.filter((i) => ma(i, stitek)) }))
        .concat([{ stitek: null, nazev: 'Bez stavu', issues: issues.filter((i) => !STAVY.some(([s]) => ma(i, s)) && !ma(i, 'pro-vlastnika') && !ma(i, 'ranni-zprava')) }]),
      pr,
      proVlastnika: {
        issues: issues.filter((i) => ma(i, 'pro-vlastnika') || ma(i, 'ranni-zprava')),
        pr: pr.filter((p) => ma(p, 'stav:ceka-na-vlastnika') || (ma(p, 'vetsi-akce') && !ma(p, 'schvaleno-vlastnikem'))),
      },
      noc: {
        fronta: issues.filter((i) => i.autor === vlastnik && ma(i, 'noc:ano') && ma(i, 'stav:pripraveno')
          && !['vetsi-akce', 'blokovano', 'pro-vlastnika'].some((s) => ma(i, s))).slice(0, 3),
        stop: issues.filter((i) => ma(i, 'noc:stop')),
        zpravy: github.zpravy,
      },
    };
  }
  return stav;
}

// ---------- HTML ----------

export const e = (s) => String(s ?? '').replace(/[&<>"']/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[z]);

function kdy(iso, ted) {
  if (!iso) return '—';
  const s = Math.round((ted - Date.parse(iso)) / 1000);
  if (s < 60) return 'právě teď';
  if (s < 3600) return `před ${Math.round(s / 60)} min`;
  if (s < 86400) return `před ${Math.round(s / 3600)} h`;
  return `před ${Math.round(s / 86400)} d`;
}
const cas = (iso) => (iso ? new Date(iso).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', dateStyle: 'short', timeStyle: 'short' }) : '—');
const trvani = (b) => (b.konec ? `${Math.max(1, Math.round((b.konec - b.start) / 60000))} min` : 'běží');

function odkaz(stav, cislo, text) {
  if (!stav.repo || !Number.isInteger(cislo)) return e(text);
  return `<a href="https://github.com/${e(stav.repo)}/issues/${cislo}">${e(text)}</a>`;
}
const stitkyHtml = (s) => s.map((x) => `<span class="stitek">${e(x)}</span>`).join(' ');
const kontrolaHtml = (n, v) => {
  const trida = v === 'success' ? 'ok' : v === 'failure' || v === 'cancelled' || v === 'timed_out' ? 'chyba' : 'ceka';
  return `<span class="kontrola ${trida}">${e(n)}: ${e(v ?? 'nespuštěno')}</span>`;
};

function tabulkaBehu(behy, ted, { historie = false } = {}) {
  if (!behy.length) return '';
  const radky = behy.map((b) => `<tr>
    <td><b>${e(b.typ)}</b>${b.tym ? `<div class="mala">${e(b.tym)}</div>` : ''}</td>
    <td>${e(b.popis ?? '—')}</td>
    <td>${e(b.spustil ?? '—')}${b.mimoRetez ? ' <span class="kontrola chyba" title="Porušení řetězu velení (PROCES.md, sekce 1)">mimo řetěz</span>' : ''}</td>
    <td>${e(b.model ?? '—')}</td>
    <td>${e(b.rezim ?? '—')}</td>
    <td>${historie ? `${e(cas(new Date(b.start).toISOString()))}<div class="mala">${e(trvani(b))}</div>` : e(kdy(new Date(b.start).toISOString(), ted))}</td>
  </tr>`).join('');
  return `<div class="tabulka"><table><thead><tr><th>Agent</th><th>Úkol</th><th>Spustil</th><th>Model</th><th>Režim</th><th>${historie ? 'Začátek' : 'Od'}</th></tr></thead><tbody>${radky}</tbody></table></div>`;
}

export function vykresli(stav) {
  const ted = Date.parse(stav.cas);
  const gh = stav.github;
  const pocet = (n) => `<span class="cislo">${n}</span>`;
  const souhrn = [
    ['Pracuje teď', stav.bezi.length],
    ['Čeká na tebe', gh ? gh.proVlastnika.issues.length + gh.proVlastnika.pr.length : '?'],
    ['Rozpracováno', gh ? gh.sloupce.find((s) => s.stitek === 'stav:rozpracovano').issues.length : '?'],
    ['Na noc ve frontě', gh ? gh.noc.fronta.length : '?'],
  ].map(([n, v]) => `<div class="karta souhrn">${pocet(e(v))}<div>${e(n)}</div></div>`).join('');

  const relace = stav.relace.length
    ? `<p class="mala">Hlavní session (manažer): ${stav.relace.map((r) => `${e(r.rezim)} od ${e(kdy(new Date(r.start).toISOString(), ted))}`).join(', ')}</p>`
    : '';
  const tedPracuje = `<section><h2>Teď pracuje</h2>${relace}${tabulkaBehu(stav.bezi, ted) || '<p>Nikdo z agentů teď nepracuje.</p>'}
    ${stav.nejasne.length ? `<h3>Bez záznamu o konci (start před víc než 6 h)</h3>${tabulkaBehu(stav.nejasne, ted)}` : ''}
    <p class="mala">Vidí jen agenty na tomto počítači. Noční směna běží v cloudu, její práce je vidět v úkolech, PR a ranní zprávě.</p></section>`;

  const seznam = (polozky) => (polozky.length
    ? `<ul>${polozky.map((i) => `<li>${odkaz(stav, i.cislo, `#${i.cislo} ${i.nazev}`)} ${stitkyHtml(i.stitky)}</li>`).join('')}</ul>`
    : '<p class="mala">Nic.</p>');

  let githubHtml;
  if (!gh) {
    githubHtml = `<section><h2>Úkoly a PR</h2><p class="varovani">GitHub není k dispozici: ${e(stav.chybaGitHubu ?? 'neznámá chyba')}. Zkontroluj, že je <code>gh</code> přihlášené.</p></section>`;
  } else {
    const proVlastnika = `<section><h2>Čeká na tebe</h2>${seznam(gh.proVlastnika.issues)}
      ${gh.proVlastnika.pr.length ? `<h3>PR ke schválení</h3>${seznam(gh.proVlastnika.pr)}` : ''}</section>`;
    const sloupce = gh.sloupce.map((s) => `<div class="karta"><h3>${e(s.nazev)} (${s.issues.length})</h3>${s.issues.map((i) => `<div class="ukol">${odkaz(stav, i.cislo, `#${i.cislo} ${i.nazev}`)}</div>`).join('') || '<p class="mala">—</p>'}</div>`).join('');
    const pr = gh.pr.length
      ? `<div class="tabulka"><table><thead><tr><th>PR</th><th>Větev</th><th>Kontroly</th><th>Štítky</th></tr></thead><tbody>${gh.pr.map((p) => `<tr>
          <td>${odkaz(stav, p.cislo, `#${p.cislo} ${p.nazev}`)}</td><td><code>${e(p.vetev)}</code></td>
          <td>${p.kontroly ? KONTROLY.map((k) => kontrolaHtml(k, p.kontroly[k])).join(' ') : '<span class="mala">nezjištěno</span>'}</td>
          <td>${stitkyHtml(p.stitky)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="mala">Žádný otevřený PR.</p>';
    const noc = `<section><h2>Noční směna</h2>
      ${gh.noc.stop.length ? `<p class="varovani">Zastaveno štítkem noc:stop: ${gh.noc.stop.map((i) => odkaz(stav, i.cislo, `#${i.cislo}`)).join(', ')}</p>` : ''}
      <h3>Fronta na příští noc (nejvýše 3)</h3>${seznam(gh.noc.fronta)}
      <h3>Poslední ranní zprávy</h3>${gh.noc.zpravy.length ? `<ul>${gh.noc.zpravy.map((z) => `<li>${odkaz(stav, z.cislo, `#${z.cislo} ${z.nazev}`)} <span class="mala">${e(z.stav === 'open' ? 'otevřená' : 'zavřená')}</span></li>`).join('')}</ul>` : '<p class="mala">Zatím žádná.</p>'}
      <p class="mala">Běhy rutiny: <a href="https://claude.ai/code/routines">claude.ai/code/routines</a></p></section>`;
    githubHtml = `${proVlastnika}<section><h2>Úkoly</h2><div class="mrizka">${sloupce}</div></section>
      <section><h2>Otevřené PR</h2>${pr}</section>${noc}`;
  }

  const tym = `<section><h2>Tým</h2><div class="mrizka">${stav.tymy.map((t) => `<div class="karta"><h3>${e(t.nazev)}</h3>
    ${t.clenove.map((c) => `<div class="clen${c.jmeno === t.vedouci ? ' vedouci' : ''}" title="${e(c.popis)}">
      <span class="tecka ${c.pracuje ? 'aktivni' : ''}"></span><b>${e(c.jmeno)}</b> <span class="model">${e(c.model)}</span>
      <div class="mala">${c.pracuje ? 'pracuje' : c.naposledy ? `naposledy ${e(kdy(c.naposledy, ted))}` : 'zatím nepracoval'}${c.zaTyden ? ` · ${c.zaTyden}× za 7 dní` : ''}</div>
    </div>`).join('')}</div>`).join('')}</div></section>`;

  const historie = `<section><h2>Poslední běhy agentů</h2>${tabulkaBehu(stav.historie, ted, { historie: true }) || '<p class="mala">Záznam je zatím prázdný. Plní ho hook zaznam-aktivity, jakmile tým spustí první agenty.</p>'}</section>`;

  return `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${OBNOVA_S}"><title>Velín týmu</title>
<style>
:root{--pozadi:#f6f7f9;--karta:#fff;--text:#1d2330;--tlumeny:#5d6675;--okraj:#dfe3ea;--akcent:#2458d6;--ok:#1f7a3f;--chyba:#b42318;--ceka:#9a6700;--stitek:#eef1f6}
@media (prefers-color-scheme: dark){:root{--pozadi:#12151b;--karta:#1b2029;--text:#e6e9ef;--tlumeny:#9aa3b2;--okraj:#2c3340;--akcent:#7aa2ff;--ok:#4cc27a;--chyba:#ff7b72;--ceka:#e3b341;--stitek:#262d39}}
*{box-sizing:border-box}body{margin:0;background:var(--pozadi);color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1200px;margin:0 auto;padding:16px}header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline}
h1{font-size:22px;margin:0}h2{font-size:18px;margin:28px 0 10px}h3{font-size:15px;margin:12px 0 6px}
a{color:var(--akcent)}code{font-size:13px}.mala{color:var(--tlumeny);font-size:13px}
.mrizka{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(230px,100%),1fr));gap:12px}.souhrny{grid-template-columns:repeat(auto-fill,minmax(min(140px,100%),1fr))}
.karta{background:var(--karta);border:1px solid var(--okraj);border-radius:8px;padding:10px 12px}
.souhrn{text-align:center}.cislo{font-size:28px;font-weight:700;display:block}
.tabulka{overflow-x:auto;background:var(--karta);border:1px solid var(--okraj);border-radius:8px}table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--okraj);vertical-align:top}th{color:var(--tlumeny);font-weight:600;font-size:13px}
.stitek{background:var(--stitek);border-radius:10px;padding:0 7px;font-size:12px;white-space:nowrap}
.kontrola{font-size:12px;border-radius:10px;padding:0 7px;border:1px solid currentColor;white-space:nowrap}
.ok{color:var(--ok)}.chyba{color:var(--chyba)}.ceka{color:var(--ceka)}
.varovani{color:var(--chyba);font-weight:600}.clen{padding:4px 0;border-top:1px solid var(--okraj)}.clen:first-of-type{border-top:0}
.vedouci b{text-decoration:underline}.model{font-size:12px;color:var(--tlumeny)}
.tecka{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--okraj);margin-right:6px}.tecka.aktivni{background:var(--ok)}
.ukol{padding:3px 0}ul{margin:4px 0;padding-left:20px}
</style></head><body><main>
<header><h1>Velín týmu</h1><span class="mala">${e(stav.repo ?? 'repozitář nezjištěn')} · aktualizováno ${e(cas(stav.cas))} · obnova po ${OBNOVA_S} s</span></header>
<section><div class="mrizka souhrny">${souhrn}</div></section>
${tedPracuje}${githubHtml}${tym}${historie}
<p class="mala">Velín jen čte. Stav úkolů se mění štítky na GitHubu. Záznam aktivity je v <code>.agent-tym/aktivita.jsonl</code> jen na tomto počítači.</p>
</main></body></html>`;
}

// ---------- server ----------

const BEZPECNOST = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

export function obsluha(ziskejStav, port) {
  return async (pozadavek, odpoved) => {
    const p = typeof port === 'function' ? port() : port;
    const posli = (kod, typ, telo, navic = {}) => {
      odpoved.writeHead(kod, { ...BEZPECNOST, 'Content-Type': typ, ...navic });
      odpoved.end(telo);
    };
    if (pozadavek.method !== 'GET' && pozadavek.method !== 'HEAD') return posli(405, 'text/plain; charset=utf-8', 'Velín jen čte.', { Allow: 'GET, HEAD' });
    // Kontrola hlavičky Host brání DNS rebinding: cizí web se na server nedostane přes vlastní doménu.
    if (![`127.0.0.1:${p}`, `localhost:${p}`].includes(pozadavek.headers.host)) return posli(403, 'text/plain; charset=utf-8', 'Nepovolený Host.');
    const cesta = pozadavek.url.split('?')[0];
    if (cesta !== '/' && cesta !== '/api/stav') return posli(404, 'text/plain; charset=utf-8', 'Nenalezeno.');
    try {
      const stav = await ziskejStav();
      if (cesta === '/api/stav') return posli(200, 'application/json; charset=utf-8', JSON.stringify(stav, null, 2));
      return posli(200, 'text/html; charset=utf-8', vykresli(stav));
    } catch {
      return posli(500, 'text/plain; charset=utf-8', 'Velín nemohl sestavit přehled.');
    }
  };
}

// Data z GitHubu se kešují, aby obnova stránky nevyčerpala limit API. Záznam se čte pokaždé.
export function zdrojStavu({ repo = null, api, agenti = () => nactiAgenty(), udalosti = () => nactiZaznam(), ted = () => Date.now() } = {}) {
  let kes = null;
  return async () => {
    const t = ted();
    if (!kes || t - kes.t > KES_MS) {
      try {
        if (!repo) throw new Error('origin nemíří na GitHub');
        kes = { t, github: await nactiGitHub(repo, api), chyba: null };
      } catch (chyba) {
        kes = { t, github: null, chyba: String(chyba.message ?? chyba).split('\n')[0].slice(0, 200) };
      }
    }
    return sestavStav({ agenti: agenti(), udalosti: udalosti(), github: kes.github, chybaGitHubu: kes.chyba, repo, ted: t });
  };
}

const NAPOVEDA = `Velín: místní přehled práce týmu agentů.

Použití:
  node skripty/velin.mjs              spustí server na http://127.0.0.1:${PORT}
  node skripty/velin.mjs --port 5000  jiný port
  node skripty/velin.mjs --json       vypíše přehled jako JSON a skončí
  node skripty/velin.mjs --help       tato nápověda`;

async function main(argumenty = process.argv.slice(2)) {
  if (argumenty.includes('--help')) return console.log(NAPOVEDA);
  let repo = null;
  try {
    repo = repozitar();
  } catch {}
  const ziskej = zdrojStavu({ repo });
  if (argumenty.includes('--json')) return console.log(JSON.stringify(await ziskej(), null, 2));
  const i = argumenty.indexOf('--port');
  const port = i >= 0 ? Number(argumenty[i + 1]) : PORT;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error('Port musí být celé číslo 1024–65535.');
    process.exitCode = 1;
    return;
  }
  const server = http.createServer(obsluha(ziskej, port));
  server.on('error', (chyba) => {
    console.error(chyba.code === 'EADDRINUSE' ? `Port ${port} je obsazený. Zkus --port <jiný>.` : `Server nešel spustit: ${chyba.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`Velín běží na http://127.0.0.1:${port} (ukončíš Ctrl+C).`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
