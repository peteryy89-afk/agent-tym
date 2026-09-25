import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posud as posudPrikaz } from '../.claude/hooks/strazce-prikazu.mjs';
import { posud as posudZapis } from '../.claude/hooks/strazce-zapisu.mjs';
import { posud as posudNoc, MAX_PODAGENTU } from '../.claude/hooks/strazce-noci.mjs';
import { jeNoc } from '../.claude/hooks/rezim.mjs';

const ZELENA_CI = [{ nazev: 'testy', vysledek: 'SUCCESS' }, { nazev: 'gitleaks', vysledek: 'SUCCESS' }];
const pr = (stitky = [], kontroly = ZELENA_CI) => () => ({ stitky, kontroly });
const DEN = { AGENT_TYM_DEN: '1' };
const rozhodnuti = (prikaz, zjistiPR = pr()) => posudPrikaz(prikaz, zjistiPR, DEN)?.rozhodnuti ?? 'povoleno';

test('force push a --no-verify jsou zakázané', () => {
  for (const p of ['git push --force', 'git push -f origin ukol/1-x', 'git push origin +ukol/1-x',
    'git push --force-with-lease', 'git commit -m x --no-verify', 'git push -uf origin x']) {
    assert.equal(rozhodnuti(p), 'deny', p);
  }
});

test('push do main je zakázaný, push větve povolený', () => {
  assert.equal(rozhodnuti('git push origin main'), 'deny');
  assert.equal(rozhodnuti('git push -u origin ukol/3-main-fix'), 'povoleno');
  assert.equal(rozhodnuti('git push -u origin ukol/12-sync'), 'povoleno');
});

test('gh příkazy na klíče, gisty a nastavení repozitáře jsou zakázané', () => {
  for (const p of ['gh secret set X', 'gh gist create a.txt', 'gh repo edit --visibility public', 'gh repo delete x', 'gh auth token']) {
    assert.equal(rozhodnuti(p), 'deny', p);
  }
  assert.equal(rozhodnuti('gh issue list --label stav:revize'), 'povoleno');
  assert.equal(rozhodnuti('gh pr diff 5'), 'povoleno');
});

test('.env je zakázaný, podobné názvy ne', () => {
  assert.equal(rozhodnuti('cat .env'), 'deny');
  assert.equal(rozhodnuti('type config/.env.local'), 'deny');
  assert.equal(rozhodnuti('node -e "console.log(process.env.HOME)"'), 'povoleno');
  assert.equal(rozhodnuti('cat .envrc'), 'povoleno');
});

test('sloučení větší akce bez schválení je zakázané', () => {
  assert.equal(rozhodnuti('gh pr merge 7 --squash', pr(['vetsi-akce'])), 'deny');
  assert.equal(rozhodnuti('gh pr merge 7 --squash', pr(['vetsi-akce', 'schvaleno-vlastnikem'])), 'povoleno');
  assert.equal(rozhodnuti('gh pr merge 7 --squash'), 'povoleno');
  assert.equal(rozhodnuti('gh pr merge --squash'), 'deny');
  assert.equal(rozhodnuti('gh pr merge 7', () => null), 'ask');
});

test('sloučení jde jen se zelenou CI (náhrada ochrany větve)', () => {
  assert.equal(rozhodnuti('gh pr merge 7 --squash', pr([], [{ nazev: 'testy', vysledek: 'FAILURE' }])), 'deny');
  assert.equal(rozhodnuti('gh pr merge 7 --squash', pr([], [{ nazev: 'testy', vysledek: 'SUCCESS' }, { nazev: 'gitleaks', vysledek: '' }])), 'deny');
  assert.equal(rozhodnuti('gh pr merge 7 --squash', pr([], [])), 'deny');
  assert.equal(rozhodnuti('gh pr merge 7 --squash', pr([], [{ nazev: 'testy', vysledek: 'SUCCESS' }, { nazev: 'volitelna', vysledek: 'SKIPPED' }])), 'povoleno');
  const duvod = posudPrikaz('gh pr merge 7', pr([], [{ nazev: 'testy', vysledek: 'FAILURE' }]), DEN).duvod;
  assert.match(duvod, /testy=FAILURE/);
});

