import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { posud } from '../.claude/hooks/strazce-prikazu.mjs';

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

test('každé pravidlo pro Bash má dvojče pro PowerShell', () => {
  for (const [druh, pravidla] of Object.entries(nastaveni.permissions)) {
    for (const r of pravidla.filter((x) => x.startsWith('Bash('))) {
      assert.ok(pravidla.includes(r.replace(/^Bash\(/, 'PowerShell(')), `${druh}: chybí PowerShell k ${r}`);
    }
  }
});

test('strážce příkazů zachytí i zápis typický pro PowerShell', () => {
  const den = { AGENT_TYM_DEN: '1' };
  const bezPR = () => null;
  for (const p of ['& gh pr merge 5 --squash', 'gh pr merge 5 --squash; Write-Output hotovo', 'git commit --no-verify -m x']) {
    assert.notEqual(posud(p, bezPR, den)?.rozhodnuti ?? 'povoleno', 'povoleno', p);
  }
});
