// Hook pro Velín: zapisuje, kdy který agent začal a skončil (SubagentStart, SubagentStop,
// spuštění přes nástroj Agent a začátek a konec session) do `.agent-tym/aktivita.jsonl`.
// Nic nerozhoduje a nikdy neblokuje: vždy skončí kódem 0 a nic nevypíše.
// Zapisuje jen povolená pole. Vstup hooku obsahuje cesty (cwd, transcript_path) a celé zadání
// podagenta, které se do záznamu nesmí dostat. Záznam je v .gitignore a nikam se neposílá.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { jeNoc } from './rezim.mjs';

export const SOUBOR = path.join(fileURLToPath(new URL('../../', import.meta.url)), '.agent-tym', 'aktivita.jsonl');
export const MAX_VELIKOST = 1_000_000;
const MAX_POPIS = 120;

const zkrat = (id) => (id ? crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 10) : null);
const typ = (t) => (typeof t === 'string' && /^[\w:.-]{1,64}$/.test(t) ? t : null);

// Popis úkolu: jeden řádek, bez řídicích znaků, cest a klíčů, nejvýše MAX_POPIS znaků.
export function ocisti(text) {
  if (typeof text !== 'string') return null;
  const radek = text.split(/\r?\n/).find((r) => r.trim()) ?? '';
  const cisty = radek
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[A-Za-z]:[\\/][^\s"'`]*/g, '‹cesta›')
    .replace(/\/(?:Users|home|mnt|tmp|var|root)\/[^\s"'`]*/g, '‹cesta›')
    .replace(/\b(?:gh[pousr]_|github_pat_|sk-ant-|sk-|AKIA|xox[abpr]-)[A-Za-z0-9_-]{10,}/g, '‹klíč›')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cisty) return null;
  return cisty.length > MAX_POPIS ? `${cisty.slice(0, MAX_POPIS - 1)}…` : cisty;
}

export function zaznam(data, prostredi = process.env, ted = new Date()) {
  const spolecne = { cas: ted.toISOString(), session: zkrat(data.session_id), rezim: jeNoc(prostredi) ? 'noc' : 'den' };
  switch (data.hook_event_name) {
    case 'SessionStart':
      return { ...spolecne, udalost: 'session-start' };
    case 'SessionEnd':
      return { ...spolecne, udalost: 'session-konec' };
    case 'PreToolUse': {
      if (!/^(Agent|Task)$/.test(data.tool_name ?? '')) return null;
      const vstup = data.tool_input ?? {};
      return {
        ...spolecne, udalost: 'spusteni',
        volajici: zkrat(data.agent_id), volajiciTyp: typ(data.agent_type),
        cil: typ(vstup.subagent_type) ?? 'general-purpose', popis: ocisti(vstup.description), model: typ(vstup.model),
      };
    }
    case 'SubagentStart':
      return { ...spolecne, udalost: 'start', agent: zkrat(data.agent_id), typ: typ(data.agent_type), popis: ocisti(data.task_prompt) };
    case 'SubagentStop':
      return { ...spolecne, udalost: 'konec', agent: zkrat(data.agent_id), typ: typ(data.agent_type) };
    default:
      return null;
  }
}

export function zapis(radek, soubor = SOUBOR) {
  fs.mkdirSync(path.dirname(soubor), { recursive: true });
  try {
    if (fs.statSync(soubor).size > MAX_VELIKOST) fs.renameSync(soubor, soubor.replace(/\.jsonl$/, '.1.jsonl'));
  } catch {}
  fs.appendFileSync(soubor, `${JSON.stringify(radek)}\n`);
}

async function main() {
  try {
    let vstup = '';
    for await (const kus of process.stdin) vstup += kus;
    const radek = zaznam(JSON.parse(vstup));
    if (radek) zapis(radek);
  } catch {}
  process.exitCode = 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
