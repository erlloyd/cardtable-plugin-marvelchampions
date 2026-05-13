#!/usr/bin/env node
// Generate asset packs and scenario files for villain sets from marvelsdb-json-data.
// Usage: node scripts/generate-villain-scenarios.mjs <set_code> [<set_code>...]
//   or: node scripts/generate-villain-scenarios.mjs --all
// Outputs marvelchampions-<slug>.json (asset pack) and marvelchampions-<slug>-scenario.json.
// Skips writing if file already exists; pass --force to overwrite.

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const sourceRoot = "/Users/erlloyd/Code/marvelsdb-json-data";

const args = process.argv.slice(2);
const force = args.includes("--force");
const all = args.includes("--all");
const targets = args.filter((a) => !a.startsWith("--"));

function readJson(p) { return JSON.parse(readFileSync(p, "utf8")); }
function writeJson(p, data) { writeFileSync(p, JSON.stringify(data, null, 2) + "\n"); }

// Load all sets and packs metadata
const sets = readJson(resolve(sourceRoot, "sets.json"));
const packs = readJson(resolve(sourceRoot, "packs.json"));

// Build flat card index keyed by code, from all encounter packs
const cardsByCode = {};
const cardsBySet = {};
for (const f of readdirSync(resolve(sourceRoot, "pack")).filter(n => n.endsWith("_encounter.json") || n === "core_encounter.json")) {
  const cards = readJson(resolve(sourceRoot, "pack", f));
  for (const c of cards) {
    cardsByCode[c.code] = c;
    if (c.set_code) {
      cardsBySet[c.set_code] ??= [];
      cardsBySet[c.set_code].push(c);
    }
  }
}

function setCodeToSlug(setCode) {
  return setCode.replace(/_/g, "-");
}

function findPackCodeForSet(setCode) {
  const cards = cardsBySet[setCode] || [];
  if (cards.length === 0) return null;
  return cards[0].pack_code;
}

function findPackName(packCode) {
  const p = packs.find(p => p.code === packCode);
  return p ? p.name : packCode;
}

function findSetName(setCode) {
  const s = sets.find(s => s.code === setCode);
  return s ? s.name : setCode;
}

function faceFilename(code) {
  const m = code.match(/^(\d+)([a-z])?$/);
  if (!m) return `${code}.jpg`;
  const [, digits, letter] = m;
  return letter ? `${digits}${letter.toUpperCase()}.jpg` : `${digits}.jpg`;
}

// Map source type_code to the plugin's `type` field
function mapType(typeCode) {
  if (typeCode === "villain") return "villain";
  if (typeCode === "main_scheme") return "main_scheme";
  return "encounter";
}

// Build asset pack card entries from a list of source cards
function buildCardEntries(sourceCards) {
  const entries = {};
  // Pre-build a reverse back_link map: if X has back_link Y, also link Y -> X.
  const backLinkMap = {};
  for (const c of sourceCards) {
    if (c.back_link) {
      backLinkMap[c.code] = c.back_link;
      backLinkMap[c.back_link] = c.code;
    }
  }

  for (const c of sourceCards) {
    const type = mapType(c.type_code);
    const typeCode = c.type_code;
    const setCode = c.set_code;
    const codeHasLetter = /[a-z]$/.test(c.code);

    if (c.double_sided && !codeHasLetter) {
      // Generate <code>a and <code>b sharing the same source record
      const codeA = `${c.code}a`;
      const codeB = `${c.code}b`;
      entries[codeA] = {
        name: c.name,
        type,
        face: faceFilename(codeA),
        setCode,
        typeCode,
        back_code: codeB,
      };
      entries[codeB] = {
        name: c.name,
        type,
        face: faceFilename(codeB),
        setCode,
        typeCode,
        back_code: codeA,
      };
    } else {
      // Single entry; if back_link present (forward or reverse), set back_code
      const entry = {
        name: c.name,
        type,
        face: faceFilename(c.code),
        setCode,
        typeCode,
      };
      if (backLinkMap[c.code]) {
        entry.back_code = backLinkMap[c.code];
      }
      entries[c.code] = entry;
    }
  }
  return entries;
}

// Build encounter card set: all cards in the set that are NOT villains or main schemes.
// For double-sided cards, reference only the canonical "a" face (host flips via back_code).
function buildEncounterCardSet(sourceCards) {
  const pairedPartners = new Set();
  for (const c of sourceCards) {
    if (c.back_link) {
      pairedPartners.add(c.code);
      pairedPartners.add(c.back_link);
    }
  }
  const result = [];
  for (const c of sourceCards) {
    if (c.type_code === "villain" || c.type_code === "main_scheme") continue;
    const ref = canonicalRef(c, pairedPartners);
    if (!ref) continue;
    const qty = c.quantity ?? 1;
    if (qty > 1) result.push({ code: ref, count: qty });
    else result.push({ code: ref });
  }
  return result;
}

// Helper: collapse paired letter-suffix cards (a/b sharing a back_link) to canonical 'a' side
function canonicalRef(card, pairedPartners) {
  const codeHasLetter = /[a-z]$/.test(card.code);
  if (card.double_sided && !codeHasLetter) {
    return `${card.code}a`;
  }
  if (codeHasLetter) {
    // If this card is paired and is the 'b' side (back_link points to an 'a'-side sibling), skip
    if (pairedPartners.has(card.code) && card.code.endsWith("b")) return null;
    return card.code;
  }
  return card.code;
}

