import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { nactiAgenty, sestavStav, obsluha, nactiStaticke, SLOZKA_3D } from '../skripty/velin.mjs';
import { vytvorAkce, STAVY } from '../skripty/velin/akce.mjs';

// ---------- akce ----------

// Falešné `gh api`: issues a PR v paměti, zaznamenává volání.
function falesnyGh({ issues = {}, pulls = {}, vlastnik = 'Vlastnik' } = {}) {
  const volani = [];
  let dalsi = 100;
  const gh = async (argumenty, vstup) => {
    const [, , metoda, cesta] = argumenty;
    volani.push({ metoda, cesta, vstup });
    const m = cesta.match(/^repos\/[^/]+\/[^/]+(.*)$/);
    const zbytek = m[1];
    if (zbytek === '' && metoda === 'GET') return { owner: { login: vlastnik } };
    let r;
    if ((r = zbytek.match(/^\/issues\/(\d+)$/)) && metoda === 'GET') {
      if (!issues[r[1]]) throw new Error('HTTP 404: Not Found');
      return issues[r[1]];
    }
    if ((r = zbytek.match(/^\/pulls\/(\d+)$/))) return pulls[r[1]];
    if ((r = zbytek.match(/^\/issues\/(\d+)\/labels$/)) && metoda === 'POST') {
      const i = issues[r[1]] ?? pulls[r[1]];
      i.labels.push(...vstup.labels.map((name) => ({ name })));
      return i.labels;
    }
    if ((r = zbytek.match(/^\/issues\/(\d+)\/labels\/(.+)$/)) && metoda === 'DELETE') {
      const i = issues[r[1]];
      const nazev = decodeURIComponent(r[2]);
      if (!i.labels.some((l) => l.name === nazev)) throw new Error('HTTP 404: Label does not exist');
      i.labels = i.labels.filter((l) => l.name !== nazev);
      return null;
    }
    if (zbytek.startsWith('/issues?') && metoda === 'GET') {
      return Object.values(issues).filter((i) => i.state === 'open' && i.labels.some((l) => l.name === 'noc:stop'));
    }
    if (zbytek === '/issues' && metoda === 'POST') {
      const n = dalsi++;
      issues[n] = { number: n, state: 'open', title: vstup.title, body: vstup.body, labels: vstup.labels.map((name) => ({ name })), user: { login: vlastnik } };
      return issues[n];
    }
    if ((r = zbytek.match(/^\/issues\/(\d+)$/)) && metoda === 'PATCH') {
      Object.assign(issues[r[1]], vstup);
      return issues[r[1]];
    }
    throw new Error(`neočekávané volání ${metoda} ${cesta}`);
  };
  return { gh, volani, issues, pulls };
}

const issue = (number, labels = [], autor = 'vlastnik', dalsi = {}) => ({ number, state: 'open', title: `Úkol ${number}`, labels: labels.map((name) => ({ name })), user: { login: autor }, ...dalsi });
const jmena = (i) => i.labels.map((l) => l.name).sort();

test('akce: poslat na noc nastaví noc:ano a stav připraveno, jen u úkolu vlastníka', async () => {
  const f = falesnyGh({ issues: { 4: issue(4, ['stav:napad', 'platforma']), 5: issue(5, [], 'cizi'), 6: issue(6, [], 'vlastnik', { state: 'closed' }), 7: issue(7, [], 'vlastnik', { pull_request: {} }), 8: issue(8, ['vetsi-akce']), 9: issue(9, ['stav:rozpracovano']) } });
  const proved = vytvorAkce({ repo: 'org/repo', gh: f.gh });
  assert.match(await proved({ typ: 'noc', cislo: 4, zapnout: true }), /poslán na noc/);
  assert.deepEqual(jmena(f.issues[4]), ['noc:ano', 'platforma', 'stav:pripraveno']);
  await assert.rejects(proved({ typ: 'noc', cislo: 5, zapnout: true }), /založil vlastník/);
  await assert.rejects(proved({ typ: 'noc', cislo: 6, zapnout: true }), /zavřený/);
  await assert.rejects(proved({ typ: 'noc', cislo: 7, zapnout: true }), /ne PR/);
  await assert.rejects(proved({ typ: 'noc', cislo: 4 }), /true\/false/);
  assert.match(await proved({ typ: 'noc', cislo: 8, zapnout: true }), /nevezme kvůli štítku vetsi-akce/);
  await assert.rejects(proved({ typ: 'noc', cislo: 9, zapnout: true }), /rozpracovano/);
  assert.deepEqual(jmena(f.issues[9]), ['stav:rozpracovano'], 'rozdělaný úkol se nevrátí do fronty');
  assert.match(await proved({ typ: 'noc', cislo: 4, zapnout: false }), /odebrán/);
  assert.deepEqual(jmena(f.issues[4]), ['platforma', 'stav:pripraveno']);
  await proved({ typ: 'noc', cislo: 4, zapnout: false }); // chybějící štítek (404) nevadí
});

