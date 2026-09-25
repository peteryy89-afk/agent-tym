// Režim práce: den (vlastník u počítače) nebo noc (bez vlastníka, NOCNI-SMENA.md).
// Výchozí je noc. Denní režim zapíná jen proměnná AGENT_TYM_DEN=1 z lokálního
// `.claude/settings.local.json`, který v repozitáři není. Cloud, rutina i cizí klon
// proto běží vždy v nočním režimu, i když někdo zapomene nastavit NOCNI_SMENA.
import { pathToFileURL } from 'node:url';

export function jeNoc(prostredi = process.env) {
  if (prostredi.NOCNI_SMENA === '1' || prostredi.CLAUDE_CODE_REMOTE === 'true') return true;
  return prostredi.AGENT_TYM_DEN !== '1';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(jeNoc() ? 'noc' : 'den');
