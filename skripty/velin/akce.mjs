// Akce z Velínu. Každá jen mění štítky nebo zakládá a zavírá issues na GitHubu, stav se dál
// vede štítky (PROCES.md, sekce 3). Nic neslučuje, nemaže ani nemění kód.
// Vstup přichází z prohlížeče, proto se každé pole ověřuje a na GitHub jde jen pevný tvar.
import { execFile } from 'node:child_process';
import { VYLUCUJICI } from '../../.claude/nastroje/github-noc.mjs';

export const STAVY = ['stav:napad', 'stav:pripraveno', 'stav:rozpracovano', 'stav:revize', 'stav:ceka-na-vlastnika'];
const MAX_NAZEV = 120;
const MAX_POPIS = 5000;

function ghCli(argumenty, vstup) {
  return new Promise((hotovo, chyba) => {
    const proces = execFile('gh', argumenty, { timeout: 30000, maxBuffer: 20e6, windowsHide: true }, (e, vystup, err) => {
      if (e) return chyba(new Error(String(err || e.message).trim().split('\n')[0].slice(0, 200)));
      try {
        hotovo(vystup.trim() ? JSON.parse(vystup) : null);
      } catch {
        hotovo(null);
      }
    });
    if (vstup !== undefined) proces.stdin.end(JSON.stringify(vstup));
  });
}

const cislo = (n) => {
  if (!Number.isInteger(n) || n < 1 || n > 1e7) throw new Error('Neplatné číslo úkolu.');
  return n;
};
const stejny = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const stitky = (x) => (x.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
const text = (hodnota, max, nazev) => {
  if (typeof hodnota !== 'string') throw new Error(`${nazev} chybí.`);
  const t = hodnota.replace(/\r\n/g, '\n').trim();
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(t)) throw new Error(`${nazev} obsahuje řídicí znaky.`);
  if (!t.length || t.length > max) throw new Error(`${nazev} musí mít 1 až ${max} znaků.`);
  return t;
};

export function vytvorAkce({ repo, gh = ghCli }) {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? '') || repo.includes('..')) throw new Error('Repozitář není známý.');
  const api = (cesta, metoda = 'GET', vstup) => gh(['api', '--method', metoda, `repos/${repo}${cesta}`, ...(vstup ? ['--input', '-'] : [])], vstup);
  let vlastnik = null;
  const zjistiVlastnika = async () => (vlastnik ??= (await api('')).owner.login);
  const pridej = (n, stitek) => api(`/issues/${n}/labels`, 'POST', { labels: [stitek] });
  const odeber = (n, stitek) => api(`/issues/${n}/labels/${encodeURIComponent(stitek)}`, 'DELETE').catch((e) => {
    if (!/404|not found/i.test(e.message)) throw e;
  });

  const nastavStav = async (n, issue, stav) => {
    for (const s of stitky(issue).filter((x) => STAVY.includes(x) && x !== stav)) await odeber(n, s);
    if (!stitky(issue).includes(stav)) await pridej(n, stav);
  };

  const akce = {
    // Na noc jen issue od vlastníka, stejně jako to čte github-noc. Noční směna bere úkoly
    // s noc:ano a stav:pripraveno, proto se při poslání na noc nastaví i stav.
    async noc({ cislo: n, zapnout }) {
      if (zapnout !== true && zapnout !== false) throw new Error('Chybí zapnout: true/false.');
      const issue = await api(`/issues/${cislo(n)}`);
      if (issue.pull_request) throw new Error('Na noc jde poslat jen úkol, ne PR.');
      if (!stejny(issue.user?.login, await zjistiVlastnika())) throw new Error('Na noc jde poslat jen úkol, který založil vlastník.');
      if (issue.state !== 'open') throw new Error('Úkol je zavřený.');
      if (!zapnout) {
        await odeber(n, 'noc:ano');
        return `#${n}: odebrán z noci.`;
      }
      await nastavStav(n, issue, 'stav:pripraveno');
      await pridej(n, 'noc:ano');
      const prekazky = stitky(issue).filter((s) => VYLUCUJICI.includes(s));
      return prekazky.length
        ? `#${n}: má noc:ano, ale noční směna ho nevezme kvůli štítku ${prekazky.join(', ')}.`
        : `#${n}: poslán na noc (stav připraveno).`;
    },

    async nocStop({ zapnout }) {
      const otevrene = await api('/issues?state=open&labels=noc:stop&per_page=100');
      if (zapnout === true) {
        if (otevrene.length) return 'Noc už je zastavená.';
        const nove = await api('/issues', 'POST', {
          title: 'Noc zastavena z Velínu',
          body: 'Vlastník zastavil noční směnu z Velínu. Zavřením tohoto issue ji zase pustíš.',
          labels: ['noc:stop'],
        });
        return `Noc zastavena (#${nove.number}).`;
      }
      if (zapnout !== false) throw new Error('Chybí zapnout: true/false.');
      for (const i of otevrene) await api(`/issues/${i.number}`, 'PATCH', { state: 'closed' });
      return otevrene.length ? `Noc puštěna (zavřeno ${otevrene.length}× noc:stop).` : 'Noc nebyla zastavená.';
    },

    async schvalit({ cislo: n }) {
      const pr = await api(`/pulls/${cislo(n)}`);
      if (pr.state !== 'open') throw new Error('PR není otevřený.');
      if (stitky(pr).includes('schvaleno-vlastnikem')) return `PR #${n} už je schválený.`;
      await pridej(n, 'schvaleno-vlastnikem');
      return `PR #${n} schválen. Sloučí ho manažer po zelené CI.`;
    },

    async stav({ cislo: n, stav }) {
      if (!STAVY.includes(stav)) throw new Error('Neznámý stav.');
      const issue = await api(`/issues/${cislo(n)}`);
      if (issue.pull_request) throw new Error('Stav se posouvá jen u úkolů.');
      if (issue.state !== 'open') throw new Error('Úkol je zavřený.');
      await nastavStav(n, issue, stav);
      return `#${n}: stav ${stav.replace('stav:', '')}.`;
    },

    async novy({ nazev, popis = '' }) {
      const n = text(nazev, MAX_NAZEV, 'Název');
      const p = popis === '' ? '' : text(popis, MAX_POPIS, 'Popis');
      const issue = await api('/issues', 'POST', { title: n, body: `${p}\n\n_Založeno z Velínu._`.trim(), labels: ['stav:napad'] });
      return `Založen úkol #${issue.number}.`;
    },
  };

  return async function proved(pozadavek) {
    if (!pozadavek || typeof pozadavek !== 'object' || !Object.hasOwn(akce, pozadavek.typ)) throw new Error('Neznámá akce.');
    return akce[pozadavek.typ](pozadavek);
  };
}
