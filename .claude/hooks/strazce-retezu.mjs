// PreToolUse hook pro nástroj Agent: vynucuje řetěz velení (PROCES.md, sekce 1).
// Claude Code seznam v `tools: Agent(...)` u podagenta ignoruje (issue #3), proto to hlídá hook.
// Volajícího pozná podle `agent_type` ve vstupu hooku. Když chybí, volá hlavní session (manažer).
// Ověřeno naostro 25. 9. 2026: podagent spustí podagenta a PreToolUse nese typ volajícího.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { jeNoc } from './rezim.mjs';

const SLOZKA = fileURLToPath(new URL('../agents/', import.meta.url));
// Vestavění agenti Claude Code, kteří jen čtou. Manažer je smí přes den spouštět bez dotazu.
const JEN_CTENI = new Set(['Explore', 'Plan', 'claude-code-guide']);

// Týmy z `tools: Agent(...)` vedoucích, stejně jako test/agenti.test.mjs.
export function nactiTym(slozka = SLOZKA) {
  const vedouci = new Map();
  const nasi = new Set();
  for (const soubor of fs.readdirSync(slozka).filter((f) => f.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(slozka, soubor), 'utf8').replace(/\r\n/g, '\n');
    const hlava = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    const jmeno = hlava.match(/^name:\s*(\S+)/m)?.[1] ?? path.basename(soubor, '.md');
    nasi.add(jmeno);
    if (jmeno.endsWith('-vedouci')) {
      const clenove = hlava.match(/^tools:.*Agent\(([^)]*)\)/m)?.[1].split(',').map((s) => s.trim()).filter(Boolean) ?? [];
      vedouci.set(jmeno, new Set(clenove));
    }
  }
  if (!vedouci.size) throw new Error('Nenašel jsem žádného vedoucího týmu.');
  return { vedouci, nasi };
}

const zamitni = (duvod) => ({ rozhodnuti: 'deny', duvod });

export function posud(volajici, cil, tym, prostredi = process.env) {
  const noc = jeNoc(prostredi);
  const vedouciClena = [...tym.vedouci].find(([, clenove]) => clenove.has(cil))?.[0];
  if (!volajici) {
    if (tym.vedouci.has(cil)) return null;
    if (tym.nasi.has(cil)) return zamitni(`Manažer zadává práci jen vedoucím týmů (PROCES.md, sekce 1). ${cil} spouští ${vedouciClena ?? 'jeho vedoucí'}.`);
    if (noc) return zamitni('V noční směně spouští hlavní session jen vedoucí týmů (NOCNI-SMENA.md, sekce 3).');
    if (JEN_CTENI.has(cil)) return null;
    return { rozhodnuti: 'ask', duvod: `Agent ${cil} je mimo tým a obchází řetěz velení. Potvrď, jen pokud ho opravdu chceš.` };
  }
  if (tym.vedouci.has(volajici)) {
    if (tym.vedouci.get(volajici).has(cil)) return null;
    return zamitni(`${volajici} smí spouštět jen členy svého týmu (${[...tym.vedouci.get(volajici)].join(', ')}). O jiný tým požádej manažera.`);
  }
  return zamitni(`${volajici} nesmí spouštět další agenty (PROCES.md, sekce 1). Vrať výsledek tomu, kdo tě spustil.`);
}

async function main() {
  let vstup = '';
  for await (const kus of process.stdin) vstup += kus;
  let vysledek;
  try {
    const data = JSON.parse(vstup);
    if (!/^(Agent|Task)$/.test(data.tool_name ?? '')) return;
    const cil = data.tool_input?.subagent_type || 'general-purpose';
    vysledek = posud(data.agent_type || null, cil, nactiTym());
  } catch {
    // neplatný vstup i pád: Claude Code by akci pustil, proto rozhodujeme výslovně
    vysledek = { rozhodnuti: jeNoc() ? 'deny' : 'ask', duvod: 'Strážce řetězu velení nedostal platný vstup. Spuštění agenta nešlo ověřit.' };
  }
  if (!vysledek) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: vysledek.rozhodnuti, permissionDecisionReason: vysledek.duvod },
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: jeNoc() ? 'deny' : 'ask', permissionDecisionReason: 'Strážce řetězu velení selhal.' },
    }));
  });
}
