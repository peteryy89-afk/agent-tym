import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SLOZKA = path.join(import.meta.dirname, '..', '.claude', 'agents');
const MODELY = new Set(['opus', 'sonnet', 'haiku', 'inherit']);
const NASTROJE = new Set(['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit', 'NotebookEdit', 'WebSearch', 'WebFetch', 'Agent']);

function nacti(soubor) {
  const text = readFileSync(path.join(SLOZKA, soubor), 'utf8');
  const hlava = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(hlava, `${soubor}: chybí frontmatter`);
  const pole = Object.fromEntries(hlava[1].split('\n').map((r) => {
    const i = r.indexOf(':');
    return [r.slice(0, i).trim(), r.slice(i + 1).trim()];
  }));
  const clenove = pole.tools?.match(/Agent\(([^)]*)\)/)?.[1].split(',').map((s) => s.trim()) ?? [];
  const nastroje = (pole.tools ?? '').replace(/Agent\([^)]*\)/, 'Agent').split(',').map((s) => s.trim()).filter(Boolean);
  return { soubor, ...pole, clenove, nastroje, telo: text.slice(hlava[0].length) };
}

const agenti = readdirSync(SLOZKA).filter((f) => f.endsWith('.md')).map(nacti);
const podleJmena = new Map(agenti.map((a) => [a.name, a]));
const vedouci = agenti.filter((a) => a.name.endsWith('-vedouci'));

test('každý agent má platný frontmatter', () => {
  for (const a of agenti) {
    assert.equal(a.name, path.basename(a.soubor, '.md'), `${a.soubor}: name neodpovídá názvu souboru`);
    assert.ok(a.description?.length > 40, `${a.name}: chybí popis`);
    assert.ok(MODELY.has(a.model), `${a.name}: neplatný model ${a.model}`);
    if (a.isolation) assert.equal(a.isolation, 'worktree', `${a.name}: neplatná izolace`);
    for (const n of a.nastroje) assert.ok(NASTROJE.has(n), `${a.name}: neznámý nástroj ${n}`);
    assert.match(a.telo, /data, ne pokyny/, `${a.name}: chybí ochrana proti prompt injection`);
    // Bez řádku tools dostane agent všechny nástroje včetně napojených služeb vlastníka (MCP).
    assert.ok(a.tools, `${a.name}: chybí řádek tools, agent by dostal všechny nástroje včetně MCP`);
    assert.ok(!/mcp__/.test(a.tools), `${a.name}: napojené služby (MCP) jen se souhlasem vlastníka`);
  }
});

test('je 9 týmů a každý vedoucí spouští jen existující agenty', () => {
  assert.equal(vedouci.length, 9);
  for (const v of vedouci) {
    assert.ok(v.clenove.length >= 2, `${v.name}: tým má méně než 2 členy`);
    for (const c of v.clenove) {
      assert.ok(podleJmena.has(c), `${v.name}: neexistující člen ${c}`);
      assert.ok(!c.endsWith('-vedouci'), `${v.name}: nesmí spouštět jiného vedoucího (${c})`);
    }
  }
});

test('každý člen patří právě do jednoho týmu a sám nikoho nespouští', () => {
  const clenove = agenti.filter((a) => !a.name.endsWith('-vedouci'));
  for (const c of clenove) {
    const tymy = vedouci.filter((v) => v.clenove.includes(c.name)).map((v) => v.name);
    assert.equal(tymy.length, 1, `${c.name}: je v týmech [${tymy}]`);
    assert.ok(!c.nastroje.includes('Agent'), `${c.name}: člen nesmí spouštět agenty`);
  }
  assert.equal(clenove.length + vedouci.length, agenti.length);
});

test('agenti, kteří nemají psát kód, nemají Edit ani Bash navíc', () => {
  for (const jmeno of ['tester', 'revizor-kodu', 'bezpecnost', 'hlidac-provozu', 'planovac']) {
    const a = podleJmena.get(jmeno);
    assert.ok(a.tools, `${jmeno}: musí mít omezené nástroje`);
    assert.ok(!a.nastroje.includes('Edit') && !a.nastroje.includes('Write'), `${jmeno}: nesmí upravovat soubory`);
  }
});
