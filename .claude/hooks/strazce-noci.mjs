// PreToolUse hook pro konektory (mcp__*) a podagenty (Agent).
// Konektory jdou mimo strážce příkazů a zápisů (e-mail, disky, účty vlastníka) a tým je
// nepotřebuje. Přes den se proto ptá vlastníka, v noci je zamítá. V noci také hlídá spotřebu
// limitu: podagenti jen na levnějším modelu a nejvýše MAX_PODAGENTU za jedno spuštění.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { jeNoc } from './rezim.mjs';

export const MAX_PODAGENTU = 20;
const LEVNE_MODELY = new Set(['sonnet', 'haiku']);

export function posud(nastroj, vstup = {}, prostredi = process.env, zapocitej = () => 1) {
  const noc = jeNoc(prostredi);
  if (nastroj.startsWith('mcp__'))
    return noc
      ? { rozhodnuti: 'deny', duvod: 'V noční směně se konektory nepoužívají (NOCNI-SMENA.md, sekce 4).' }
      : { rozhodnuti: 'ask', duvod: 'Konektor jde mimo pojistky týmu. Potvrď, jen pokud ho opravdu chceš použít.' };
  if (!noc || !/^(Agent|Task)$/.test(nastroj)) return null;
  if (vstup.subagent_type === 'fork')
    return { rozhodnuti: 'deny', duvod: 'V noční směně se nepoužívá fork (dědí model hlavní session). Spusť pojmenovaného agenta s model: "sonnet".' };
  if (!LEVNE_MODELY.has(vstup.model))
    return { rozhodnuti: 'deny', duvod: 'V noční směně spouštěj podagenty s model: "sonnet" (šetří limit předplatného).' };
  if (zapocitej() > MAX_PODAGENTU)
    return { rozhodnuti: 'deny', duvod: `V noční směně je strop ${MAX_PODAGENTU} podagentů na spuštění. Dokonči rozpracované a napiš ranní zprávu.` };
  return null;
}

// Počítadlo v dočasném souboru podle session. Když nejde zapsat, vrátí nekonečno:
// bez počítadla se podagenti v noci nespouštějí.
function pocitadlo(relace) {
  return () => {
    try {
      const soubor = path.join(os.tmpdir(), `agent-tym-podagenti-${String(relace).replace(/[^\w-]/g, '')}.txt`);
      let pocet = 0;
      try {
        pocet = Number(fs.readFileSync(soubor, 'utf8')) || 0;
      } catch {}
      fs.writeFileSync(soubor, String(pocet + 1));
      return pocet + 1;
    } catch {
      return Infinity;
    }
  };
}

async function main() {
  let vstup = '';
  for await (const kus of process.stdin) vstup += kus;
  let vysledek;
  try {
    const data = JSON.parse(vstup);
    vysledek = posud(data.tool_name ?? '', data.tool_input ?? {}, process.env, pocitadlo(data.session_id ?? 'bez-session'));
  } catch {
    // neplatný vstup i pád hooku: Claude Code by akci pustil, proto rozhodujeme výslovně
    vysledek = { rozhodnuti: jeNoc() ? 'deny' : 'ask', duvod: 'Strážce noci nedostal platný vstup. Akci nešlo ověřit.' };
  }
  if (!vysledek) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: vysledek.rozhodnuti, permissionDecisionReason: vysledek.duvod },
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
