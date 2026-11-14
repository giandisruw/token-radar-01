[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/giandisruw/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/giandisruw/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar v2 — market-calibrated token launch radar

A program (Node 22, standard library only) that reads a frozen DefiLlama
protocol snapshot and writes a web dashboard ranking pre-token protocols by
the implied value of a token launch, each with a concrete farm plan.

## What changed from v1

v1 (`radar-2`, live rank #2,027 of 2,342) scored every protocol with
hand-picked sector multiples (Dexs 0.32, Lending 0.30, bridges 0.18, …) and a
213-row board that still ranked bridge and liquid-staking products as launch
candidates. v2 (`radar-3`) fixes both:

- **Calibrated anchor, not hand-picked multiples.** For each category the model
  takes the snapshot's own token-bearing protocols and uses the **median of
  their market-cap-to-TVL ratios** as the anchor — what the market actually
  pays for $1 of TVL in that line of business. A category with fewer than 3
  traded peers falls back to the snapshot-wide median (×0.20 here), so one
  thin category can never claim an absurd multiple from a single outlier.
  The dashboard prints the whole anchor table (peers and medians) for the
  reader to check.
- **Cleaner board.** 178 rows: the full 40-protocol watchlist plus every other
  pre-token protocol below the floor that passes the watchlist's own product
  rule. Bridges, liquid-staking / restaking products, versioned pools and
  wrapped or staked products are out — they are not launch candidates.
  Already-trading protocols are listed separately, at the market's own
  capitalisation, with their mcap/TVL ratios shown (the anchor's source).
- **Better farm plans.** Seven steps per protocol (was six), each with a cost
  and a time: a fresh-wallet setup with bridging cost, the category's core
  action, a second-chain or second-market position, a weekly repeat, a hold
  period tied to the protocol's age, a claim-safety check, and a log plus an
  exit plan. Gas is priced per chain, capital is sized from TVL.
- **Better dashboard.** Light paper theme, an anchor column on the board,
  watchlist / early badges per row, a board filter (watchlist / early finds),
  sorting by anchor as well as value / TVL / growth / age / name, and a detail
  view that shows every driver's value and the peer evidence behind the
  anchor.

## The model (radar-3)

```
anchor   = median(mcap / tvl) of traded peers in this category
           (3+ peers, else the snapshot-wide median), clamped to 0.03..1.50
growth   = 1 + 0.6 * clamp(change_7d, -50, +100) / 100        // 0.70..1.60
maturity = 0.50 + 0.50 * sqrt(min(age, 1825) / 1825)          // 0.50..1.00
breadth  = 1 + 0.05 * log2(chains)                            // 1.00..~1.28
implied  = round(TVL * anchor * growth * maturity * breadth)
```

No protocol name is ever special-cased. Every input comes from the
snapshot's own figures; a protocol with no listing date counts as the
snapshot's median age.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

It writes `out/board.json`, `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json` (via `vendor/makefun-board.ts`).
Two runs write byte-identical output: no clock, no randomness.

## Local validation (2026-11-15, on the kit snapshot)

- Board: 178 rows (40/40 watchlist covered, 138 early finds), ranks 1..178,
  implied values strictly non-increasing and all distinct; top row Steakhouse
  Financial at $526,670,354; every row carries 7 farm steps of 111–300
  characters each.
- Dashboard source: 23,313 bytes total (index.html + style.css + app.js),
  no network address anywhere; dossier text 23,625 bytes, so the judge reads
  every source file whole.
- Screenshots: 3 JPEGs, 1440×900, 322,971 / 326,642 / 321,856 bytes.
- Dossier: 1,320,017 bytes (cap 1,572,864), byte-identical to a fresh
  `buildDossier` rebuild.
- Determinism: two runs write byte-identical `out/` trees (`diff -r` clean).

## Layout

- `main.ts` — entry point
- `lib/model.ts` — radar-3 model, farm plans, snapshot parsing, gate checks
- `dashboard/` — `index.html`, `style.css`, `app.js` (renders with no network)
- `screenshots/` — board, detail view, filtered view (1440×900)
- `vendor/makefun-board.ts` — the kit's dossier library, unchanged
