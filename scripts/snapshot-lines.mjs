#!/usr/bin/env node
// Saves ESPN's (DraftKings) lines for the upcoming week to lines/<weekId>.json.
//
//   node scripts/snapshot-lines.mjs          take whichever snapshot is due now (Eastern time)
//   node scripts/snapshot-lines.mjs sun|mon  take that snapshot now
//
// Run by .github/workflows/lines.yml on Sunday night and Monday morning. It prints counts only,
// never the lines themselves, so the Actions log can't spoil the week.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as espn from '../js/espn.js';
import { SLOT_NAME, slotToTake } from '../js/lines.js';

const forced = process.argv[2];
if (forced && !SLOT_NAME[forced]) {
  console.error('Usage: node scripts/snapshot-lines.mjs [sun|mon]');
  process.exit(1);
}

const cal = await espn.loadCalendar();
const week = await espn.targetWeek(cal);
const dir = new URL('../lines/', import.meta.url);
const file = new URL(`${week.id}.json`, dir);
let doc = { week: week.id, label: week.label };
try {
  doc = JSON.parse(readFileSync(file, 'utf8'));
} catch {
  // first snapshot for this week
}

const slot = forced || slotToTake(new Date(), doc);
if (!slot) {
  console.log(`${week.label}: not a snapshot time, nothing to do.`);
  process.exit(0);
}

const games = await espn.loadWeek(week, { fresh: true });
const lines = Object.fromEntries(games.map((g) => [g.id, g.line]));
const source = games.find((g) => g.lineSource)?.lineSource || 'ESPN';
doc[slot] = { at: new Date().toISOString(), source, lines };
mkdirSync(dir, { recursive: true });
writeFileSync(file, `${JSON.stringify(doc, null, 1)}\n`);

const name = `${week.label}, ${SLOT_NAME[slot]}`;
const posted = Object.values(lines).filter((l) => l != null).length;
console.log(`${name}: ${posted} of ${games.length} games have a ${source} line.`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `name=${name}\n`);
