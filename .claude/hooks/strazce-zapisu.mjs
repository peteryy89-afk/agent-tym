// PreToolUse hook pro Write, Edit a NotebookEdit.
// Blokuje zápis tajných klíčů. U chráněných souborů se zeptá vlastníka (PROCES.md, sekce 6).
import { pathToFileURL } from 'node:url';

const TAJNE = /(^|\/)(\.env(\.[\w.-]+)?|[^/]+\.(pem|key|p12|pfx)|id_(rsa|ed25519)[^/]*)$/i;
const CHRANENE = /^(PROCES\.md|CLAUDE\.md|\.gitleaks\.toml|\.claude\/.*|\.github\/.*)$/;

// Cesty z Windows i POSIX na jednotný tvar, aby hook fungoval lokálně i v cloudu.
const sjednot = (p) => p.replaceAll('\\', '/').replace(/\/+$/, '');

export function relativniCesta(souborovaCesta, projekt) {
  const cesta = sjednot(souborovaCesta);
  const koren = sjednot(projekt);
  if (!/^([a-zA-Z]:)?\//.test(cesta)) return cesta.replace(/^\.\//, '');
  const windows = /^[a-zA-Z]:\//.test(koren);
  const [c, k] = windows ? [cesta.toLowerCase(), koren.toLowerCase()] : [cesta, koren];
  return c.startsWith(`${k}/`) ? cesta.slice(koren.length + 1) : null;
}

export function posud(souborovaCesta, projekt) {
  if (!souborovaCesta) return null;
  const cesta = sjednot(souborovaCesta);
  if (TAJNE.test(cesta)) return { rozhodnuti: 'deny', duvod: 'Soubory s tajnými klíči agenti nezapisují (PROCES.md, sekce 8).' };
  const relativni = relativniCesta(souborovaCesta, projekt);
  if (relativni !== null && CHRANENE.test(relativni))
    return { rozhodnuti: 'ask', duvod: `${relativni} je chráněný soubor. Změnu schvaluje vlastník (PROCES.md, sekce 6).` };
  return null;
}

async function main() {
  let vstup = '';
  for await (const kus of process.stdin) vstup += kus;
  const data = JSON.parse(vstup);
  const projekt = process.env.CLAUDE_PROJECT_DIR || data.cwd || process.cwd();
  const cesta = data.tool_input?.file_path ?? data.tool_input?.notebook_path;
  const vysledek = posud(cesta, projekt);
  if (!vysledek) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: vysledek.rozhodnuti,
      permissionDecisionReason: vysledek.duvod,
    },
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
