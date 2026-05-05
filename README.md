# Marvel Champions Plugin

CardTable2 plugin for the Marvel Champions Core Set. Three playable scenarios (Rhino, Klaw, Ultron) and modular asset packs covering all Core Box content.

## Layout

The plugin is split into modular asset packs that mirror the game's natural card groupings — heroes, aspects, villains, modular encounter sets, encounter rules — instead of bundling everything into a single "core" file. This enables lazy-loading and lets future expansions reuse Core Box pieces (e.g. a new villain scenario can pull just the Standard encounter set without dragging in the entire box).

### Shared base (`ct-assets@1`)

**`marvelchampions-base.json`** — globals every scenario needs. Contains:
- `cardTypes` (hero, alter_ego, villain, main_scheme, encounter, player) with the shared back image
- `tokens`, `tokenTypes` (damage, threat, generic, acceleration)
- `statusTypes` (stunned, confused, tough)
- `modifierStats` (ATK, THW, DEF, HP)
- `counters` (first-player)

No cards. Other packs assume base is loaded and skip their `cardTypes` block.

### Heroes (5 packs)

Each hero pack contains the hero/alter-ego pair, the 9–10 unique starter cards from the Core Box pre-built deck, the hero's obligation, and the hero's nemesis encounter set.

| File | Hero | Alter-ego | Starter range | Obligation | Nemesis range |
|---|---|---|---|---|---|
| `marvelchampions-spider-man.json` | Spider-Man | Peter Parker | 01002–01009 | 01165 | 01166–01169 |
| `marvelchampions-captain-marvel.json` | Captain Marvel | Carol Danvers | 01011–01018 | 01175 | 01176–01179 |
| `marvelchampions-she-hulk.json` | She-Hulk | Jennifer Walters | 01020–01028 | 01160 | 01161–01164 |
| `marvelchampions-iron-man.json` | Iron Man | Tony Stark | 01030–01039 | 01170 | 01171–01174 |
| `marvelchampions-black-panther.json` | Black Panther | T'Challa | 01041–01049 | 01155 | 01156–01159 |

Each defines two cardSets: `<hero>-deck` (hero/alter-ego + starter cards) and `<hero>-nemesis` (obligation + nemesis cards).

### Aspects + basic (5 packs)

Faction-wide player cards usable by any hero. Each aspect pack defines one cardSet, e.g. `aggression-basics`.

- `marvelchampions-aggression.json` (01050–01057)
- `marvelchampions-justice.json` (01058–01065)
- `marvelchampions-leadership.json` (01066–01074)
- `marvelchampions-protection.json` (01075–01082)
- `marvelchampions-basic.json` (01083–01093) — faction-neutral, defines `basic-cards`

### Villains (3 packs)

Each villain pack contains the villain stages, main scheme(s), and villain-specific encounter set.

- `marvelchampions-rhino.json` (01094–01108) — cardSet `rhino-villain`
- `marvelchampions-klaw.json` (01113–01127) — cardSet `klaw-villain`, two two-stage main schemes (01116/01116a, 01117/01117a)
- `marvelchampions-ultron.json` (01134–01150) — cardSet `ultron-villain`, three two-stage main schemes (01137/a, 01138/a, 01139/a)

### Modular encounter sets (5 packs)

Mix-in encounter sets that scenarios can compose into the encounter deck. Each defines one cardSet.

- `marvelchampions-bomb-scare.json` (01109–01112)
- `marvelchampions-masters-of-evil.json` (01128–01133)
- `marvelchampions-under-attack.json` (01151–01154)
- `marvelchampions-legions-of-hydra.json` (01180–01182)
- `marvelchampions-doomsday-chair.json` (01183–01185)

### Encounter rules (2 packs)

- `marvelchampions-standard-encounter.json` (01186–01190) — Standard difficulty
- `marvelchampions-expert-encounter.json` (01191–01193) — Expert difficulty

### Scenarios (`ct-scenario@2`)

Each scenario file lists the asset packs it needs, then defines a `componentSet` (stacks, tokens, counters, zones).

- **`marvelchampions-rhino-scenario.json`** — Rhino + Standard + Bomb Scare modular
- **`marvelchampions-klaw-scenario.json`** — Klaw + Standard + Masters of Evil modular
- **`marvelchampions-ultron-scenario.json`** — Ultron + Standard + Under Attack + Legions of Hydra + Doomsday Chair (all 3 default modulars per the rulebook)

## Key design patterns

### Pack merging

Scenarios reference multiple asset packs in their `packs` array, and the runtime merges them with last-wins semantics. Because `cardTypes` is declared once in `marvelchampions-base.json`, modular packs can omit the block entirely — no duplication, no drift. (The original Bomb Scare bug was caused by a duplicated `cardTypes` block; the validator now catches this kind of issue.)

### Double-sided cards

Cross-link the front and back via `back_code`:

```json
"01001a": {
  "type": "hero",
  "face": "01001A.jpg",
  "setCode": "spider_man",
  "typeCode": "hero",
  "back_code": "01001b"
},
"01001b": {
  "type": "alter_ego",
  "face": "01001B.jpg",
  "setCode": "spider_man",
  "typeCode": "alter_ego",
  "back_code": "01001a"
}
```

When face-down, the renderer uses the partner card's `face`. Both sides are equal — no `hidden` flag.

### Image filenames

- Plain digit codes: `01094` → `01094.jpg`
- Letter-suffixed codes: `01001a` → `01001A.jpg` (lowercase code, uppercase letter in filename)
- Multi-back variants (e.g. Ultron's 01144a/b/c) follow the same uppercase-letter rule

The validator (`scripts/validate-plugin.mjs`) enforces these rules.

### CardSets

Group cards for deck-building with explicit counts. Counts default to 1 if omitted.

```json
"cardSets": {
  "rhino-villain": [
    { "code": "01094" },
    { "code": "01097a" },
    { "code": "01104", "count": 2 },
    { "code": "01105", "count": 2 }
  ]
}
```

Scenarios reference cardSets by name in their stack definitions; the encounter deck is typically built from `["<villain>-villain", "standard-encounter", "<modular>"]`.

### URL resolution

Asset packs declare `baseUrl` for relative image paths. Currently all packs use:

```json
"baseUrl": "/api/card-image/cerebro-cards/official/"
```

Supports absolute URLs, root-relative URLs, and baseUrl-relative paths.

## Validation

Run after writing or modifying any asset pack or scenario file:

```bash
node scripts/validate-plugin.mjs                          # validate everything in repo root
node scripts/validate-plugin.mjs marvelchampions-foo.json # validate a single file
```

Checks:
- Required top-level fields (`schema`, `id`, `name`, `version`)
- Face filename matches the card code's expected pattern
- Card `type` resolves against the base pack's cardTypes
- Every cardSet entry references a card defined in the same pack
- Every scenario `packs` reference resolves to an asset pack file
- Every card and cardSet referenced in scenario stacks resolves across the listed packs

Exit 0 = clean, exit 1 = errors.

## Data sources

Card metadata is derived from the read-only [marvelsdb-json-data](https://github.com/Hawkesy/marvelsdb-json-data) repository (canonical source). Plugin packs store image-only metadata (`type`, `face`, `setCode`, `typeCode`, optional `back_code`) — names, stats, and rules text are not duplicated in the plugin.

## Issue tracking

This project uses [beads](https://github.com/steveyegge/beads) (`bd`) for issue tracking. See `AGENTS.md` for workflow conventions.