// Build the villain stack: villain cards, in stage order.
function buildVillainStack(sourceCards) {
  // Identify paired (letter-suffix) partners via back_link
  const pairedPartners = new Set();
  for (const c of sourceCards) {
    if (c.back_link) {
      pairedPartners.add(c.code);
      pairedPartners.add(c.back_link);
    }
  }
  const villains = sourceCards.filter(c => c.type_code === "villain");
  villains.sort((a, b) => {
    const sa = a.stage ?? 0;
    const sb = b.stage ?? 0;
    if (sa !== sb) return sa - sb;
    return a.code.localeCompare(b.code);
  });
  const cards = [];
  const seen = new Set();
  for (const v of villains) {
    const ref = canonicalRef(v, pairedPartners);
    if (!ref) continue;
    if (seen.has(ref)) continue;
    seen.add(ref);
    cards.push({ code: ref });
  }
  return cards;
}

// Build the main scheme stack: main_scheme cards at stage 1.
function buildMainSchemeStack(sourceCards) {
  const pairedPartners = new Set();
  for (const c of sourceCards) {
    if (c.back_link) {
      pairedPartners.add(c.code);
      pairedPartners.add(c.back_link);
    }
  }
  // Stage 1 main schemes. Stage may be numeric (1) or string ("1A"/"1B"); accept any
  // value whose canonical form starts with "1".
  const schemes = sourceCards.filter(c => {
    if (c.type_code !== "main_scheme") return false;
    const stage = c.stage;
    if (stage === undefined || stage === null) return false;
    return String(stage).startsWith("1");
  });
  const cards = [];
  const seen = new Set();
  for (const s of schemes) {
    const ref = canonicalRef(s, pairedPartners);
    if (!ref) continue;
    if (seen.has(ref)) continue;
    seen.add(ref);
    cards.push({ code: ref });
  }
  return cards;
}

function generateForSet(setCode) {
  const sourceCards = cardsBySet[setCode];
  if (!sourceCards || sourceCards.length === 0) {
    console.error(`No cards found for set '${setCode}'`);
    return null;
  }
  const slug = setCodeToSlug(setCode);
  const packCode = findPackCodeForSet(setCode);
  const packName = findPackName(packCode);
  const setName = findSetName(setCode);

  const assetPack = {
    schema: "ct-assets@1",
    id: `marvelchampions-${slug}`,
    name: `Marvel Champions: ${setName}`,
    version: "1.0.0",
    baseUrl: "/api/card-image/cerebro-cards/official/",
    cards: buildCardEntries(sourceCards),
    cardSets: {
      [`${slug}-encounter`]: buildEncounterCardSet(sourceCards),
    },
  };

  const villainStack = buildVillainStack(sourceCards);
  const mainSchemeStack = buildMainSchemeStack(sourceCards);

  const scenarioStacks = [];
  if (villainStack.length > 0) {
    scenarioStacks.push({
      label: "Villain",
      faceUp: true,
      deck: { cards: villainStack },
      row: 0,
    });
  }
  if (mainSchemeStack.length > 0) {
    scenarioStacks.push({
      label: "Main Scheme",
      faceUp: true,
      deck: { cards: mainSchemeStack },
      row: 0,
    });
  }
  scenarioStacks.push({
    label: "Encounter Deck",
    faceUp: false,
    deck: { cardSets: [`${slug}-encounter`] },
    row: 0,
  });

  const scenario = {
    schema: "ct-scenario@2",
    id: `marvelchampions-${slug}`,
    name: `Marvel Champions: ${setName}`,
    version: "1.0.0",
    packs: [
      "marvelchampions-base",
      `marvelchampions-${slug}`,
      "marvelchampions-standard-encounter",
    ],
    componentSet: { stacks: scenarioStacks },
  };

  return {
    setCode,
    slug,
    packCode,
    packName,
    setName,
    assetPack,
    scenario,
    assetPath: resolve(repoRoot, `marvelchampions-${slug}.json`),
    scenarioPath: resolve(repoRoot, `marvelchampions-${slug}-scenario.json`),
  };
}

function main() {
  let setCodes;
  if (all) {
    setCodes = sets.filter(s => s.card_set_type_code === "villain").map(s => s.code);
  } else if (targets.length > 0) {
    setCodes = targets;
  } else {
    console.error("Usage: node scripts/generate-villain-scenarios.mjs <set_code>...  or --all");
    process.exit(1);
  }

  const results = [];
  for (const sc of setCodes) {
    const r = generateForSet(sc);
    if (!r) continue;
    results.push(r);
    let wrote = 0;
    if (force || !existsSync(r.assetPath)) {
      writeJson(r.assetPath, r.assetPack);
      wrote++;
    }
    if (force || !existsSync(r.scenarioPath)) {
      writeJson(r.scenarioPath, r.scenario);
      wrote++;
    }
    console.log(`${r.setCode} (${r.packName} - ${r.setName}): wrote ${wrote} file(s)`);
  }
  // Emit a manifest snippet for index.json
  console.log("\n--- index.json loadable items snippet ---");
  for (const r of results) {
    console.log(JSON.stringify({
      typeId: `marvelchampions-${r.slug}`,
      label: `${r.packName} - ${r.setName}`,
      data: { file: `marvelchampions-${r.slug}-scenario.json` },
    }));
  }
  console.log("\n--- assets[] snippet ---");
  for (const r of results) {
    console.log(`"marvelchampions-${r.slug}.json",`);
  }
}

main();
