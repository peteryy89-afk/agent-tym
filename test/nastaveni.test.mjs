import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { posud } from '../.claude/hooks/strazce-prikazu.mjs';
import { posud as posudZapis } from '../.claude/hooks/strazce-zapisu.mjs';

const KOREN = path.join(import.meta.dirname, '..');
const nastaveni = JSON.parse(fs.readFileSync(path.join(KOREN, '.claude', 'settings.json'), 'utf8'));
const prikazy = Object.values(nastaveni.hooks).flat().flatMap((m) => m.hooks.map((h) => ({ matcher: m.matcher, prikaz: h.command })));

// Na Windows spouští Claude Code hooky přes PowerShell, kde se "$CLAUDE_PROJECT_DIR" nerozvine.
// Hook pak nenajde soubor, spadne a akci pustí. Zápis ${CLAUDE_PROJECT_DIR} rozvine Claude Code
// sám, takže funguje na Windows i v cloudu (ověřeno 25. 9. 2026 na obou).
test('všechny hooky odkazují na skript přes ${CLAUDE_PROJECT_DIR} a skript existuje', () => {
  assert.ok(prikazy.length >= 9);
  for (const { prikaz } of prikazy) {
    const shoda = prikaz.match(/^node "\$\{CLAUDE_PROJECT_DIR\}\/(\.claude\/hooks\/[\w-]+\.mjs)"$/);
    assert.ok(shoda, `hook má nepřenositelný příkaz: ${prikaz}`);
    assert.ok(fs.existsSync(path.join(KOREN, shoda[1])), `chybí ${shoda[1]}`);
  }
});

test('strážce příkazů hlídá Bash i PowerShell', () => {
  const strazce = prikazy.find((p) => p.prikaz.includes('strazce-prikazu'));
  assert.deepEqual(strazce.matcher.split('|').sort(), ['Bash', 'PowerShell']);
});

test('zákazy pro Bash platí i pro PowerShell, povolení bez dotazu pro PowerShell nejsou', () => {
  const { deny, allow } = nastaveni.permissions;
  for (const r of deny.filter((x) => x.startsWith('Bash('))) {
    assert.ok(deny.includes(r.replace(/^Bash\(/, 'PowerShell(')), `deny: chybí PowerShell k ${r}`);
  }
  // U Bash Claude Code složené příkazy rozkládá, u PowerShellu to není ověřené
  // (gh issue list; Remove-Item ...). Proto se v PowerShellu ptá na každý příkaz.
  assert.ok(!allow.some((x) => x.startsWith('PowerShell(')));
});

const den = { AGENT_TYM_DEN: '1' };
const vyrok = (p, prostredi = den) => posud(p, () => null, prostredi)?.rozhodnuti ?? 'povoleno';

test('strážce příkazů zachytí i zápis typický pro PowerShell (revize PR #14)', () => {
  for (const p of ['& gh pr merge 5 --squash', 'gh pr merge 5 --squash; Write-Output hotovo']) {
    assert.equal(vyrok(p), 'ask', p);
    assert.equal(vyrok(p, {}), 'deny', `v noci: ${p}`);
  }
  for (const p of ['git commit --no-verify -m x',
    'gh.exe secret list', 'GH auth token', 'gh.exe repo delete x --yes', 'GIT push --force origin x', 'g`h secret list',
    'Get-Content .\\.env', 'type C:\\repo\\.env', 'git commit -n -m x']) {
    assert.equal(vyrok(p), 'deny', p);
    assert.equal(vyrok(p, {}), 'deny', `v noci: ${p}`);
  }
  for (const p of ['Set-Content .claude\\settings.json x', 'Copy-Item x .github\\workflows\\a.yml', 'remove-item PROCES.md', 'Out-File -FilePath claude.md',
    'sc PROCES.md x', 'git status; del .claude\\settings.json']) {
    assert.equal(vyrok(p), 'ask', p);
  }
  for (const p of ['git commit -m "Oprava"', 'git commit --amend --no-edit', 'Get-Content README.md', 'gh issue list',
    'git commit -m "Uprav test, jak mi řekl vlastník (CLAUDE.md)"', 'git commit -m "Čekám na ni, pak .claude/hooks"']) {
    assert.equal(vyrok(p), 'povoleno', p);
    assert.equal(vyrok(p, {}), 'povoleno', `v noci: ${p}`);
  }
  for (const p of ['& "gh.exe" auth token', "& 'C:\\Program Files\\GitHub CLI\\gh.exe' auth token", '/usr/bin/gh secret list']) {
    assert.equal(vyrok(p), 'deny', p);
  }
});

test('strážce zápisu nerozlišuje velikost písmen u chráněných souborů (Windows)', () => {
  const koren = 'C:\\repo';
  for (const c of ['C:\\repo\\.CLAUDE\\settings.json', 'C:\\repo\\proces.md', 'C:\\repo\\.GitHub\\workflows\\a.yml']) {
    assert.equal(posudZapis(c, koren, den)?.rozhodnuti, 'ask', c);
  }
  assert.equal(posudZapis('C:\\repo\\README.md', koren, den), null);
});
