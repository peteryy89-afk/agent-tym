import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { nactiTym, posud } from '../.claude/hooks/strazce-retezu.mjs';

const HOOK = path.join(import.meta.dirname, '..', '.claude', 'hooks', 'strazce-retezu.mjs');
const DEN = { AGENT_TYM_DEN: '1' };
const NOC = {};
const tym = nactiTym();
const r = (volajici, cil, prostredi = DEN) => posud(volajici, cil, tym, prostredi)?.rozhodnuti ?? 'povoleno';

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
});

test('vestavění agenti: přes den jen čtecí bez dotazu, ostatní s dotazem, v noci nic', () => {
  assert.equal(r(null, 'Explore'), 'povoleno');
  assert.equal(r(null, 'general-purpose'), 'ask');
  assert.equal(r(null, 'fork'), 'ask');
  assert.equal(r(null, 'Explore', NOC), 'deny');
  assert.equal(r(null, 'general-purpose', NOC), 'deny');
});

function spust(vstup, prostredi = DEN) {
  const vystup = execFileSync(process.execPath, [HOOK], { input: vstup, encoding: 'utf8', env: { ...process.env, NOCNI_SMENA: '', CLAUDE_CODE_REMOTE: '', ...prostredi } });
  return vystup ? JSON.parse(vystup).hookSpecificOutput.permissionDecision : 'povoleno';
}

test('hook: čte typ volajícího ze vstupu a při chybě nic nepustí', () => {
  const agent = (volajici, cil) => JSON.stringify({ tool_name: 'Agent', ...(volajici ? { agent_type: volajici } : {}), tool_input: { subagent_type: cil } });
  assert.equal(spust(agent(null, 'vyvoj-vedouci')), 'povoleno');
  assert.equal(spust(agent('vyvoj-vedouci', 'backend')), 'povoleno');
  assert.equal(spust(agent('backend', 'tester')), 'deny');
  assert.equal(spust(agent(null, 'backend')), 'deny');
  assert.equal(spust(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } })), 'povoleno');
  assert.equal(spust('nesmysl'), 'ask');
  assert.equal(spust('nesmysl', { AGENT_TYM_DEN: '' }), 'deny');
});
