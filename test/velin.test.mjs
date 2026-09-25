import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { zaznam, zapis, ocisti, MAX_VELIKOST } from '../.claude/hooks/zaznam-aktivity.mjs';
import {
  nactiAgenty, sestavTymy, mimoRetez, nactiZaznam, vyhodnotAktivitu, nactiGitHub, sestavStav, vykresli, obsluha, zdrojStavu,
} from '../skripty/velin.mjs';

const HOOK = path.join(import.meta.dirname, '..', '.claude', 'hooks', 'zaznam-aktivity.mjs');
const DEN = { AGENT_TYM_DEN: '1' };
const T0 = Date.parse('2026-09-25T10:00:00Z');
const iso = (min) => new Date(T0 + min * 60000).toISOString();
const docasna = () => fs.mkdtempSync(path.join(os.tmpdir(), 'velin-'));

// ---------- hook zaznam-aktivity ----------

test('záznam neobsahuje cesty, zadání ani ID v plném znění', () => {
  const vstup = {
    hook_event_name: 'SubagentStart', session_id: 'sess-1234567890', agent_id: 'agent-abc', agent_type: 'backend',
    cwd: 'C:\\Users\\nekdo\\Tajne\\projekt', transcript_path: '/home/nekdo/.claude/x.jsonl',
    task_prompt: 'Implementuj issue #4 v C:\\Users\\nekdo\\repo\\skripty a ghp_abcdefghijklmnopqrstuvwxyz0123\nDalší řádek s tajnostmi',
  };
  const r = zaznam(vstup, DEN, new Date(T0));
  const text = JSON.stringify(r);
  assert.deepEqual(Object.keys(r).sort(), ['agent', 'cas', 'popis', 'rezim', 'session', 'typ', 'udalost']);
  for (const zakazane of ['nekdo', 'Tajne', 'transcript', 'ghp_', 'Další řádek', 'sess-1234567890', 'agent-abc']) {
    assert.ok(!text.includes(zakazane), `v záznamu je ${zakazane}`);
  }
  assert.equal(r.typ, 'backend');
  assert.equal(r.rezim, 'den');
  assert.match(r.popis, /^Implementuj issue #4 v ‹cesta› a ‹klíč›$/);
});

test('popis je jeden řádek bez řídicích znaků a nejvýše 120 znaků', () => {
  assert.equal(ocisti('a\u0007b\u001b[31mc'), 'a b [31mc');
  assert.equal(ocisti('x'.repeat(300)).length, 120);
  assert.equal(ocisti('\n\n  druhý řádek  \ntřetí'), 'druhý řádek');
  assert.equal(ocisti(42), null);
  assert.equal(ocisti('   '), null);
});

test('spuštění přes Agent zapíše volajícího, cíl, popis a model; jiné nástroje ne', () => {
  const r = zaznam({
    hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Agent', agent_id: 'rodic', agent_type: 'vyvoj-vedouci',
    tool_input: { subagent_type: 'backend', description: 'Implementace #4', model: 'sonnet', prompt: 'TAJNÉ ZADÁNÍ' },
  }, {}, new Date(T0));
  assert.equal(r.udalost, 'spusteni');
  assert.equal(r.volajiciTyp, 'vyvoj-vedouci');
  assert.equal(r.cil, 'backend');
  assert.equal(r.popis, 'Implementace #4');
  assert.equal(r.model, 'sonnet');
  assert.equal(r.rezim, 'noc');
  assert.ok(!JSON.stringify(r).includes('TAJNÉ'));
  assert.equal(zaznam({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }), null);
  assert.equal(zaznam({ hook_event_name: 'Neznama' }), null);
  assert.equal(zaznam({ hook_event_name: 'SubagentStart', agent_type: '<script>' }).typ, null);
});

test('záznam nad 1 MB se přejmenuje na .1.jsonl', () => {
  const slozka = docasna();
  const soubor = path.join(slozka, 'aktivita.jsonl');
  fs.writeFileSync(soubor, 'x'.repeat(MAX_VELIKOST + 1));
  zapis({ udalost: 'start' }, soubor);
  assert.equal(fs.statSync(path.join(slozka, 'aktivita.1.jsonl')).size, MAX_VELIKOST + 1);
  assert.equal(fs.readFileSync(soubor, 'utf8'), '{"udalost":"start"}\n');
});

test('hook nikdy neblokuje: neplatný vstup skončí kódem 0 bez výstupu', () => {
  for (const vstup of ['nesmysl', '', '{"hook_event_name":"Neznama"}']) {
    const vystup = execFileSync(process.execPath, [HOOK], { input: vstup, encoding: 'utf8' });
    assert.equal(vystup, '');
  }
});

// ---------- agenti a týmy ----------

test('tým má 36 agentů v 9 týmech a nikdo nechybí', () => {
  const agenti = nactiAgenty();
  const tymy = sestavTymy(agenti);
  assert.equal(agenti.length, 36);
  assert.equal(tymy.length, 9);
  assert.equal(tymy.flatMap((t) => t.clenove).length, 36);
  assert.ok(tymy.every((t) => t.clenove[0] === t.vedouci));
  assert.deepEqual(tymy.map((t) => t.nazev), ['Produkt', 'Vývoj', 'Kvalita', 'Provoz', 'Marketing', 'Objevování', 'Revize', 'Právo', 'Platforma']);
  assert.ok(tymy[1].clenove.includes('backend'));
});

test('agent bez týmu se ukáže ve skupině Mimo tým', () => {
  const tymy = sestavTymy([{ jmeno: 'a-vedouci', clenove: ['b'] }, { jmeno: 'b', clenove: [] }, { jmeno: 'sirotek', clenove: [] }]);
  assert.deepEqual(tymy.at(-1), { nazev: 'Mimo tým', vedouci: null, clenove: ['sirotek'] });
});

test('řetěz velení: manažer → vedoucí → člen je v pořádku, zkratky ne', () => {
  const tymy = sestavTymy(nactiAgenty());
  assert.equal(mimoRetez('manažer', 'vyvoj-vedouci', tymy), false);
  assert.equal(mimoRetez('vyvoj-vedouci', 'backend', tymy), false);
  assert.equal(mimoRetez('manažer', 'backend', tymy), true);
  assert.equal(mimoRetez('vyvoj-vedouci', 'tester', tymy), true);
  assert.equal(mimoRetez('backend', 'tester', tymy), true);
  assert.equal(mimoRetez('manažer', 'Explore', tymy), false);
  assert.equal(mimoRetez(null, 'backend', tymy), false);
});

// ---------- aktivita ----------

const UDALOSTI = [
  { cas: iso(0), udalost: 'session-start', session: 's1', rezim: 'den' },
  { cas: iso(1), udalost: 'spusteni', session: 's1', volajici: null, volajiciTyp: null, cil: 'vyvoj-vedouci', popis: 'Postav #4', model: null },
  { cas: iso(1), udalost: 'start', session: 's1', agent: 'a1', typ: 'vyvoj-vedouci', popis: 'dlouhé zadání', rezim: 'den' },
  { cas: iso(2), udalost: 'spusteni', session: 's1', volajici: 'a1', volajiciTyp: 'vyvoj-vedouci', cil: 'backend', popis: 'Skript sync', model: 'sonnet' },
  { cas: iso(2), udalost: 'start', session: 's1', agent: 'a2', typ: 'backend', rezim: 'den' },
  { cas: iso(5), udalost: 'spusteni', session: 's1', volajici: null, volajiciTyp: null, cil: 'tester', popis: 'Obchvat', model: null },
  { cas: iso(5), udalost: 'start', session: 's1', agent: 'a3', typ: 'tester', rezim: 'den' },
  { cas: iso(8), udalost: 'konec', session: 's1', agent: 'a3', typ: 'tester' },
  { cas: iso(-600), udalost: 'start', session: 's0', agent: 'a0', typ: 'planovac', rezim: 'noc' },
  { cas: 'nesmysl', udalost: 'start', agent: 'x' },
];

test('aktivita: kdo běží, kdo skončil, kdo spustil koho a nejasné běhy', () => {
  const a = vyhodnotAktivitu(UDALOSTI, T0 + 10 * 60000);
  assert.deepEqual(a.bezi.map((b) => b.typ), ['backend', 'vyvoj-vedouci']);
  assert.equal(a.bezi[0].spustil, 'vyvoj-vedouci');
  assert.equal(a.bezi[0].popis, 'Skript sync');
  assert.equal(a.bezi[0].model, 'sonnet');
  assert.equal(a.bezi[1].spustil, 'manažer');
  assert.deepEqual(a.nejasne.map((b) => b.typ), ['planovac']);
  assert.equal(a.relace.length, 1);
  assert.equal(a.zaTyden.tester, 1);
  assert.equal(a.posledni.tester, T0 + 8 * 60000);
  assert.equal(a.historie.find((b) => b.typ === 'tester').konec, T0 + 8 * 60000);
});

test('nactiZaznam přeskočí poškozené řádky a čte i starší soubor', () => {
  const slozka = docasna();
  const soubor = path.join(slozka, 'aktivita.jsonl');
  fs.writeFileSync(path.join(slozka, 'aktivita.1.jsonl'), '{"udalost":"start","agent":"stary"}\n');
  fs.writeFileSync(soubor, 'poškozeno\n{"udalost":"konec","agent":"stary"}\n[1]\n');
  assert.deepEqual(nactiZaznam(soubor).map((u) => u.udalost), ['start', 'konec']);
  assert.deepEqual(nactiZaznam(path.join(slozka, 'neexistuje.jsonl')), []);
});

// ---------- GitHub a stav ----------

function falesnyGitHub() {
  const data = {
    'repos/vlastnik/tym': { owner: { login: 'vlastnik' } },
    'repos/vlastnik/tym/issues?state=open&per_page=100': [
      { number: 4, title: 'Skript sync', labels: [{ name: 'noc:ano' }, { name: 'stav:pripraveno' }], user: { login: 'vlastnik' } },
      { number: 5, title: 'Cizí <script>alert(1)</script>', labels: [{ name: 'noc:ano' }, { name: 'stav:pripraveno' }], user: { login: 'cizi' } },
      { number: 8, title: 'Ranní zpráva 2026-09-25', labels: [{ name: 'ranni-zprava' }, { name: 'pro-vlastnika' }], user: { login: 'vlastnik' } },
      { number: 10, title: 'PR jako issue', labels: [], pull_request: {} },
      { number: 11, title: 'Stop', labels: [{ name: 'noc:stop' }], user: { login: 'vlastnik' } },
    ],
    'repos/vlastnik/tym/pulls?state=open&per_page=50': [
      { number: 10, title: 'Přidej sync', head: { ref: 'claude/ukol-4-sync', sha: 'a'.repeat(40) }, labels: [{ name: 'stav:ceka-na-vlastnika' }] },
    ],
    'repos/vlastnik/tym/issues?state=all&labels=ranni-zprava&per_page=3': [
      { number: 8, title: 'Ranní zpráva 2026-09-25', state: 'open', created_at: iso(0) },
    ],
    [`repos/vlastnik/tym/commits/${'a'.repeat(40)}/check-runs?per_page=100`]: {
      check_runs: [
        { id: 1, name: 'chranene-soubory', status: 'completed', conclusion: 'failure' },
        { id: 3, name: 'chranene-soubory', status: 'completed', conclusion: 'success' },
        { id: 2, name: 'testy', status: 'in_progress', conclusion: null },
        { id: 4, name: 'jina', status: 'completed', conclusion: 'success' },
      ],
    },
  };
  let volani = 0;
  const api = async (cesta) => {
    volani++;
    if (!(cesta in data)) throw new Error(`neznámá cesta ${cesta}`);
    return data[cesta];
  };
  return { api, pocet: () => volani };
}

test('GitHub: issues bez PR, nejnovější výsledek kontrol, fronta jen od vlastníka', async () => {
  const gh = await nactiGitHub('vlastnik/tym', falesnyGitHub().api);
  assert.deepEqual(gh.issues.map((i) => i.cislo), [4, 5, 8, 11]);
  assert.deepEqual(gh.pr[0].kontroly, { 'chranene-soubory': 'success', testy: 'in_progress' });
  const stav = sestavStav({ agenti: nactiAgenty(), udalosti: UDALOSTI, github: gh, repo: 'vlastnik/tym', ted: T0 + 600000 });
  assert.deepEqual(stav.github.noc.fronta.map((i) => i.cislo), [4]);
  assert.deepEqual(stav.github.noc.stop.map((i) => i.cislo), [11]);
  assert.deepEqual(stav.github.proVlastnika.issues.map((i) => i.cislo), [8]);
  assert.deepEqual(stav.github.proVlastnika.pr.map((p) => p.cislo), [10]);
  assert.deepEqual(stav.github.sloupce.find((s) => s.stitek === 'stav:pripraveno').issues.map((i) => i.cislo), [4, 5]);
  assert.equal(stav.bezi.find((b) => b.typ === 'backend').tym, 'Vývoj');
  assert.equal(stav.historie.find((b) => b.typ === 'tester').mimoRetez, true);
});

test('stránka escapuje texty z GitHubu a nemá žádný skript', async () => {
  const gh = await nactiGitHub('vlastnik/tym', falesnyGitHub().api);
  const html = vykresli(sestavStav({ agenti: nactiAgenty(), udalosti: UDALOSTI, github: gh, repo: 'vlastnik/tym', ted: T0 + 600000 }));
  assert.ok(!/<script/i.test(html), 'stránka obsahuje <script');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('https://github.com/vlastnik/tym/issues/4'));
  assert.ok(html.includes('mimo řetěz'));
  for (const sekce of ['Teď pracuje', 'Čeká na tebe', 'Úkoly', 'Otevřené PR', 'Noční směna', 'Tým', 'Poslední běhy agentů']) {
    assert.ok(html.includes(`<h2>${sekce}</h2>`), `chybí sekce ${sekce}`);
  }
});

