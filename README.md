# Marvel Champions Plugin Example

This directory contains example plugin files for Marvel Champions using the CardTable2 plugin format.

## Files

### Asset Packs (ct-assets@1)

**marvelchampions-core.json**
- Core Set content
- Includes Rhino villain set, Standard encounter set, and Spider-Man hero
- Defines card types (hero, alter_ego, villain, main_scheme, encounter)
- Defines tokens (threat, acceleration, damage, all-purpose)
- Defines counters (first-player)
- **No positioning information** (pure content library)

**marvelchampions-bomb-scare.json**
- Bomb Scare modular encounter set
- Separate pack demonstrates pack modularity
- Can be mixed into scenarios

### Scenarios (ct-scenario@1)

**marvelchampions-rhino-scenario.json**
- References both asset packs
- Defines three decks:
  - `villain-stages`: Rhino I/II/III (not shuffled, stage progression)
  - `main-scheme`: The Break-In! 1A (not shuffled)
  - `encounter-deck`: Combines rhino-villain + standard-encounter + bomb-scare (shuffled)
- Defines layout with positioned objects:
  - Villain stack (center-top, face-up)
  - Main scheme stack (higher center, face-up)
  - Encounter deck (right side, face-down)
  - Encounter discard zone (below encounter deck)
  - Villain play area zone (center)
  - Token pools (left side)
  - First player counter (bottom-left)

## Key Design Patterns

### Double-Sided Cards

Uses `back_code` property to link front/back:
```json
"01001a": {
  "type": "hero",
  "face": "01001a_spiderman.jpg",
  "back_code": "01001b"
},
"01001b": {
  "type": "alter_ego",
  "face": "01001b_peter_parker.jpg",
  "back_code": "01001a"
}
```

Both sides are equal (no `hidden` flag). When face-down, render using `back_code`'s face image.

### Card Type Inheritance

Cards inherit from cardTypes:
```json
"cardTypes": {
  "villain": {
    "back": "encounter_back.jpg",
    "size": "standard"
  }
},
"cards": {
  "01094": {
    "type": "villain",
    "face": "01094_rhino_1.jpg"
    // Inherits back and size from "villain" cardType
  }
}
```

### CardSets for Grouping

CardSets group cards for deck building with explicit counts:
```json
"cardSets": {
  "rhino-villain": [
    { "code": "01094" },
    { "code": "01095" },
    { "code": "01096" },
    { "code": "01104", "count": 2 },
    { "code": "01105", "count": 2 }
  ]
}
```

Card objects have:
- `code` (required): Card code
- `count` (optional): Number of copies (defaults to 1 if omitted)

Scenarios reference cardSets in deck definitions:
```json
"decks": {
  "encounter-deck": {
    "cardSets": ["rhino-villain", "standard-encounter", "bomb-scare"],
    "shuffle": true
  }
}
```

### Deck Definitions

Decks can use cardSets and/or individual cards:
```json
"villain-stages": {
  "cards": [
    { "code": "01094" },
    { "code": "01095" },
    { "code": "01096" }
  ],
  "shuffle": false
}
```

Cards use the same format as cardSets:
- `code` (required): Card code
- `count` (optional): Number of copies (defaults to 1)

Example with explicit count:
```json
"player-deck": {
  "cards": [
    { "code": "01020" },
    { "code": "01021", "count": 3 }
  ],
  "shuffle": true
}
```

### Layout Objects

Five object types supported:

1. **Stack**: Card stacks
2. **Zone**: Rectangular areas (discard piles, play areas)
3. **Token**: Token pools
4. **Counter**: Numeric counters
5. **Mat**: Playmats (not used in this example)

All objects have:
- Unique `id`
- Position `pos` (x, y in world coordinates)
- Z-order `z` (layering)
- Type-specific properties

### Pack Merging

Scenario references multiple packs:
```json
"packs": ["marvelchampions-core", "marvelchampions-bomb-scare"]
```

Packs merge with last-wins strategy. Later packs can override earlier definitions.

### URL Resolution

Asset packs define `baseUrl` for relative image paths:
```json
"baseUrl": "/api/card-image/marvel-champions/core/",
"cards": {
  "01094": {
    "face": "01094_rhino_1.jpg"  // Resolves to /api/card-image/marvel-champions/core/01094_rhino_1.jpg
  }
}
```

Supports:
- Absolute URLs (http/https)
- Root-relative URLs (/api/...)
- BaseUrl-relative paths

## Well-Defined vs Variable Content

**This scenario includes only "well-defined" content:**
- ✅ Villain stages (always present)
- ✅ Main scheme (always present)
- ✅ Encounter deck (well-defined for this scenario)
- ✅ Tokens and zones (always present)

**Variable content loaded separately (Phase 2):**
- ❌ Player hero decks (user choice)
- ❌ Player aspect cards (user choice)
- ❌ Optional modular sets (user choice - we included Bomb Scare as an example)
- ❌ Obligations/nemesis cards (player-specific)

In Phase 1 (current implementation), players load these manually after the scenario loads.
