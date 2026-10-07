#!/usr/bin/env node
// Refresh the plugin from marvelsdb-json-data: villain asset packs, missing scenario files,
// missing index.json entries, name/count sync of the other asset packs, then validation.
// Usage: node scripts/update-plugin.mjs [--source <dir>]
// Without --source, shallow-clones https://github.com/zzorba/marvelsdb-json-data into a temp dir.
// Source corrections live in scripts/source-overrides.json.

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const SOURCE_REPO = "https://github.com/zzorba/marvelsdb-json-data";

function readJson(p) { return JSON.parse(readFileSync(p, "utf8")); }
function writeJson(p, data) { writeFileSync(p, JSON.stringify(data, null, 2) + "\n"); }

const overrides = readJson(resolve(__dirname, "source-overrides.json"));

// Populated by loadSource().
let sets, packs;
let cardsByCode = {};
let cardsBySet = {};

function loadSource(sourceRoot) {
  sets = readJson(resolve(sourceRoot, "sets.json"));
  packs = readJson(resolve(sourceRoot, "packs.json"));
  cardsByCode = {};
  cardsBySet = {};
  const seenIn = {};
  const dupes = [];
  for (const f of readdirSync(resolve(sourceRoot, "pack")).filter(n => n.endsWith("_encounter.json"))) {
    for (const c of readJson(resolve(sourceRoot, "pack", f))) {
      if (seenIn[c.code]) dupes.push(`${c.code} (${seenIn[c.code]}, ${f})`);
      seenIn[c.code] = f;
      cardsByCode[c.code] = c;
      if (c.set_code) {
        cardsBySet[c.set_code] ??= [];
        cardsBySet[c.set_code].push(c);
      }
    }
  }
  if (dupes.length > 0) {
    throw new Error(`Duplicate card codes in source (fix upstream):\n  ${dupes.join("\n  ")}`);
  }
  for (const [code, fields] of Object.entries(overrides.cards)) {
    const card = cardsByCode[code];
    if (!card) throw new Error(`source-overrides.json: no source card with code ${code}`);
    for (const [field, value] of Object.entries(fields)) {
      if (value === null) delete card[field];
      else card[field] = value;
    }
  }
}

function setCodeToSlug(setCode) {
  const slug = setCode.replace(/\./g, "").replace(/_/g, "-");
  return overrides.slugs[setCode] ?? slug;
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

// Sync names and counts of the hand-assembled asset packs (core, heroes, modular sets) from source.
function syncOtherPacks(generatedFiles) {
  const files = readdirSync(repoRoot).filter(
    n => /^marvelchampions-.*\.json$/.test(n) && !n.endsWith("-scenario.json") && !generatedFiles.has(n),
  );
  for (const f of files) {
    const path = resolve(repoRoot, f);
    const pack = readJson(path);
    let changed = false;
    const sourceFor = (code) => cardsByCode[code] ?? cardsByCode[code.replace(/[a-z]$/, "")];
    for (const [code, card] of Object.entries(pack.cards ?? {})) {
      const src = sourceFor(code);
      if (src && card.name !== src.name) {
        card.name = src.name;
        changed = true;
      }
    }
    for (const entries of Object.values(pack.cardSets ?? {})) {
      for (const entry of entries) {
        const src = sourceFor(entry.code);
        if (!src) continue;
        const qty = src.quantity ?? 1;
        if (qty > 1 && entry.count !== qty) {
          entry.count = qty;
          changed = true;
        } else if (qty === 1 && "count" in entry) {
          delete entry.count;
          changed = true;
        }
      }
    }
    if (changed) {
      writeJson(path, pack);
      console.log(`synced ${f}`);
    }
  }
}

// Append missing assets[] filenames and Villain loadable items; never touch existing entries.
function updateIndex(villainSets) {
  const indexPath = resolve(repoRoot, "index.json");
  const index = readJson(indexPath);
  const villainItems = index.loadables.find(l => l.label === "Villain").source.items;
  const sourceTypeIds = new Set(villainSets.map(r => `marvelchampions-${r.slug}`));
  const orphans = villainItems.filter(i => !sourceTypeIds.has(i.typeId)).map(i => i.typeId);
  if (orphans.length > 0) {
    throw new Error(`Villain items with no source villain set (add a slugs entry in source-overrides.json?): ${orphans.join(", ")}`);
  }
  let changed = false;
  for (const r of villainSets) {
    const typeId = `marvelchampions-${r.slug}`;
    const assetFile = `${typeId}.json`;
    if (!index.assets.includes(assetFile)) {
      index.assets.push(assetFile);
      changed = true;
    }
    if (!villainItems.some(i => i.typeId === typeId)) {
      villainItems.push({
        typeId,
        label: `${r.packName} - ${r.setName}`,
        data: { file: `${typeId}-scenario.json` },
      });
      changed = true;
      console.log(`index.json: added ${typeId}`);
    }
  }
  if (!changed) return;
  // Keep the hand-written style of one-line "data" objects.
  const text = JSON.stringify(index, null, 2).replace(
    /("data": )\{\n([^{}]*?)\n\s*\}/g,
    (_, key, body) => `${key}{ ${body.split("\n").map(l => l.trim()).join(" ")} }`,
  );
  writeFileSync(indexPath, text + "\n");
}

function update(sourceRoot) {
  loadSource(sourceRoot);

  const villainSets = [];
  for (const s of sets.filter(s => s.card_set_type_code === "villain")) {
    const r = generateForSet(s.code);
    if (r) villainSets.push(r);
  }

  updateIndex(villainSets);

  const generatedFiles = new Set();
  for (const r of villainSets) {
    writeJson(r.assetPath, r.assetPack);
    generatedFiles.add(`marvelchampions-${r.slug}.json`);
    if (!existsSync(r.scenarioPath)) {
      writeJson(r.scenarioPath, r.scenario);
      console.log(`created marvelchampions-${r.slug}-scenario.json`);
    }
  }
  syncOtherPacks(generatedFiles);
}

function main() {
  const args = process.argv.slice(2);
  const sourceIdx = args.indexOf("--source");
  let sourceRoot = sourceIdx >= 0 ? resolve(args[sourceIdx + 1] ?? "") : null;
  if (sourceIdx >= 0 && !args[sourceIdx + 1]) throw new Error("--source needs a directory");

  const cloneDir = sourceRoot ? null : mkdtempSync(join(tmpdir(), "marvelsdb-json-data-"));
  try {
    if (cloneDir) {
      execFileSync("git", ["clone", "--depth", "1", SOURCE_REPO, cloneDir], { stdio: "inherit" });
      sourceRoot = cloneDir;
    }
    let sha = "unknown";
    try {
      sha = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {}
    console.log(`SOURCE_SHA=${sha}`);
    update(sourceRoot);
  } finally {
    if (cloneDir) rmSync(cloneDir, { recursive: true, force: true });
  }

  const validation = spawnSync(process.execPath, [resolve(__dirname, "validate-plugin.mjs")], { stdio: "inherit" });
  process.exit(validation.status ?? 1);
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
