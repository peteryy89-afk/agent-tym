import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stavZeStitku, naplanuj, srovnej, POLE, HOTOVO } from '../skripty/board.mjs';

const U = (n) => `https://github.com/vlastnik/tym/issues/${n}`;

test('stav ze štítků: vyhraje ten, který víc potřebuje pozornost', () => {
  assert.equal(stavZeStitku(['stav:napad']), 'Nápad');
  assert.equal(stavZeStitku(['stav:rozpracovano', 'blokovano']), 'Blokováno');
  assert.equal(stavZeStitku(['stav:revize', 'stav:ceka-na-vlastnika']), 'Čeká na vlastníka');
  assert.equal(stavZeStitku(['bug']), null);
});

test('plán: přidá chybějící, srovná změněné, zavřené označí Hotovo, zbytek nechá', () => {
  const polozky = [
    { id: 'P1', url: U(1), stav: 'Nápad' },
    { id: 'P2', url: U(2), stav: 'Připraveno' },
    { id: 'P3', url: U(3), stav: 'V revizi' },
    { id: 'P4', url: U(4), stav: HOTOVO },
    { id: 'P5', url: U(5), stav: 'Nápad' },
  ];
  const otevrene = [
    { url: U(1), stitky: ['stav:napad'] },
    { url: U(2), stitky: ['stav:rozpracovano'] },
    { url: U(5), stitky: [] },
    { url: U(9), stitky: ['stav:pripraveno'] },
    { url: U(10), stitky: [] },
  ];
  assert.deepEqual(naplanuj(polozky, otevrene), [
    { typ: 'nastavit', id: 'P2', url: U(2), stav: 'Rozpracováno' },
    { typ: 'pridat', url: U(9), stav: 'Připraveno' },
    { typ: 'pridat', url: U(10), stav: null },
    { typ: 'nastavit', id: 'P3', url: U(3), stav: HOTOVO },
  ]);
});

function falesnyGh({ bezProjektu = false } = {}) {
  const volani = [];
  const gh = async (a) => {
    volani.push(a);
    const [prikaz, pod] = a;
    if (prikaz === 'project' && pod === 'list') return { projects: bezProjektu ? [] : [{ number: 1, id: 'PVT_1', title: 'Tým agentů' }] };
    if (prikaz === 'project' && pod === 'field-list') {
      const jmena = ['Nápad', 'Připraveno', 'Rozpracováno', 'V revizi', 'Čeká na vlastníka', 'Blokováno', 'Hotovo'];
      return { fields: [{ name: 'Status', id: 'X' }, { name: POLE, id: 'F1', options: jmena.map((n, i) => ({ id: `o${i}`, name: n })) }] };
    }
    if (prikaz === 'project' && pod === 'item-list') {
      return { items: [
        { id: 'P1', content: { url: U(1), repository: 'vlastnik/tym' }, 'stav týmu': 'Nápad' },
        { id: 'C1', content: { url: 'https://github.com/cizi/repo/issues/1', repository: 'cizi/repo' }, 'stav týmu': 'Nápad' },
        { id: 'D1', content: { title: 'koncept bez url' } },
      ] };
    }
    if (prikaz === 'api') return [[{ html_url: U(1), labels: [{ name: 'stav:revize' }] }, { html_url: U(2), labels: [{ name: 'stav:napad' }] }]];
    if (prikaz === 'project' && pod === 'item-add') return { id: 'NOVA' };
    if (prikaz === 'project' && pod === 'item-edit') return null;
    throw new Error(`neočekávané volání ${a.join(' ')}`);
  };
  return { gh, volani };
}

test('srovnání zapisuje jen do projektu a jen u položek tohoto repozitáře', async () => {
  const { gh, volani } = falesnyGh();
  const vypis = [];
  await srovnej({ repo: 'vlastnik/tym', gh, vypis: (r) => vypis.push(r) });
  const zapisy = volani.filter(([p, s]) => p === 'project' && ['item-add', 'item-edit'].includes(s));
  assert.deepEqual(zapisy.map((a) => a.slice(0, 3).concat(a.slice(-1))), [
    ['project', 'item-edit', '--id', 'o3'],
    ['project', 'item-add', '1', 'json'],
    ['project', 'item-edit', '--id', 'o0'],
  ]);
  assert.ok(zapisy.every((a) => !a.includes('C1')), 'cizí položka se nemění');
  assert.equal(vypis.at(-1), 'Hotovo: 2 změn.');
});

test('nasucho nic nezapíše a chybějící projekt skončí srozumitelnou chybou', async () => {
  const { gh, volani } = falesnyGh();
  const akce = await srovnej({ repo: 'vlastnik/tym', gh, nasucho: true, vypis: () => {} });
  assert.equal(akce.length, 2);
  assert.ok(!volani.some(([p, s]) => p === 'project' && ['item-add', 'item-edit'].includes(s)));
  await assert.rejects(srovnej({ repo: 'vlastnik/tym', gh: falesnyGh({ bezProjektu: true }).gh, vypis: () => {} }), /neexistuje/);
});