test('nové závislosti a zápis přes gh api vyžadují vlastníka', () => {
  assert.equal(rozhodnuti('npm install left-pad'), 'ask');
  assert.equal(rozhodnuti('pip install requests'), 'ask');
  assert.equal(rozhodnuti('gh api -X DELETE repos/a/b'), 'ask');
  assert.equal(rozhodnuti('npm install'), 'povoleno');
  assert.equal(rozhodnuti('gh api repos/a/b/pulls'), 'povoleno');
});

const projekt = 'C:\\Users\\Uzivatel\\Dokumenty\\Můj projekt\\agent-tym';
const zapis = (cesta) => posudZapis(cesta, projekt, DEN)?.rozhodnuti ?? 'povoleno';

test('zápis tajných klíčů je zakázaný', () => {
  for (const c of ['.env', 'config\\.env.production', 'klic.pem', 'certs/server.key', 'C:\\Users\\Uzivatel\\.ssh\\id_ed25519']) {
    assert.equal(zapis(`${projekt}\\${c}`), 'deny', c);
  }
});

test('chráněné soubory vyžadují vlastníka, ostatní ne', () => {
  for (const c of ['PROCES.md', 'CLAUDE.md', '.claude\\settings.json', '.claude\\agents\\vyvojar.md', '.github\\workflows\\ci.yml']) {
    assert.equal(zapis(`${projekt}\\${c}`), 'ask', c);
  }
  for (const c of ['README.md', 'skripty\\sync.mjs', 'docs\\PROCES.md']) {
    assert.equal(zapis(`${projekt}\\${c}`), 'povoleno', c);
  }
  assert.equal(zapis(undefined), 'povoleno');
});

test('strážce zápisu funguje i s cestami z Linuxu a s různou velikostí písmen ve Windows', () => {
  const linux = '/home/runner/work/agent-tym/agent-tym';
  assert.equal(posudZapis(`${linux}/PROCES.md`, linux, DEN)?.rozhodnuti, 'ask');
  assert.equal(posudZapis(`${linux}/.github/workflows/ci.yml`, linux, DEN)?.rozhodnuti, 'ask');
  assert.equal(posudZapis(`${linux}/src/app.js`, linux, DEN), null);
  assert.equal(posudZapis('/jinde/PROCES.md', linux, DEN), null);
  assert.equal(posudZapis(`${linux}/.env`, linux, DEN)?.rozhodnuti, 'deny');
  assert.equal(posudZapis('c:/users/uzivatel/projekt/CLAUDE.md', String.raw`C:\Users\Uzivatel\projekt\ `.trim(), DEN)?.rozhodnuti, 'ask');
  assert.equal(posudZapis('.claude/settings.json', linux, DEN)?.rozhodnuti, 'ask');
  assert.equal(posudZapis(String.raw`C:\Users\Uzivatel\projekt-jiny\PROCES.md`, String.raw`C:\Users\Uzivatel\projekt`, DEN), null);
});

