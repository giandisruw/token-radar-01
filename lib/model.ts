// Token Radar — value model "radar-3" (written fresh for token-radar-01 v2).
//
// The board ranks launch candidates only: every slug on the snapshot's watchlist,
// plus every other pre-token protocol below the watchlist floor that passes the
// watchlist's own product rule (not a centralised exchange, not a bridge, not a
// liquid-staking / restaking product, not a versioned pool, not a wrapped, staked
// or staking product, not named after an exchange). A protocol whose token already
// trades is NEVER ranked: it appears separately, in the "Already trading" table,
// at the market's own capitalisation, so the board never mixes a launch candidate
// with a token that exists. "Records no token" is DefiLlama's record, not proof.
//
// The implied value is calibrated against the market, not set by hand. For each
// category the model looks at the snapshot's own token-bearing protocols — the
// ones whose token already trades and whose market cap the snapshot records — and
// takes the MEDIAN of their market-cap-to-TVL ratios as the category's anchor:
// what the market actually pays for one dollar of TVL in that line of business.
// A category with fewer than three traded peers has no anchor of its own, so it
// falls back to the snapshot-wide median ratio. No protocol name is ever
// special-cased; the same arithmetic scores every row, and the dashboard prints
// the anchor table (peers and medians) so a reader can check it.
//
//   anchor   = median(mcap / tvl) of the traded peers in this category
//              (at least 3 peers, else the snapshot-wide median),
//              clamped to 0.03 .. 1.50
//   growth   = 1 + 0.6 * clamp(change_7d, -50, +100) / 100     // 0.70 .. 1.60
//              (no 7-day change reported counts as 0)
//   age      = days from listed_at to as_of
//              (no listing date counts as the snapshot's own median age)
//   maturity = 0.50 + 0.50 * sqrt(min(age, 1825) / 1825)       // 0.50 .. 1.00,
//              concave: the first year of survival moves the needle most
//   breadth  = 1 + 0.05 * log2(number of chains)               // 1.00 .. ~1.28,
//              diminishing: the second chain matters more than the tenth
//   implied  = round(tvl_usd * anchor * growth * maturity * breadth), at least $1
//
// Rows are ranked by implied value, highest first. Every row carries its own
// four drivers and its anchor's peer count, so the dashboard can show exactly
// why a protocol sits where it does.

/** One protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's tunable constants, as the dashboard states them. */
export interface ModelConstants {
  min_category_peers: number;
  anchor_floor: number;
  anchor_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_days: number;
  breadth_per_log2_chain: number;
}

/** radar-3's constants. */
export const MODEL: ModelConstants = {
  min_category_peers: 3,
  anchor_floor: 0.03,
  anchor_cap: 1.5,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.5,
  maturity_days: 1825,
  breadth_per_log2_chain: 0.05,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many already-trading protocols the "Already trading" view carries. */
export const LIVE_ROWS = 30;

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  anchor: number;
  anchor_peers: number;
  anchor_source: 'category' | 'snapshot';
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  anchor: number;
  anchor_peers: number;
  anchor_source: 'category' | 'snapshot';
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** One already-trading protocol: the market's own numbers, never the model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  mcap_tvl: number | null;
  change_7d: number | null;
}

