#!/usr/bin/env node
/**
 * Monthly evidence checker.
 *
 * Queries Europe PMC (free, no API key) for each condition+drug pair in data.json,
 * counts trial-grade publications, and flags entries whose evidence base looks like
 * it has outgrown — or fails to justify — its current tier.
 *
 * It does NOT change tiers automatically. Tier assignment needs a human to read the
 * papers. This produces a report; you confirm, then edit data.json.
 *
 * Usage:  node scripts/check-evidence.js            (report to stdout)
 *         node scripts/check-evidence.js --write    (also writes evidence-report.json)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data.json');
const REPORT_PATH = path.join(ROOT, 'evidence-report.json');
const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';

// Thresholds that separate the tiers. Deliberately conservative — they trigger a
// human review, not a publish.
const THRESHOLD = {
  strong: { metaAnalyses: 1, rcts: 3 },   // >=1 meta-analysis AND >=3 RCTs
  emerging: { rcts: 1 },                  // >=1 RCT
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function epmc(query, extra = '') {
  const url = `${EPMC}?query=${encodeURIComponent(query + extra)}&format=json&pageSize=100&resultType=lite`;
  const res = await fetch(url, { headers: { 'User-Agent': 'psychedelics-evidence-tracker' } });
  if (!res.ok) throw new Error(`Europe PMC ${res.status} for: ${query}`);
  return res.json();
}

async function countsFor(query) {
  // Publication-type filters are Europe PMC's own indexed types.
  const [rct, meta, all] = await Promise.all([
    epmc(query, ' AND PUB_TYPE:"Randomized Controlled Trial"'),
    epmc(query, ' AND (PUB_TYPE:"Meta-Analysis" OR PUB_TYPE:"Systematic Review")'),
    epmc(query, ' AND (SRC:MED OR SRC:PMC)'),
  ]);
  return {
    rcts: rct.hitCount ?? 0,
    metaAnalyses: meta.hitCount ?? 0,
    total: all.hitCount ?? 0,
  };
}

function suggestTier(counts) {
  if (counts.metaAnalyses >= THRESHOLD.strong.metaAnalyses && counts.rcts >= THRESHOLD.strong.rcts) return 'strong';
  if (counts.rcts >= THRESHOLD.emerging.rcts) return 'emerging';
  return 'early';
}

async function main() {
  const write = process.argv.includes('--write');
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const rank = t => data.tiers[t].rank;

  const rows = [];
  for (const section of data.sections) {
    for (const item of section.items) {
      if (!item.query) continue;
      try {
        const counts = await countsFor(item.query);
        const suggested = suggestTier(counts);
        rows.push({
          section: section.title,
          condition: item.condition,
          drug: item.drug,
          current: item.tier,
          suggested,
          counts,
          flagged: suggested !== item.tier,
          direction: suggested === item.tier ? 'hold' : (rank(suggested) < rank(item.tier) ? 'upgrade' : 'downgrade'),
        });
      } catch (err) {
        rows.push({ section: section.title, condition: item.condition, drug: item.drug, current: item.tier, error: String(err.message) });
      }
      await sleep(350); // be polite to the API
    }
  }

  const flagged = rows.filter(r => r.flagged);
  const errors = rows.filter(r => r.error);

  console.log(`\nEvidence check — ${new Date().toISOString().slice(0, 10)}`);
  console.log(`${rows.length} entries checked, ${flagged.length} flagged for review, ${errors.length} errors\n`);

  if (flagged.length) {
    console.log('FLAGGED FOR HUMAN REVIEW');
    console.log('─'.repeat(78));
    for (const r of flagged) {
      const arrow = r.direction === 'upgrade' ? '↑' : '↓';
      console.log(`${arrow} ${r.condition} — ${r.drug}`);
      console.log(`   ${r.current} → ${r.suggested}   (${r.counts.rcts} RCTs, ${r.counts.metaAnalyses} meta-analyses, ${r.counts.total} total papers)`);
      console.log(`   Read before changing: https://europepmc.org/search?query=${encodeURIComponent(r.condition + ' ' + r.drug)}\n`);
    }
    console.log('If a change is warranted, edit data.json: set the item\'s "tier" and add a');
    console.log('changelog entry with the reason. Then commit — the site redeploys on push.\n');
  } else {
    console.log('No tier changes suggested this cycle.\n');
  }

  if (errors.length) {
    console.log('ERRORS');
    errors.forEach(e => console.log(`  ${e.condition} — ${e.drug}: ${e.error}`));
    console.log('');
  }

  if (write) {
    fs.writeFileSync(REPORT_PATH, JSON.stringify({ generated: new Date().toISOString(), rows }, null, 2));
    console.log(`Report written to ${path.relative(ROOT, REPORT_PATH)}\n`);
  }

  // Non-zero exit when something needs a look — lets CI open an issue.
  process.exit(flagged.length ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(2); });