test('bez GitHubu se stránka ukáže s vysvětlením a data z GitHubu se kešují', async () => {
  let ted = T0;
  const selhani = zdrojStavu({ repo: 'vlastnik/tym', api: async () => { throw new Error('gh: nepřihlášeno\ndetail'); }, udalosti: () => [], ted: () => ted });
  const stav = await selhani();
  assert.equal(stav.github, null);
  assert.equal(stav.chybaGitHubu, 'gh: nepřihlášeno');
  assert.match(vykresli(stav), /GitHub není k dispozici: gh: nepřihlášeno/);

  const falesny = falesnyGitHub();
  const zdroj = zdrojStavu({ repo: 'vlastnik/tym', api: falesny.api, udalosti: () => [], ted: () => ted });
  await zdroj();
  const poPrvnim = falesny.pocet();
  ted += 30_000;
  await zdroj();
  assert.equal(falesny.pocet(), poPrvnim, 'do 60 s se GitHub nevolá znovu');
  ted += 60_000;
  await zdroj();
  assert.ok(falesny.pocet() > poPrvnim);
});

// ---------- server ----------

function pozadavek(port, { method = 'GET', cesta = '/', host } = {}) {
  return new Promise((hotovo, chyba) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: cesta, headers: { host: host ?? `127.0.0.1:${port}` } }, (odp) => {
      let telo = '';
      odp.on('data', (k) => { telo += k; });
      odp.on('end', () => hotovo({ kod: odp.statusCode, hlavicky: odp.headers, telo }));
    });
    r.on('error', chyba);
    r.end();
  });
}

