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
| `.claude/hooks/` | `strazce-prikazu` (nebezpečné příkazy), `strazce-zapisu` (tajné klíče a chráněné soubory), `prehled` (stav týmu na začátku session) |
| `.github/` | CI (testy a gitleaks), šablony issue a PR, Dependabot |
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
1. Otevři Claude Code v kořeni repozitáře.
2. Zadej práci manažerovi, například „Postav X“.
3. Stav sleduj v GitHub issues podle štítků, otázky pro tebe mají štítek `pro-vlastnika`.

## Etapy
Hotovo: jádro, 9 týmů, pojistky. Plánováno: převzetí oficiálních pluginů Anthropicu pro kontrolu kódu, přehled a board, záloha na OpenRouter, práce přes noc.
