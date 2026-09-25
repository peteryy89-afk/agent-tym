# agent-tym

Znovupoužitelný vývojový tým AI agentů pro Claude Code. Úkol vezme, rozplánuje, naprogramuje, otestuje, zreviduje a předá ke schválení.

## Obsah
| Cesta | Co to je |
|---|---|
| `PROCES.md` | závazný proces: role, dráhy, štítky, definice „hotovo“, větší akce, pravidla proti halucinaci |
| `CLAUDE.md` | instrukce pro manažera (hlavní session) |
| `NOCNI-SMENA.md` | postup pro práci přes noc bez vlastníka (rutina Claude Code v cloudu) |
| `.claude/agents/` | 9 týmů = 9 vedoucích (`*-vedouci`) a 27 členů, přehled v `PROCES.md`, sekce 1 |
| `.claude/settings.json` | pravidla oprávnění a hooky |
| `.claude/hooks/` | `strazce-prikazu` (nebezpečné příkazy), `strazce-zapisu` (tajné klíče a chráněné soubory), `strazce-noci` (konektory a podagenti), `rezim` (den nebo noc), `prehled` (stav týmu na začátku session), `zaznam-aktivity` (kdy který agent začal a skončil, pro Velín) |
| `.claude/nastroje/` | `github-noc` (GitHub pro noční směnu: jen povolené akce přes REST) |
| `skripty/velin.mjs` | Velín: místní stránka s přehledem, kdo z agentů pracuje a na čem, úkoly, PR a noční směna |
| `.github/` | CI (testy a gitleaks), kontrola chráněných souborů, noční hlídač, šablony issue a PR, Dependabot |
| `test/` | testy hooků a struktury týmů (kdo koho smí spouštět) |

## Týmy
| Tým | Vedoucí | Členové |
|---|---|---|
| Produkt a design | `produkt-vedouci` | produktový analytik, UX designér |
| Vývoj | `vyvoj-vedouci` | plánovač, frontend, backend, data a AI |
| Kvalita a bezpečnost | `kvalita-vedouci` | tester, revizor kódu, bezpečnost |
| Provoz | `provoz-vedouci` | DevOps, hlídač provozu |
| Marketing a prodej | `marketing-vedouci` | copywriter, sociální sítě, obchodník B2B |
| Objevování příležitostí | `objevovani-vedouci` | hledač mezer, hlas uživatelů, obchodní model, hodnotitel |
| Revizní kritici | `revize-vedouci` | produktový skeptik, technický oponent, náklady a rizika, tržní analytik |
| Právo a data | `pravo-vedouci` | ochrana dat, obchodní právo |
| **Platforma** (infrastruktura a proces týmu) | `platforma-vedouci` | procesní inženýr, inženýr nástrojů, hodnotitel agentů |

## Jak se to používá
1. Jednou na svém počítači vytvoř `.claude/settings.local.json` s obsahem `{"env": {"AGENT_TYM_DEN": "1"}}`. Bez něj běží hooky v přísném nočním režimu.
2. Otevři Claude Code v kořeni repozitáře. Úvodní přehled má ukázat `REŽIM: den`.
3. Zadej práci manažerovi, například „Postav X“.
4. Stav sleduj ve Velínu: `npm run velin` a otevři http://127.0.0.1:4380. Otázky pro tebe mají štítek `pro-vlastnika`.
5. Práce přes noc: `NOCNI-SMENA.md`, sekce 6.

## Etapy
Hotovo: jádro, 9 týmů, pojistky, noční směna. Rozpracováno: přehled (Velín). Plánováno: převzetí oficiálních pluginů Anthropicu pro kontrolu kódu, záloha na OpenRouter.