test('server: jen GET, jen místní Host, CSP bez skriptů', async () => {
  const stav = sestavStav({ agenti: nactiAgenty(), udalosti: [], github: null, chybaGitHubu: 'test', ted: T0 });
  const server = http.createServer(obsluha(async () => stav, () => server.address().port));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  try {
    const ok = await pozadavek(port);
    assert.equal(ok.kod, 200);
    assert.equal(ok.hlavicky['content-security-policy'].split(';')[0], "default-src 'none'");
    assert.ok(!ok.hlavicky['content-security-policy'].includes('script-src'));
    assert.match(ok.telo, /Velín týmu/);
    assert.equal((await pozadavek(port, { host: `localhost:${port}` })).kod, 200);
    assert.equal((await pozadavek(port, { method: 'POST' })).kod, 405);
    assert.equal((await pozadavek(port, { host: 'utocnik.example:80' })).kod, 403);
    assert.equal((await pozadavek(port, { host: `127.0.0.1:${port}.utocnik.example` })).kod, 403);
    assert.equal((await pozadavek(port, { cesta: '/../.env' })).kod, 404);
    const json = await pozadavek(port, { cesta: '/api/stav' });
    assert.equal(JSON.parse(json.telo).chybaGitHubu, 'test');
  } finally {
    server.close();
  }
});
