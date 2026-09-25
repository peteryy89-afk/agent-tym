import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nactiTym, posud } from '../.claude/hooks/strazce-retezu.mjs';

const HOOK = path.join(import.meta.dirname, '..', '.claude', 'hooks', 'strazce-retezu.mjs');
const DEN = false;
const NOC = true;
const tym = nactiTym();
const r = (volajici, cil, noc = DEN) => posud(volajici, cil, tym, noc)?.rozhodnuti ?? 'povoleno';

test('tým se načte z definic: 9 vedoucích a jejich členové', () => {
  assert.equal(tym.vedouci.size, 9);
  assert.ok(tym.vedouci.get('vyvoj-vedouci').has('backend'));
  assert.ok(tym.nasi.has('tester'));
});

test('řetěz velení: manažer → vedoucí → člen je povolený ve dne i v noci', () => {
  for (const p of [DEN, NOC]) {
    assert.equal(r(null, 'vyvoj-vedouci', p), 'povoleno');
    assert.equal(r('vyvoj-vedouci', 'backend', p), 'povoleno');
    assert.equal(r('kvalita-vedouci', 'tester', p), 'povoleno');
  }
});

test('zkratky a přeskoky mezi týmy se zamítají', () => {
  assert.equal(r(null, 'backend'), 'deny');
  assert.match(posud(null, 'backend', tym, DEN).duvod, /vyvoj-vedouci/);
  assert.equal(r('vyvoj-vedouci', 'tester'), 'deny');
  assert.equal(r('vyvoj-vedouci', 'kvalita-vedouci'), 'deny');
  assert.equal(r('vyvoj-vedouci', 'vyvoj-vedouci'), 'deny');
  assert.equal(r('backend', 'tester'), 'deny');
  assert.equal(r('general-purpose', 'backend'), 'deny');
  for (const cil of ['fork', 'general-purpose', 'Backend', 'plugin:backend']) assert.equal(r('vyvoj-vedouci', cil), 'deny', cil);
});

test('vestavění agenti: přes den jen čtecí bez dotazu, ostatní s dotazem, v noci nic', () => {
  assert.equal(r(null, 'Explore'), 'povoleno');
  assert.equal(r(null, 'general-purpose'), 'ask');
  assert.equal(r(null, 'fork'), 'ask');
  assert.equal(r(null, 'Explore', NOC), 'deny');
  assert.equal(r(null, 'general-purpose', NOC), 'deny');
});

function spust(vstup, prostredi = { AGENT_TYM_DEN: '1' }) {
  const vystup = execFileSync(process.execPath, [HOOK], { input: vstup, encoding: 'utf8', env: { ...process.env, NOCNI_SMENA: '', CLAUDE_CODE_REMOTE: '', ...prostredi } });
  return vystup ? JSON.parse(vystup).hookSpecificOutput.permissionDecision : 'povoleno';
}

test('hook: čte typ volajícího ze vstupu a při chybě nic nepustí', () => {
  const agent = (volajici, cil) => JSON.stringify({ tool_name: 'Agent', ...(volajici ? { agent_type: volajici } : {}), tool_input: { subagent_type: cil } });
  assert.equal(spust(agent(null, 'vyvoj-vedouci')), 'povoleno');
  assert.equal(spust(agent('vyvoj-vedouci', 'backend')), 'povoleno');
  assert.equal(spust(agent('backend', 'tester')), 'deny');
  assert.equal(spust(agent(null, 'backend')), 'deny');
  assert.equal(spust(JSON.stringify({ tool_name: 'Task', agent_type: 'backend', tool_input: { subagent_type: 'tester' } })), 'deny');
  assert.equal(spust(JSON.stringify({ tool_name: 'Agent', agent_type: 'vyvoj-vedouci', tool_input: {} })), 'deny', 'bez subagent_type je to general-purpose');
  assert.equal(spust(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } })), 'povoleno');
  assert.equal(spust('nesmysl'), 'ask');
  assert.equal(spust('nesmysl', { AGENT_TYM_DEN: '' }), 'deny');
});

test('frontmatter s CRLF i nečitelná složka agentů', () => {
  const slozka = fs.mkdtempSync(path.join(os.tmpdir(), 'retez-'));
  fs.writeFileSync(path.join(slozka, 'a-vedouci.md'), '---\r\nname: a-vedouci\r\ntools: Agent(b), Read\r\n---\r\ntext');
  fs.writeFileSync(path.join(slozka, 'b.md'), '---\r\nname: b\r\ntools: Read\r\n---\r\ntext');
  const t = nactiTym(slozka);
  assert.equal(posud('a-vedouci', 'b', t, false), null);
  assert.throws(() => nactiTym(path.join(slozka, 'neexistuje')));
});