test('obcházení kontroly sloučení z bezpečnostní revize PR #2 je zablokované', () => {
  const zelenySchvaleny = pr(['vetsi-akce', 'schvaleno-vlastnikem']);
  const podlePR = (c) => (c === '1' ? zelenySchvaleny() : { stitky: ['vetsi-akce'], kontroly: [{ nazev: 'testy', vysledek: 'FAILURE' }] });
  // nález 2: více sloučení v jednom příkazu
  assert.equal(rozhodnuti('gh pr merge 1 --squash && gh pr merge 7 --squash', podlePR), 'deny');
  assert.equal(rozhodnuti('gh pr merge 1; gh pr merge 7', podlePR), 'deny');
  // nález 3: gh api a GraphQL
  assert.equal(rozhodnuti('gh api --method=PUT repos/a/b/pulls/7/merge'), 'deny');
  assert.equal(rozhodnuti('gh api -X PUT repos/a/b/pulls/7/merge'), 'deny');
  assert.equal(rozhodnuti('gh api graphql -f query="mutation { mergePullRequest(input:{}) { clientMutationId } }"'), 'deny');
  assert.equal(rozhodnuti('gh api graphql -f query="mutation { addStar(input:{}) { clientMutationId } }"'), 'ask');
  assert.equal(rozhodnuti('gh api --method=DELETE repos/a/b/x'), 'ask');
  // nález 4: štítek schválení si agent nepřidá sám
  assert.equal(rozhodnuti('gh pr edit 7 --add-label schvaleno-vlastnikem'), 'ask');
  assert.equal(rozhodnuti('gh issue edit 7 --add-label "schvaleno-vlastnikem"'), 'ask');
  // nález 5: push do main přes refspec
  assert.equal(rozhodnuti('git push origin HEAD:main'), 'deny');
  assert.equal(rozhodnuti('git push origin ukol/1-x:refs/heads/main'), 'deny');
  // nález 6: zápis do chráněných souborů přes Bash
  assert.equal(rozhodnuti("sed -i 's/a/b/' .claude/hooks/strazce-prikazu.mjs"), 'ask');
  assert.equal(rozhodnuti('echo x > PROCES.md'), 'ask');
  assert.equal(rozhodnuti('cp jiny.json .claude/settings.json'), 'ask');
  assert.equal(rozhodnuti("sed -n '1,5p' PROCES.md"), 'povoleno');
  assert.equal(rozhodnuti('cat CLAUDE.md'), 'povoleno');
  assert.equal(rozhodnuti('npm test 2>&1 | tail -5'), 'povoleno');
  // nález 9: jiný repozitář, --admin, --auto, varianty zápisu
  assert.equal(rozhodnuti('gh pr merge 1 -R jiny/repo --squash', podlePR), 'deny');
  assert.equal(rozhodnuti('gh pr merge 1 --admin', podlePR), 'deny');
  assert.equal(rozhodnuti('gh pr merge 1 --auto', podlePR), 'deny');
  assert.equal(rozhodnuti('gh pr "merge" 7', podlePR), 'deny');
  assert.equal(rozhodnuti('gh.exe pr merge 7', podlePR), 'deny');
  assert.equal(rozhodnuti('gh pr merge --squash 7', podlePR), 'deny');
  // běžné sloučení zeleného schváleného PR projde
  assert.equal(rozhodnuti('gh pr merge 1 --squash --delete-branch', podlePR), 'povoleno');
});

test('2. kolo revize PR #2: push bez větve, --all a rozhraní /merges', () => {
  // nález A
  assert.equal(rozhodnuti('git switch main && git merge ukol/7 && git push'), 'deny');
  assert.equal(rozhodnuti("git push origin 'main'"), 'deny');
  assert.equal(rozhodnuti('git push --all origin'), 'deny');
  assert.equal(rozhodnuti('git push --mirror'), 'deny');
  assert.equal(rozhodnuti('git push -u origin HEAD'), 'deny');
  assert.equal(rozhodnuti('git push origin'), 'deny');
  assert.equal(rozhodnuti('git push -u origin ukol/7-oprava'), 'povoleno');
  assert.equal(rozhodnuti('git push origin platforma/2-x:platforma/2-x'), 'povoleno');
  // nález B
  assert.equal(rozhodnuti('gh api repos/o/r/merges -f base=main -f head=ukol/7'), 'deny');
  assert.equal(rozhodnuti('gh api graphql -F query=@dotaz.graphql'), 'ask');
  assert.equal(rozhodnuti('gh api repos/o/r/issues -f title=x'), 'ask');
  assert.equal(rozhodnuti('gh api -X GET search/issues -f q=repo:o/r'), 'povoleno');
  assert.equal(rozhodnuti('gh api repos/o/r/pulls/2/comments'), 'povoleno');
});

test('noční směna: nic se neslučuje, nezveřejňuje a místo dotazu se zamítá', () => {
  const noc = { NOCNI_SMENA: '1' };
  const vNoci = (prikaz, zjistiPR = pr()) => posudPrikaz(prikaz, zjistiPR, noc)?.rozhodnuti ?? 'povoleno';
  assert.equal(vNoci('gh pr merge 1 --squash', pr(['schvaleno-vlastnikem'])), 'deny');
  assert.equal(vNoci('GH pr merge 1'), 'deny');
  assert.equal(vNoci('gh release create v1'), 'deny');
  assert.equal(vNoci('gh workflow run ci.yml'), 'deny');
  assert.equal(vNoci('npm publish'), 'deny');
  assert.equal(vNoci('npm install left-pad'), 'deny');
  assert.equal(vNoci('gh pr edit 3 --add-label schvaleno-vlastnikem'), 'deny');
  assert.match(posudPrikaz('npm install x', pr(), noc).duvod, /pro-vlastnika/);
  assert.equal(vNoci('git push -u origin claude/ukol-4-sync'), 'povoleno');
  assert.equal(vNoci('gh pr create --title x --body y'), 'deny');
  assert.equal(vNoci('node .claude/nastroje/github-noc.mjs pr claude/ukol-4-sync popis.md Přidej sync'), 'povoleno');
  assert.equal(vNoci('gh issue list --label noc:ano'), 'povoleno');
  // přes den se nic nemění
  assert.equal(posudPrikaz('gh pr merge 1', pr(), DEN)?.rozhodnuti ?? 'povoleno', 'povoleno');
  assert.equal(posudPrikaz('npm install x', pr(), DEN)?.rozhodnuti, 'ask');
});

