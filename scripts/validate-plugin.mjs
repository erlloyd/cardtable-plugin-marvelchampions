#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const BASE_CARD_TYPES = ["hero", "alter_ego", "villain", "main_scheme", "encounter", "player"];

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const targets = args.filter((a) => !a.startsWith("--"));

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function expectedFaceFilename(code) {
  const m = code.match(/^(\d+)([a-z])?$/);
  if (!m) return `${code}.jpg`;
  const [, digits, letter] = m;
  return letter ? `${digits}${letter.toUpperCase()}.jpg` : `${digits}.jpg`;
}

function validateAssetPack(pack, ctx) {
  const errors = [];
  const warnings = [];

  for (const field of ["schema", "id", "name", "version"]) {
    if (!pack[field]) errors.push(`missing required top-level field: ${field}`);
  }

  const localCardTypes = new Set([...BASE_CARD_TYPES, ...Object.keys(pack.cardTypes ?? {})]);
  const localCards = new Set(Object.keys(pack.cards ?? {}));

  for (const [code, card] of Object.entries(pack.cards ?? {})) {
    const expected = expectedFaceFilename(code);
    if (card.face !== expected) {
      errors.push(`card ${code}: face '${card.face}' does not match expected '${expected}'`);
    }
    if (card.type && !localCardTypes.has(card.type)) {
      errors.push(`card ${code}: type '${card.type}' not defined locally or by base`);
    }
    if (card.back_code && !localCards.has(card.back_code) && !ctx.crossPackCards.has(card.back_code)) {
      warnings.push(`card ${code}: back_code '${card.back_code}' not found in this pack (may be cross-pack)`);
    }
  }

  for (const [setName, entries] of Object.entries(pack.cardSets ?? {})) {
    for (const entry of entries) {
      if (!localCards.has(entry.code)) {
        errors.push(`cardSet '${setName}': references unknown card '${entry.code}'`);
      }
    }
  }

  return { errors, warnings };
}

function validateScenario(scenario, scenarioPath, allPacks) {
  const errors = [];
  const warnings = [];

  for (const field of ["schema", "id", "name"]) {
    if (!scenario[field]) errors.push(`missing required top-level field: ${field}`);
  }

  const referencedPacks = scenario.packs ?? [];
  const loadedPacks = [];
  for (const packId of referencedPacks) {
    const found = allPacks.find((p) => p.pack.id === packId);
    if (!found) {
      errors.push(`pack '${packId}' referenced but no marvelchampions-*.json with that id exists in repo`);
    } else {
      loadedPacks.push(found.pack);
    }
  }

  const allCardCodes = new Set();
  const allCardSets = new Set();
  for (const pack of loadedPacks) {
    for (const code of Object.keys(pack.cards ?? {})) allCardCodes.add(code);
    for (const setName of Object.keys(pack.cardSets ?? {})) allCardSets.add(setName);
  }

  function checkDeck(deck, location) {
    if (deck?.cards) {
      for (const c of deck.cards) {
        if (!allCardCodes.has(c.code)) {
          errors.push(`${location}: card code '${c.code}' not found in any referenced pack`);
        }
      }
    }
    if (deck?.cardSets) {
      for (const setName of deck.cardSets) {
        if (!allCardSets.has(setName)) {
          errors.push(`${location}: cardSet '${setName}' not defined in any referenced pack`);
        }
      }
    }
  }

  for (const stack of scenario.componentSet?.stacks ?? []) {
    checkDeck(stack.deck, `stack '${stack.label ?? "(unlabeled)"}'`);
  }

  return { errors, warnings };
}

function discoverFiles(targets) {
  if (targets.length > 0) return targets.map((t) => resolve(t));
  return readdirSync(repoRoot)
    .filter((f) => f.startsWith("marvelchampions-") && f.endsWith(".json"))
    .map((f) => resolve(repoRoot, f));
}

function main() {
  const files = discoverFiles(targets);
  const assetPacks = [];
  const scenarios = [];

  for (const file of files) {
    const data = readJson(file);
    if (data.schema?.startsWith("ct-assets@")) {
      assetPacks.push({ file, pack: data });
    } else if (data.schema?.startsWith("ct-scenario@")) {
      scenarios.push({ file, scenario: data });
    }
  }

  const crossPackCards = new Set();
  for (const { pack } of assetPacks) {
    for (const code of Object.keys(pack.cards ?? {})) crossPackCards.add(code);
  }

  const results = [];
  for (const { file, pack } of assetPacks) {
    const { errors, warnings } = validateAssetPack(pack, { crossPackCards });
    results.push({ file: basename(file), kind: "asset", id: pack.id, errors, warnings });
  }
  for (const { file, scenario } of scenarios) {
    const { errors, warnings } = validateScenario(scenario, file, assetPacks);
    results.push({ file: basename(file), kind: "scenario", id: scenario.id, errors, warnings });
  }

  const totalErrors = results.reduce((n, r) => n + r.errors.length, 0);
  const totalWarnings = results.reduce((n, r) => n + r.warnings.length, 0);

  if (jsonOutput) {
    console.log(JSON.stringify({ results, totalErrors, totalWarnings }, null, 2));
  } else {
    for (const r of results) {
      const status = r.errors.length === 0 ? "✓" : "✗";
      console.log(`${status} ${r.file} [${r.kind}: ${r.id}]`);
      for (const e of r.errors) console.log(`    ERROR: ${e}`);
      for (const w of r.warnings) console.log(`    warn:  ${w}`);
    }
    console.log(`\nSummary: ${totalErrors} error(s), ${totalWarnings} warning(s) across ${results.length} file(s).`);
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

main();