test('akce: zastavit a pustit noc přes issue se štítkem noc:stop', async () => {
  const f = falesnyGh({ issues: { 50: issue(50, ['noc:stop'], 'vlastnik', { pull_request: {} }) } });
  const proved = vytvorAkce({ repo: 'org/repo', gh: f.gh });
  assert.match(await proved({ typ: 'nocStop', zapnout: true }), /Noc zastavena \(#100\)/, 'PR se štítkem noc:stop noc nezastavuje');
  assert.match(await proved({ typ: 'nocStop', zapnout: true }), /už je zastavená/);
  assert.match(await proved({ typ: 'nocStop', zapnout: false }), /Noc puštěna/);
  assert.equal(f.issues[100].state, 'closed');
  assert.equal(f.issues[50].state, 'open', 'PR se nezavírá');
  assert.match(await proved({ typ: 'nocStop', zapnout: false }), /nebyla zastavená/);
  await assert.rejects(proved({ typ: 'nocStop' }), /true\/false/);
});

test('akce: schválení přidá jen štítek, nic neslučuje', async () => {
  const SHA = 'a'.repeat(40);
  const f = falesnyGh({ pulls: { 15: { number: 15, state: 'open', head: { sha: SHA }, labels: [{ name: 'vetsi-akce' }] }, 16: { number: 16, state: 'closed', head: { sha: SHA }, labels: [] } } });
  const proved = vytvorAkce({ repo: 'org/repo', gh: f.gh });
  await assert.rejects(proved({ typ: 'schvalit', cislo: 15 }), /Chybí commit/);
  await assert.rejects(proved({ typ: 'schvalit', cislo: 15, sha: 'b'.repeat(40) }), /nový commit/);
  assert.ok(!f.pulls[15].labels.some((l) => l.name === 'schvaleno-vlastnikem'), 'jiný commit se neschválí');
  assert.match(await proved({ typ: 'schvalit', cislo: 15, sha: SHA }), /schválen/);
  assert.ok(f.pulls[15].labels.some((l) => l.name === 'schvaleno-vlastnikem'));
  assert.match(await proved({ typ: 'schvalit', cislo: 15, sha: SHA }), /už je schválený/);
  await assert.rejects(proved({ typ: 'schvalit', cislo: 16, sha: SHA }), /není otevřený/);
  assert.ok(f.volani.every((v) => !/merge/.test(v.cesta) && v.metoda !== 'PUT'), 'žádné sloučení');
});

test('akce: posun stavu nechá právě jeden stav', async () => {
  const f = falesnyGh({ issues: { 3: issue(3, ['stav:napad', 'stav:revize', 'noc:ano']) } });
  const proved = vytvorAkce({ repo: 'org/repo', gh: f.gh });
  await proved({ typ: 'stav', cislo: 3, stav: 'stav:rozpracovano' });
  assert.deepEqual(jmena(f.issues[3]), ['noc:ano', 'stav:rozpracovano']);
  await assert.rejects(proved({ typ: 'stav', cislo: 3, stav: 'blokovano' }), /Neznámý stav/);
  await assert.rejects(proved({ typ: 'stav', cislo: 3, stav: 'noc:ano' }), /Neznámý stav/);
  assert.equal(STAVY.length, 5);
});

test('akce: nový úkol ověří název a popis', async () => {
  const f = falesnyGh();
  const proved = vytvorAkce({ repo: 'org/repo', gh: f.gh });
  assert.match(await proved({ typ: 'novy', nazev: '  Nový nápad  ', popis: 'Řádek 1\r\nŘádek 2' }), /#100/);
  assert.equal(f.issues[100].title, 'Nový nápad');
  assert.equal(f.issues[100].body, 'Řádek 1\nŘádek 2\n\n_Založeno z Velínu._');
  assert.deepEqual(jmena(f.issues[100]), ['stav:napad']);
  await proved({ typ: 'novy', nazev: 'Bez popisu' });
  assert.equal(f.issues[101].body, '_Založeno z Velínu._');
  await assert.rejects(proved({ typ: 'novy', nazev: '' }), /1 až 120/);
  await assert.rejects(proved({ typ: 'novy', nazev: 'x'.repeat(121) }), /1 až 120/);
  await assert.rejects(proved({ typ: 'novy', nazev: 'a\u0007b' }), /řídicí znaky/);
  await assert.rejects(proved({ typ: 'novy', nazev: 42 }), /chybí/);
  await assert.rejects(proved({ typ: 'novy', nazev: 'ok', popis: 'x'.repeat(5001) }), /1 až 5000/);
});

test('akce: neznámé akce, čísla a repozitáře se odmítnou', async () => {
  const f = falesnyGh();
  const proved = vytvorAkce({ repo: 'org/repo', gh: f.gh });
  for (const typ of ['merge', '__proto__', 'constructor', 'toString', undefined]) await assert.rejects(proved({ typ }), /Neznámá akce/, String(typ));
  await assert.rejects(proved(null), /Neznámá akce/);
  for (const cislo of ['4', 0, -1, 1.5, 1e8, '4/labels']) await assert.rejects(proved({ typ: 'stav', cislo, stav: 'stav:napad' }), /Neplatné číslo/, String(cislo));
  for (const repo of ['org', 'org/../x', 'org/repo/issues', '', null, 'a b/c']) assert.throws(() => vytvorAkce({ repo, gh: f.gh }), /není známý/, String(repo));
  assert.equal(f.volani.length, 0);
});

// ---------- server ----------

const KLIC = 'a'.repeat(48);
const INDEX = '<script nonce="{{NONCE}}"></script>3D';

function spustServer(proved, { obnov } = {}) {
  const stav = sestavStav({ agenti: nactiAgenty(), udalosti: [], github: null, chybaGitHubu: 'test', ted: Date.UTC(2026, 8, 25) });
  const ziskej = async () => stav;
  ziskej.obnov = obnov;
  const server = http.createServer(obsluha(ziskej, () => server.address().port, { klic: KLIC, proved, staticke: nactiStaticke(), index: INDEX }));
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

function pozadavek(port, { method = 'GET', cesta = '/', hlavicky = {}, telo } = {}) {
  return new Promise((hotovo, chyba) => {
    const bezPrazdnych = Object.fromEntries(Object.entries({ host: `127.0.0.1:${port}`, ...hlavicky }).filter(([, v]) => v !== undefined));
    const r = http.request({ host: '127.0.0.1', port, method, path: cesta, headers: bezPrazdnych }, (odp) => {
      let data = '';
      odp.on('data', (k) => { data += k; });
      odp.on('end', () => hotovo({ kod: odp.statusCode, hlavicky: odp.headers, telo: data }));
    });
    r.on('error', (e) => (e.code === 'ECONNRESET' || e.code === 'EPIPE' ? hotovo({ kod: 'reset' }) : chyba(e)));
    if (telo !== undefined) r.write(telo);
    r.end();
  });
}

test('server: akce jen se stejným původem, klíčem a JSON', async () => {
  const provedene = [];
  let obnoveno = 0;
  const server = await spustServer(async (d) => {
    provedene.push(d);
    if (d.typ === 'chyba') throw new Error('Neznámá akce.');
    return 'Hotovo.';
  }, { obnov: () => obnoveno++ });
  const port = server.address().port;
  const spravne = { origin: `http://127.0.0.1:${port}`, 'x-velin-klic': KLIC, 'content-type': 'application/json' };
  const posli = (hlavicky, telo = '{"typ":"stav"}') => pozadavek(port, { method: 'POST', cesta: '/api/akce', hlavicky, telo });
  try {
    const ok = await posli(spravne);
    assert.equal(ok.kod, 200);
    assert.deepEqual(JSON.parse(ok.telo), { ok: true, zprava: 'Hotovo.' });
    assert.equal(obnoveno, 1, 'po akci se zahodí keš GitHubu');
    assert.equal((await posli({ ...spravne, origin: `http://localhost:${port}` })).kod, 200);
    assert.equal((await posli({ ...spravne, origin: undefined })).kod, 403);
    assert.equal((await posli({ ...spravne, origin: 'http://utocnik.example' })).kod, 403);
    assert.equal((await posli({ ...spravne, origin: 'null' })).kod, 403);
    assert.equal((await posli({ ...spravne, 'x-velin-klic': undefined })).kod, 403);
    assert.equal((await posli({ ...spravne, 'x-velin-klic': 'b'.repeat(48) })).kod, 403);
    assert.equal((await posli({ ...spravne, 'x-velin-klic': 'a' })).kod, 403);
    assert.equal((await posli({ ...spravne, 'content-type': 'text/plain' })).kod, 415);
    assert.equal((await posli(spravne, '{nejson')).kod, 400);
    const velky = await posli(spravne, JSON.stringify({ typ: 'novy', popis: 'x'.repeat(20000) }));
    assert.ok(velky.kod === 400 || velky.kod === 'reset', `velký požadavek: ${velky.kod}`);
    const chyba = await posli(spravne, '{"typ":"chyba"}');
    assert.equal(chyba.kod, 400);
    assert.equal(JSON.parse(chyba.telo).chyba, 'Neznámá akce.');
    assert.equal(provedene.length, 3, 'odmítnuté požadavky se k akcím nedostanou');
    assert.equal((await pozadavek(port, { method: 'POST', cesta: '/', hlavicky: spravne, telo: '{}' })).kod, 405);
    assert.equal((await pozadavek(port, { method: 'PUT', cesta: '/api/akce', hlavicky: spravne, telo: '{}' })).kod, 405);
    assert.equal((await pozadavek(port, { method: 'POST', cesta: '/api/akce', hlavicky: { ...spravne, host: 'utocnik.example' }, telo: '{}' })).kod, 403);
  } finally {
    server.close();
  }
});

test('server: jednorázová vstupenka se vymění za klíč relace', async () => {
  const stav = sestavStav({ agenti: nactiAgenty(), udalosti: [], github: null, ted: 0 });
  const vstupenka = 'c'.repeat(48);
  const server = http.createServer(obsluha(async () => stav, () => server.address().port, { vstupenka, proved: async () => 'Hotovo.' }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  const hlavicky = { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' };
  const vymen = (telo, h = hlavicky) => pozadavek(port, { method: 'POST', cesta: '/api/klic', hlavicky: h, telo });
  try {
    assert.equal((await vymen(JSON.stringify({ vstupenka }), { ...hlavicky, origin: 'http://utocnik.example' })).kod, 403);
    assert.equal((await vymen(JSON.stringify({ vstupenka: 'd'.repeat(48) }))).kod, 403);
    assert.equal((await vymen('{nejson')).kod, 400);
    const ok = await vymen(JSON.stringify({ vstupenka }));
    assert.equal(ok.kod, 200);
    const { klic } = JSON.parse(ok.telo);
    assert.match(klic, /^[0-9a-f]{48}$/);
    assert.notEqual(klic, vstupenka);
    assert.equal((await vymen(JSON.stringify({ vstupenka }))).kod, 403, 'vstupenka platí jednou');
    const akce = (k) => pozadavek(port, { method: 'POST', cesta: '/api/akce', hlavicky: { ...hlavicky, 'x-velin-klic': k }, telo: '{"typ":"x"}' });
    assert.equal((await akce(vstupenka)).kod, 403, 'vstupenka není klíč');
    assert.equal((await akce(klic)).kod, 200);
  } finally {
    server.close();
  }
});

test('server: bez klíče nebo funkce akcí jsou tlačítka vypnutá', async () => {
  const stav = sestavStav({ agenti: nactiAgenty(), udalosti: [], github: null, ted: 0 });
  const server = http.createServer(obsluha(async () => stav, () => server.address().port, { proved: async () => 'x' }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  try {
    const r = await pozadavek(port, { method: 'POST', cesta: '/api/akce', hlavicky: { origin: `http://127.0.0.1:${port}`, 'x-velin-klic': '', 'content-type': 'application/json' }, telo: '{}' });
    assert.equal(r.kod, 403);
  } finally {
    server.close();
  }
});

test('server: 3D stránka s nonce, klíč se nikdy neposílá', async () => {
  const server = await spustServer(async () => 'x');
  const port = server.address().port;
  try {
    const a = await pozadavek(port);
    const b = await pozadavek(port);
    const nonce = a.hlavicky['content-security-policy'].match(/'nonce-([^']+)'/)[1];
    assert.ok(nonce.length >= 16);
    assert.ok(a.telo.includes(`nonce="${nonce}"`));
    assert.notEqual(nonce, b.hlavicky['content-security-policy'].match(/'nonce-([^']+)'/)[1], 'nonce je pro každou odpověď nový');
    assert.ok(!a.hlavicky['content-security-policy'].includes('unsafe'));
    assert.match(a.hlavicky['content-security-policy'], /connect-src 'self'/);
    assert.match(a.hlavicky['content-security-policy'], /frame-ancestors 'none'/);
    for (const cesta of ['/', '/prehled', '/api/stav', '/static/app.js']) {
      const r = await pozadavek(port, { cesta });
      assert.equal(r.kod, 200, cesta);
      assert.ok(!r.telo.includes(KLIC) && !JSON.stringify(r.hlavicky).includes(KLIC), `klíč v ${cesta}`);
    }
    assert.match((await pozadavek(port, { cesta: '/prehled' })).telo, /Velín týmu/);
  } finally {
    server.close();
  }
});

test('server: statické soubory jen ze seznamu', async () => {
  const mapa = nactiStaticke();
  assert.ok(mapa.has('/static/app.js'));
  assert.ok(mapa.has('/static/velin.css'));
  assert.ok(mapa.has('/static/vendor/three/build/three.module.js'));
  assert.ok(!mapa.has('/static/index.html'), 'index jen přes / s nonce');
  assert.ok(![...mapa.keys()].some((k) => k.endsWith('.mjs') || k.endsWith('.md')), 'serverový kód ani dokumenty se neposílají');
  const server = await spustServer(async () => 'x');
  const port = server.address().port;
  try {
    const js = await pozadavek(port, { cesta: '/static/app.js' });
    assert.match(js.hlavicky['content-type'], /^text\/javascript/);
    assert.equal(js.hlavicky['x-content-type-options'], 'nosniff');
    for (const cesta of ['/static/akce.mjs', '/static/../velin.mjs', '/static/%2e%2e/velin.mjs', '/static/vendor/VENDOR.md', '/static/index.html', '/static/APP.JS']) {
      assert.equal((await pozadavek(port, { cesta })).kod, 404, cesta);
    }
  } finally {
    server.close();
  }
});

test('3D stránka: import map míří na přibalené soubory, bez CDN', () => {
  const index = fs.readFileSync(path.join(SLOZKA_3D, 'index.html'), 'utf8');
  const mapa = JSON.parse(index.match(/<script type="importmap" nonce="\{\{NONCE\}\}">(.*?)<\/script>/s)[1]);
  const staticke = nactiStaticke();
  assert.ok(staticke.has(mapa.imports.three));
  assert.ok(staticke.has(`${mapa.imports['three/addons/']}controls/OrbitControls.js`));
  for (const soubor of ['index.html', 'app.js', 'velin.css']) {
    assert.ok(!/https?:\/\/(?!github\.com\/)/.test(fs.readFileSync(path.join(SLOZKA_3D, soubor), 'utf8').replace(/http:\/\/127\.0\.0\.1/g, '')), `${soubor} nenačítá nic zvenku`);
  }
  const app = fs.readFileSync(path.join(SLOZKA_3D, 'app.js'), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(app), 'text jen přes textContent');
  // všechny importy přibalených modulů jdou vyřešit
  for (const [klic, soubor] of staticke) {
    if (!klic.startsWith('/static/vendor/') || !klic.endsWith('.js')) continue;
    for (const [, cil] of fs.readFileSync(soubor.soubor, 'utf8').matchAll(/from\s+'([^']+)'/g)) {
      const url = cil === 'three' ? mapa.imports.three
        : cil.startsWith('three/addons/') ? mapa.imports['three/addons/'] + cil.slice('three/addons/'.length)
          : new URL(cil, `http://x${klic}`).pathname;
      assert.ok(staticke.has(url), `${klic} importuje ${cil}`);
    }
  }
});

test('přibalená knihovna odpovídá otiskům ve VENDOR.md', () => {
  const vendor = path.join(SLOZKA_3D, 'vendor');
  const tabulka = [...fs.readFileSync(path.join(vendor, 'VENDOR.md'), 'utf8').matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|$/gm)];
  assert.ok(tabulka.length >= 14);
  const zapsane = new Set();
  for (const [, soubor, otisk] of tabulka) {
    const obsah = fs.readFileSync(path.join(vendor, soubor));
    assert.equal(crypto.createHash('sha256').update(obsah).digest('hex'), otisk, soubor);
    zapsane.add(soubor);
  }
  const vse = [];
  const projdi = (d, p) => {
    for (const x of fs.readdirSync(d, { withFileTypes: true })) {
      if (x.isDirectory()) projdi(path.join(d, x.name), `${p}${x.name}/`);
      else vse.push(`${p}${x.name}`);
    }
  };
  projdi(path.join(vendor, 'three'), 'three/');
  assert.deepEqual(vse.sort(), [...zapsane].sort(), 'žádný soubor navíc ani chybějící');
});