test('noční směna: chráněné soubory se zamítají, NOCNI-SMENA.md je chráněný', () => {
  const koren = '/home/user/agent-tym';
  assert.equal(posudZapis(`${koren}/NOCNI-SMENA.md`, koren, DEN)?.rozhodnuti, 'ask');
  assert.equal(posudZapis(`${koren}/NOCNI-SMENA.md`, koren, { NOCNI_SMENA: '1' })?.rozhodnuti, 'deny');
  assert.equal(posudZapis(`${koren}/.claude/settings.json`, koren, { NOCNI_SMENA: '1' })?.rozhodnuti, 'deny');
  assert.equal(posudZapis(`${koren}/skripty/sync.mjs`, koren, { NOCNI_SMENA: '1' }), null);
  assert.equal(posudPrikaz('echo x > NOCNI-SMENA.md', pr(), DEN)?.rozhodnuti, 'ask');
});

test('režim: bez výslovného denního příznaku je vždy noc', () => {
  assert.equal(jeNoc({}), true);
  assert.equal(jeNoc(DEN), false);
  assert.equal(jeNoc({ AGENT_TYM_DEN: '1', NOCNI_SMENA: '1' }), true);
  assert.equal(jeNoc({ AGENT_TYM_DEN: '1', CLAUDE_CODE_REMOTE: 'true' }), true);
  // nález 3 revize PR #5: chybějící NOCNI_SMENA už sloučení nepustí
  assert.equal(posudPrikaz('gh pr merge 1 --squash', pr(), {})?.rozhodnuti, 'deny');
  assert.equal(posudZapis('/home/user/agent-tym/PROCES.md', '/home/user/agent-tym', {})?.rozhodnuti, 'deny');
});

test('noční směna: štítky jen stavové, frontu si agent sám nerozšíří', () => {
  const vNoci = (prikaz) => posudPrikaz(prikaz, pr(), {})?.rozhodnuti ?? 'povoleno';
  for (const p of ['gh issue edit 4 --add-label noc:ano', 'gh pr edit 6 --remove-label vetsi-akce',
    'gh issue edit 4 --remove-label "blokovano,vetsi-akce"', 'gh issue edit 4 --add-label=stav:pripraveno,noc:ano',
    'gh issue create --title x --body y --label noc:ano', 'gh label create noc:ano', 'gh label delete vetsi-akce',
    'gh issue delete 3 --yes', 'gh issue edit 4 --body "nový text"', 'gh issue edit 4 -t jiny']) {
    assert.equal(vNoci(p), 'deny', p);
  }
  // v noci jde každý zápis přes gh issue/pr do nástroje github-noc (v cloudu gh issue/pr nefungují)
  for (const p of ['gh issue edit 4 --add-label stav:ceka-na-vlastnika --remove-label noc:ano',
    'gh issue create --title "Ranní zpráva 2026-09-25" --body-file zprava.md --label ranni-zprava --label pro-vlastnika',
    'gh issue close 9', 'gh pr comment 6 --body x']) {
    assert.match(posudPrikaz(p, pr(), {})?.duvod ?? '', /github-noc/, p);
  }
  for (const p of ['gh label list', 'node .claude/nastroje/github-noc.mjs stitky 4 --pridat stav:ceka-na-vlastnika --odebrat noc:ano']) {
    assert.equal(vNoci(p), 'povoleno', p);
  }
  // přes den se štítky nehlídají (kromě schválení)
  assert.equal(rozhodnuti('gh issue edit 4 --add-label noc:ano'), 'povoleno');
});

