// Board na GitHub Projects jako pohled na štítky: srovná pole „Stav týmu“ podle štítků `stav:*`
// a přidá do projektu otevřená issues a PR. Stav se dál vede štítky, board jen zobrazuje.
// Běží přes den (gh s oprávněním `project`). Noční směna ho nepoužívá, cloud nepustí GraphQL.
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { repozitar } from '../.claude/nastroje/github-noc.mjs';

export const NAZEV_PROJEKTU = 'Tým agentů';
export const POLE = 'Stav týmu';
export const HOTOVO = 'Hotovo';
// Když má úkol víc stavových štítků, vyhraje ten, který víc potřebuje pozornost.
const PRIORITA = [
  ['blokovano', 'Blokováno'], ['stav:ceka-na-vlastnika', 'Čeká na vlastníka'], ['stav:revize', 'V revizi'],
  ['stav:rozpracovano', 'Rozpracováno'], ['stav:pripraveno', 'Připraveno'], ['stav:napad', 'Nápad'],
];

export function stavZeStitku(stitky) {
  return PRIORITA.find(([s]) => stitky.includes(s))?.[1] ?? null;
}

// polozky: [{ id, url, stav }] z projektu (jen z tohoto repozitáře), otevrene: [{ url, stitky }].
export function naplanuj(polozky, otevrene) {
  const podleUrl = new Map(polozky.map((p) => [p.url, p]));
  const otevreneUrl = new Set(otevrene.map((o) => o.url));
  const akce = [];
  for (const o of otevrene) {
    const cil = stavZeStitku(o.stitky);
    const p = podleUrl.get(o.url);
    if (!p) akce.push({ typ: 'pridat', url: o.url, stav: cil });
    else if (cil && p.stav !== cil) akce.push({ typ: 'nastavit', id: p.id, url: o.url, stav: cil });
  }
  for (const p of polozky) {
    if (!otevreneUrl.has(p.url) && p.stav !== HOTOVO) akce.push({ typ: 'nastavit', id: p.id, url: p.url, stav: HOTOVO });
  }
  return akce;
}

function ghCli(argumenty) {
  return new Promise((hotovo, chyba) => {
    execFile('gh', argumenty, { timeout: 30000, maxBuffer: 20e6, windowsHide: true }, (e, vystup, err) => {
      if (e) return chyba(new Error(String(err || e.message).trim().split('\n')[0]));
      hotovo(vystup.trim() ? JSON.parse(vystup) : null);
    });
  });
}

export async function srovnej({ repo, gh = ghCli, nasucho = false, vypis = console.log }) {
  const vlastnik = repo.split('/')[0];
  const seznam = await gh(['project', 'list', '--owner', vlastnik, '--format', 'json']);
  const projekt = seznam.projects.find((p) => p.title === NAZEV_PROJEKTU);
  if (!projekt) throw new Error(`Projekt „${NAZEV_PROJEKTU}“ neexistuje. Založ ho podle README.`);
  const pole = (await gh(['project', 'field-list', String(projekt.number), '--owner', vlastnik, '--format', 'json']))
    .fields.find((f) => f.name === POLE);
  if (!pole?.options) throw new Error(`Projekt nemá pole „${POLE}“ typu single select.`);
  const moznosti = new Map(pole.options.map((o) => [o.name, o.id]));
  for (const nazev of [...PRIORITA.map(([, n]) => n), HOTOVO]) {
    if (!moznosti.has(nazev)) throw new Error(`Pole „${POLE}“ nemá možnost „${nazev}“.`);
  }

  const klic = POLE.toLowerCase();
  const polozky = (await gh(['project', 'item-list', String(projekt.number), '--owner', vlastnik, '--format', 'json', '--limit', '1000']))
    .items.filter((i) => i.content?.url && i.content.repository === repo)
    .map((i) => ({ id: i.id, url: i.content.url, stav: i[klic] ?? null }));
  const otevrene = (await gh(['api', '--paginate', '--slurp', `repos/${repo}/issues?state=open&per_page=100`])).flat()
    .map((i) => ({ url: i.html_url, stitky: (i.labels ?? []).map((l) => l.name) }));

  const akce = naplanuj(polozky, otevrene);
  if (!akce.length) {
    vypis('Board odpovídá štítkům, nic se nemění.');
    return akce;
  }
  for (const a of akce) vypis(`${nasucho ? '[nasucho] ' : ''}${a.typ === 'pridat' ? 'přidat' : 'nastavit'} ${a.url}${a.stav ? ` → ${a.stav}` : ''}`);
  if (nasucho) return akce;

  const idProjektu = projekt.id;
  for (const a of akce) {
    let id = a.id;
    if (a.typ === 'pridat') id = (await gh(['project', 'item-add', String(projekt.number), '--owner', vlastnik, '--url', a.url, '--format', 'json'])).id;
    if (a.stav) {
      await gh(['project', 'item-edit', '--id', id, '--project-id', idProjektu, '--field-id', pole.id, '--single-select-option-id', moznosti.get(a.stav)]);
    }
  }
  vypis(`Hotovo: ${akce.length} změn.`);
  return akce;
}

const NAPOVEDA = `Board na GitHub Projects srovnaný se štítky.

Použití:
  node skripty/board.mjs            srovná pole „${POLE}“ v projektu „${NAZEV_PROJEKTU}“ podle štítků
  node skripty/board.mjs --nasucho  jen vypíše, co by změnil
  node skripty/board.mjs --help     tato nápověda`;

async function main(argumenty = process.argv.slice(2)) {
  if (argumenty.includes('--help')) return console.log(NAPOVEDA);
  try {
    await srovnej({ repo: repozitar(), nasucho: argumenty.includes('--nasucho') });
  } catch (chyba) {
    console.error(`Board nešel srovnat: ${chyba.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