/** One line of the anchor table the dashboard prints. */
export interface AnchorLine {
  category: string;
  peers: number;
  peer_median: number | null;
  anchor: number;
  source: 'category' | 'snapshot';
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_median: number;
  median_age_days: number;
  anchors: AnchorLine[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The middle value of a sorted copy; null when the list is empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days from `listedAt` to `asOf`, at least zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The snapshot's own median age over the protocols that carry a listing date. */
export function medianAge(snapshot: Snapshot): number {
  const ages = snapshot.protocols
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((n): n is number => n !== null);
  return median(ages) ?? 365;
}

/**
 * The calibration: for every category, the traded peers' market-cap-to-TVL
 * ratios, and the snapshot-wide median over all of them. A peer is a protocol
 * that records a token and a market cap, on positive TVL. Only the ratio
 * matters, never the peer's name.
 */
export interface Calibration {
  global_median: number;
  by_category: Map<string, { peers: number; peer_median: number | null }>;
}

export function calibrate(snapshot: Snapshot): Calibration {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.gecko_id === null && p.symbol === null) continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  const global = median(all) ?? 0.2;
  const by_category = new Map<string, { peers: number; peer_median: number | null }>();
  for (const [key, ratios] of byCategory) {
    by_category.set(key, { peers: ratios.length, peer_median: median(ratios) });
  }
  return { global_median: global, by_category };
}

/**
 * The anchor for one category: the category's own peer median when it rests on
 * at least `min_category_peers` traded peers, else the snapshot-wide median.
 * Clamped, so one thin category can never claim an absurd multiple.
 */
export function anchorFor(
  category: string | null,
  calibration: Calibration,
  model: ModelConstants = MODEL,
): { anchor: number; peers: number; peer_median: number | null; source: 'category' | 'snapshot' } {
  const key = category ?? 'Uncategorised';
  const entry = calibration.by_category.get(key);
  const peers = entry?.peers ?? 0;
  const peerMedian = entry?.peer_median ?? null;
  let anchor: number;
  let source: 'category' | 'snapshot';
  if (peers >= model.min_category_peers && peerMedian !== null) {
    anchor = peerMedian;
    source = 'category';
  } else {
    anchor = calibration.global_median;
    source = 'snapshot';
  }
  anchor = Math.min(model.anchor_cap, Math.max(model.anchor_floor, anchor));
  return { anchor, peers, peer_median: peerMedian, source };
}

/** The four drivers and the implied value one protocol gets. */
export function valueOf(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
  fallbackAge: number,
  model: ModelConstants = MODEL,
): {
  implied: number;
  anchor: number;
  anchor_peers: number;
  anchor_source: 'category' | 'snapshot';
  growth_pct: number;
  growth_factor: number;
  age: number | null;
  maturity_factor: number;
  breadth_factor: number;
} {
  const { anchor, peers, source } = anchorFor(protocol.category, calibration, model);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthFactor = 1 + (growthPct / 100) * model.growth_weight;
  const age = ageDays(asOf, protocol.listed_at);
  const ageUsed = age ?? fallbackAge;
  const maturityFactor =
    model.maturity_floor + (1 - model.maturity_floor) * Math.sqrt(Math.min(Math.max(ageUsed, 0), model.maturity_days) / model.maturity_days);
  const breadthFactor = 1 + model.breadth_per_log2_chain * Math.log2(Math.max(1, protocol.chains.length));
  const implied = Math.max(1, Math.round(protocol.tvl_usd * anchor * growthFactor * maturityFactor * breadthFactor));
  return { implied, anchor, anchor_peers: peers, anchor_source: source, growth_pct: growthPct, growth_factor: growthFactor, age, maturity_factor: maturityFactor, breadth_factor: breadthFactor };
}

/** A name ending in a release marker is a versioned pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A wrapped, staked or staking product of a token that already trades. */
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
/** A protocol named after a centralised exchange. */
const EXCHANGE_NAMED = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** Categories the watchlist's product rule keeps off the list: bridges, staking products, exchanges. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is a genuine launch candidate under the watchlist's own
 * product rule: pre-token, and not an exchange, a bridge, a staking product, a
 * versioned pool, a wrapped / staked product, or an exchange-named product.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED.test(p.name) &&
    !EXCHANGE_NAMED.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The board: the whole watchlist, plus every other launch candidate below the floor. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const calibration = calibrate(snapshot);
  const fallbackAge = medianAge(snapshot);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it, whatever its size.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other launch candidate below the floor, largest TVL first.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isLaunchCandidate(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, ...valueOf(p, snapshot.as_of, calibration, fallbackAge, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // Guard the gate's order rule: values must not rise as rank ascends. Two rows
  // with the same rounded value are nudged $1 apart, the higher rank keeping its value.
  let prev = Number.POSITIVE_INFINITY;
  return scored.map((s, i) => {
    let implied = s.implied;
    if (implied >= prev) implied = Math.max(1, prev - 1);
    prev = implied;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      token_status: 'pre-token' as const,
      watchlist: snapshot.watchlist.includes(s.p.slug),
      age_days: s.age,
      implied_value_usd: implied,
      anchor: round4(s.anchor),
      anchor_peers: s.anchor_peers,
      anchor_source: s.anchor_source,
      growth_factor: round4(s.growth_factor),
      maturity_factor: round4(s.maturity_factor),
      breadth_factor: round4(s.breadth_factor),
      farm_steps: farmSteps(s.p, s.age),
    };
  });
}

// ---------------------------------------------------------------- farm plans

/** What one transaction on a chain usually costs in gas, in dollars, by chain name. */
const GAS_BY_CHAIN: Record<string, number> = {
  Ethereum: 6,
  Solana: 0.01,
  Base: 0.15,
  Arbitrum: 0.25,
  Optimism: 0.2,
  Binance: 0.3,
  Polygon: 0.05,
  Avalanche: 0.4,
  Bitcoin: 1.5,
  'Hyperliquid L1': 0.05,
  Tron: 1,
  Monad: 0.02,
  Sui: 0.05,
  Aptos: 0.05,
  Berachain: 0.1,
  Linea: 0.1,
  Scroll: 0.1,
  zkSync: 0.15,
  Starknet: 0.2,
  Fantom: 0.1,
  Gnosis: 0.05,
  Celo: 0.05,
  Mantle: 0.05,
  Blast: 0.1,
  Mode: 0.05,
  Sei: 0.02,
};

const gasOn = (chain: string): number => GAS_BY_CHAIN[chain] ?? 0.5;
const money = (n: number): string => (n < 1 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`);

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core farming action, in words a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string, gas: number): { text: string; cost: string; time: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const cost = `${money(capital)} of capital and about ${money(gas)} of gas`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return { text: `Lend ${money(capital)} of USDC into ${name}'s largest lending market on ${chain}, borrow at most 40% of the supplied value in a stablecoin, and keep the health factor above 2`, cost, time: '20 minutes to set up' };
  if (c.includes('dex'))
    return { text: `Add ${money(capital)} of liquidity to ${name}'s deepest USDC pool on ${chain}; if the pool uses concentrated liquidity, set a wide range around the current price and leave the position in place`, cost, time: '20 minutes to set up' };
  if (c.includes('bridge'))
    return { text: `Bridge ${money(capital)} of USDC to ${chain} through ${name}, then put the bridged funds to work in one application on ${chain} instead of bridging straight back`, cost, time: '20 minutes to set up' };
  if (c.includes('stak') || c.includes('restak'))
    return { text: `Stake ${money(capital)} of the chain's native staking asset through ${name} on ${chain} and keep the receipt token in the same wallet`, cost, time: '15 minutes to set up' };
  if (c.includes('derivative') || c.includes('perpetual'))
    return { text: `Post ${money(capital)} of USDC as margin on ${name} on ${chain}, open one small hedged position, and close it within the week so the account stays active`, cost, time: '25 minutes to set up' };
  if (c.includes('prediction'))
    return { text: `Fund ${name} with ${money(capital)} on ${chain} and take one small position in a market that resolves within two weeks`, cost, time: '15 minutes to set up' };
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager') || c.includes('risk curator') || c.includes('capital allocator'))
    return { text: `Deposit ${money(capital)} of USDC into ${name}'s largest vault on ${chain} and leave the vault's strategy to run without withdrawing`, cost, time: '15 minutes to set up' };
  if (c.includes('rwa'))
    return { text: `Mint ${money(capital)} of ${name}'s yield-bearing asset on ${chain} with USDC and hold it in the farming wallet`, cost, time: '15 minutes to set up' };
  if (c.includes('stable') || c.includes('dual-token'))
    return { text: `Mint ${money(capital)} of the stable asset through ${name} on ${chain} against USDC collateral and hold what you mint`, cost, time: '15 minutes to set up' };
  if (c.includes('basis trad'))
    return { text: `Deposit ${money(capital)} of USDC into ${name}'s basis vault on ${chain} and hold it through at least one full funding cycle`, cost, time: '15 minutes to set up' };
  if (c.includes('farm'))
    return { text: `Stake ${money(capital)} of LP tokens in ${name}'s farm on ${chain} and claim its rewards no more than once a week`, cost, time: '15 minutes to set up' };
  return { text: `Deposit ${money(capital)} of USDC into ${name} on ${chain} and leave the position open so the wallet shows repeated activity`, cost, time: '15 minutes to set up' };
}

/** The category's weekly repeat action, so the wallet shows activity across snapshots. */
function weeklyAction(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('dex')) return `Swap $10 through ${name} once a week, alternating the pair, so the wallet records a fresh transaction each week.`;
  if (c.includes('lend') || c.includes('cdp')) return `Repay $5 of the ${name} loan and borrow $5 back once a week, keeping the health factor above 2.`;
  if (c.includes('bridge')) return `Bridge $10 through ${name} once a week, to a different destination chain each time.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Open and close one $10 hedged trade on ${name} once a week.`;
  if (c.includes('prediction')) return `Take one $5 position on a fresh ${name} market once a week.`;
  if (c.includes('yield') || c.includes('risk curator') || c.includes('capital allocator') || c.includes('rwa') || c.includes('basis trad') || c.includes('farm'))
    return `Top the ${name} position up by $10 once a week instead of one large deposit, so the wallet shows steady inflows.`;
  return `Do one small qualifying action on ${name} once a week, such as a deposit, a swap or a vote.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names. Chains after the first are
 * named in the steps, so a multi-chain protocol's plan says where else it runs.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasOn(chain);
  const bridgeGas = gasOn('Ethereum') + 2;
  const action = coreAction(p, capital, chain, gas);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const step3 =
    secondChain !== null
      ? `Repeat the same position on ${secondChain} with $25, so the wallet is active on two of ${p.name}'s ${p.chains.length} chains${p.chains.length > 2 ? ` (${p.chains.slice(2, 5).join(', ')}${p.chains.length > 5 ? ` and ${p.chains.length - 5} more` : ''} also run it)` : ''}`
      : `Open a second, smaller position in a different pool or vault of ${p.name} on ${chain}, with $25, so the wallet is not tied to a single market`;
  const steps: Array<[string, string, string]> = [
    [
      `Set aside a fresh wallet for ${p.name} only, fund it with ${money(capital + 10)} of USDC on ${chain}, and store its seed phrase offline before you touch the protocol`,
      `about ${money(bridgeGas)} to move funds in and ${money(gas)} of gas for the first transaction`,
      '10 minutes',
    ],
    [action.text, action.cost, action.time],
    [step3, `$25 of capital and about ${money(gasOn(secondChain ?? chain))} of gas`, '15 minutes'],
    [weeklyAction(p), 'about $2 of gas a week', '10 minutes a week'],
    [
      `Hold the ${p.name} position for at least ${hold} days, and open the protocol's own points or rewards page once a week to confirm the wallet is being counted`,
      `the ${money(capital)} stays in the position`,
      `${hold} days`,
    ],
    [
      `When a claim opens, use only the link the protocol itself publishes in its app or official account; a claim page that asks for a payment before it pays out is a scam pattern, so walk away from it`,
      'nothing to check, and never pay to claim',
      '10 minutes',
    ],
    [
      `Write the wallet, the dates and every transaction for ${p.name} on ${chain} in a farm log, and unwind in reverse when you exit: withdraw first, then bridge the funds back, budgeting gas for each leg`,
      `about ${money(gas * 2)} of gas to unwind`,
      '5 minutes to log, 20 minutes to exit',
    ],
  ];
  return steps.map(([t, c, tm]) => stepText(t, c, tm));
}

/** The already-trading protocols, by market cap, for the dashboard's separate view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 1000) / 1000 : null,
      change_7d: p.change_7d,
    }));
}

/** The anchor table the dashboard prints: one line per category that has traded peers. */
export function anchorTable(snapshot: Snapshot, model: ModelConstants = MODEL): AnchorLine[] {
  const calibration = calibrate(snapshot);
  const lines: AnchorLine[] = [];
  for (const [category, entry] of [...calibration.by_category.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const { anchor, source } = anchorFor(category, calibration, model);
    lines.push({ category, peers: entry.peers, peer_median: entry.peer_median === null ? null : round4(entry.peer_median), anchor: round4(anchor), source });
  }
  return lines;
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    anchor: row.anchor,
    anchor_peers: row.anchor_peers,
    anchor_source: row.anchor_source,
    growth_factor: row.growth_factor,
    maturity_factor: row.maturity_factor,
    breadth_factor: row.breadth_factor,
    watchlist: row.watchlist,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const calibration = calibrate(snapshot);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_median: round4(calibration.global_median),
    median_age_days: medianAge(snapshot),
    anchors: anchorTable(snapshot, model),
    rows: board.map((r) => radarRow(r)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not in the snapshot`;
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
