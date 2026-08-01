# Psychedelics Evidence — live tracker

A public evidence table that gets reviewed every month instead of going stale.

## The pieces

| File | What it does |
| --- | --- |
| `Psychedelics Evidence Live.dc.html` | The page. Reads `data.json` at load; falls back to a baked-in copy if the fetch fails, so it still works opened straight off disk. |
| `data.json` | **The single source of truth.** Every condition, drug, tier, and the change log. This is the only file you edit to change what the page says. |
| `scripts/check-evidence.js` | The monthly job. Queries Europe PMC for each entry and flags tier mismatches. Reports — never edits. |
| `.github/workflows/monthly-check.yml` | Runs the check at 06:00 UTC on the 1st and opens a GitHub issue if anything is flagged. |

## How a month goes

1. **1st of the month, 06:00 UTC** — the workflow runs `check-evidence.js`.
2. It queries Europe PMC per entry and counts RCTs and meta-analyses.
3. Anything whose publication record no longer matches its tier gets flagged, and a GitHub issue opens with the list and a search link per entry.
4. **You read the papers** and decide. Nothing moves on its own.
5. If a move is warranted: edit `data.json` — change the item's `"tier"`, add a `changelog` entry with the reason, bump `meta.lastReviewed` and `meta.nextReview`.
6. Commit. The host redeploys, the page shows the new tier and the new change-log line.

## Why it doesn't auto-publish

Tier assignment is a judgement call that a query can't make. "Three RCTs exist" doesn't tell you whether they were adequately powered, whether the FDA rejected the filing, or whether two of them share an author group and a sponsor. The script is good at noticing *something changed*; you're the one who decides what it means. **Detect and notify, not detect and publish.**

The thresholds live at the top of `scripts/check-evidence.js` (`THRESHOLD`) if you want them tighter or looser.

## Running the check yourself

```
node scripts/check-evidence.js
```

Needs Node 18+ (for built-in `fetch`). No API key, no install step — Europe PMC is open. Add `--write` to also drop an `evidence-report.json` next to it.

## Hosting

Any static host works; the page is one HTML file plus `data.json`.

- **Cloudflare Pages** or **Netlify** — connect the repo, set no build command, publish directory `/`. Both free, both redeploy on push.
- **GitHub Pages** — free, zero third parties; Settings → Pages → deploy from `main`.

The QR codes point at Consensus searches rather than at this page, so even a stale copy sends people to current literature.

## Editing the data

Each item looks like:

```json
{
  "condition": "Alcohol use disorder",
  "drug": "Psilocybin",
  "tier": "emerging",
  "query": "psilocybin AND \"alcohol use disorder\""
}
```

`tier` is `strong` | `emerging` | `early` — the three legend colours. `query` is what the monthly check searches; leave it off and the entry is skipped by the checker but still displayed.

Items sharing a `condition` within a section merge into one row with a pill per drug, and the row's colour blends the tiers — that's automatic, don't try to encode it.