test('noční směna: komentáře jen s filtrem na vlastníka', () => {
  const vNoci = (prikaz) => posudPrikaz(prikaz, pr(), {}, () => 'vlastnik')?.rozhodnuti ?? 'povoleno';
  for (const p of ['gh issue view 4 --comments', 'gh pr view 6 -c', 'gh pr view 6 --json comments,reviews',
    'gh api repos/o/r/issues/4/comments', 'gh api repos/o/r/pulls/6/reviews']) {
    assert.equal(vNoci(p), 'deny', p);
  }
  for (const p of ['gh issue view 4', 'gh issue view 4 --json title,body',
    'gh issue view 4 --json comments --jq \'.comments[] | select(.author.login == "vlastnik") | .body\'',
    'gh api repos/o/r/issues/4/comments --jq \'.[] | select(.user.login == "vlastnik") | .body\'']) {
    assert.equal(vNoci(p), 'povoleno', p);
  }
});

test('strážce noci: konektory, model a počet podagentů', () => {
  assert.equal(posudNoc('mcp__posta__odeslat', {}, {})?.rozhodnuti, 'deny');
  assert.equal(posudNoc('mcp__posta__odeslat', {}, DEN)?.rozhodnuti, 'ask');
  assert.equal(posudNoc('Agent', { subagent_type: 'vyvoj-vedouci' }, {})?.rozhodnuti, 'deny');
  assert.equal(posudNoc('Agent', { model: 'opus' }, {})?.rozhodnuti, 'deny');
  assert.equal(posudNoc('Agent', { model: 'sonnet' }, {}), null);
  assert.equal(posudNoc('Agent', { model: 'sonnet' }, {}, () => MAX_PODAGENTU + 1)?.rozhodnuti, 'deny');
  assert.equal(posudNoc('Agent', { model: 'sonnet' }, {}, () => Infinity)?.rozhodnuti, 'deny');
  assert.equal(posudNoc('Agent', {}, DEN), null);
  assert.equal(posudNoc('Read', {}, {}), null);
});

test('2. kolo revize PR #5: push jen do claude/, fork, filtr na skutečného vlastníka', () => {
  const vNoci = (prikaz, vlastnik = () => 'vlastnik') => posudPrikaz(prikaz, pr(), {}, vlastnik)?.rozhodnuti ?? 'povoleno';
  // nález 2: push mimo claude/
  assert.equal(vNoci('git push -u origin platforma/2-x'), 'deny');
  assert.equal(vNoci('git push origin claude/ukol-4-x:ukol/4-x'), 'deny');
  assert.equal(vNoci('git push -u origin claude/ukol-4-sync'), 'povoleno');
  assert.equal(vNoci('git push origin claude/ukol-4-sync:refs/heads/claude/ukol-4-sync'), 'povoleno');
  assert.equal(vNoci('git push origin main'), 'deny');
  // nález 1: kontrolní příkaz ze začátku směny hook zamítne
  assert.match(posudPrikaz('gh issue edit 0 --add-label noc:ano', pr(), {}).duvod, /^V noční směně/);
  // nález 4: fork dědí model hlavní session
  assert.equal(posudNoc('Agent', { subagent_type: 'fork', model: 'sonnet' }, {})?.rozhodnuti, 'deny');
  // nález 5: login musí být vlastník, timeline je taky čtení komentářů
  const cizi = 'gh issue view 4 --json comments --jq \'.comments[] | select(.author.login == "utocnik") | .body\'';
  assert.equal(vNoci(cizi), 'deny');
  assert.equal(vNoci(cizi.replace('utocnik', 'Vlastnik')), 'povoleno');
  assert.equal(vNoci(cizi.replace('utocnik', 'vlastnik'), () => null), 'deny');
  assert.equal(vNoci('gh issue view 4 --json comments --jq \'.comments[] | select(.author.login == "$VLASTNIK")\''), 'deny');
  assert.equal(vNoci('gh api repos/o/r/issues/4/timeline'), 'deny');
  assert.equal(vNoci('gh api repos/o/r/issues/4/timeline --jq \'.[] | select(.user.login == "vlastnik")\''), 'povoleno');
  // přes den se push do jiných větví nehlídá
  assert.equal(rozhodnuti('git push -u origin platforma/2-x'), 'povoleno');
});
