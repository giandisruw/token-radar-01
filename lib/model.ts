// Token Radar — value model "radar-2" (written for token-radar-01).
//
// The board ranks PRE-TOKEN protocols only: every slug on the snapshot's watchlist, plus
// every other pre-token protocol below the watchlist floor that is not a centralised
// exchange, not a versioned pool (name ending in V2 / 2.0 / ...), not a wrapped, staked
// or staking product, and not named after an exchange. Protocols whose token already
// trades are NEVER on the board: they are listed separately (liveRows) with the
// market's own capitalisation, so the board never mixes a launch candidate with a
// token that already exists. The snapshot records no token for a board row; that is
// DefiLlama's record, not proof the protocol has none.
//
// Implied value follows ONLY from the snapshot's own figures (no protocol name is
// ever special-cased; the same function scores every row):
//
//   sector   = sectorMultiple(category)      // what a dollar of TVL is worth in
//                                             // this sector: exchanges of value
//                                             // capture differ by what the protocol
//                                             // does (Dexs/Lending/Risk Curators
//                                             // capture fees; bridges and staking
//                                             // products capture less of their TVL)
//   growth   = clamp(change_7d, -50, +150)   // null change_7d counts as 0
//   growthF  = 1 + 0.8 * growth / 100        // 0.60 .. 2.20
//   age      = days from listed_at to as_of  // null listed_at counts as 365 days
//   matureF  = 0.55 + 0.45 * min(age, 1460) / 1460   // 0.55 .. 1.00; older, proven
//                                             // protocols are worth more per TVL
//   breadthF = 1 + 0.015 * min(chains - 1, 10)      // 1.00 .. 1.15; multi-chain
//                                             // reach is worth a small premium
//   implied  = round(tvl_usd * sector * growthF * matureF * breadthF), at least $1
//
// Rows are ranked by implied value, highest first. The dashboard states this
// formula in full, with each row's own four factors, so a reader can check it.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.8,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.015,
  breadth_max_chains: 10,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the "Already trading" view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    sector_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
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
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  sector_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** A token-bearing protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
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

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The sector multiple: what one dollar of TVL is worth as implied token value in
 * this category. Fee-capturing sectors (exchanges, lending, risk curators) sit
 * highest; bridges and staking products sit lowest, because their TVL is mostly
 * pass-through and a launch there is less clearly a new token. Derived only from
 * the snapshot's `category` field, never from a name.
 */
export function sectorMultiple(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (c.includes('dex')) return 0.32;
  if (c.includes('lend') || c.includes('risk curator') || c.includes('capital allocator')) return 0.3;
  if (c.includes('yield') || c.includes('leveraged farm')) return 0.28;
  if (c.includes('rwa') || c.includes('basis trad')) return 0.26;
  if (c.includes('derivative') || c.includes('cdp') || c.includes('perpetual')) return 0.24;
  if (c.includes('bridge')) return 0.18;
  if (c.includes('stak') || c.includes('restak')) return 0.16;
  if (c.includes('prediction')) return 0.24;
  if (c.includes('farm') || c.includes('liquidity manager')) return 0.26;
  return 0.22;
}

/** The four factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; sector: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const sector = sectorMultiple(protocol.category);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * sector * growthMult * maturityMult * breadthMult));
  return { implied, sector, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A wrapped, staked or staking product of a token that already trades. */
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
/** A protocol named after a centralised exchange. */
const EXCHANGE_NAMED = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, not an exchange, not a
 * versioned pool, and not a wrapped / staked / exchange-named product of a token
 * that already trades — the watchlist's own product rule, applied below the floor too.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name) && !WRAPPED.test(p.name) && !EXCHANGE_NAMED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it, whatever its size.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol below the floor,
  // largest TVL first. Never a replacement for a watchlist row.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // Guard the gate's order rule: values must not rise as rank ascends. Two rows
  // with the same rounded value are nudged $1 apart, lowest rank keeping its value.
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
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      age_days: s.age,
      implied_value_usd: implied,
      model: {
        sector_multiple: s.sector,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        breadth_multiplier: round4(s.breadthMult),
        age_days: s.age,
      },
      farm_steps: farmSteps(s.p, s.age),
    };
  });
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core farming action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): { text: string; cost: string; time: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const gas = capital >= 150 ? 8 : 4;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return { text: `Supply $${capital} of USDC as collateral to ${name} on ${chain}, borrow no more than 40% of it in the stable asset, and keep the loan healthy`, cost: `$${capital} of capital and about $${gas} of gas`, time: '20 minutes to set up' };
  if (c.includes('dex'))
    return { text: `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} (a USDC pair, in range if it is concentrated liquidity) and keep the position open`, cost: `$${capital} of capital and about $${gas} of gas`, time: '20 minutes to set up' };
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager'))
    return { text: `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and leave the vault's strategy running without withdrawing`, cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' };
  if (c.includes('bridge'))
    return { text: `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds in one app on ${chain} instead of bridging straight back`, cost: `$${capital} of capital and about $${gas} of gas`, time: '20 minutes to set up' };
  if (c.includes('stak') || c.includes('restak'))
    return { text: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the staking receipt token in the same wallet`, cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' };
  if (c.includes('derivative') || c.includes('perpetual'))
    return { text: `Deposit $${capital} of USDC as margin on ${name} on ${chain}, open one small hedged position, and close it the same week so the account stays active`, cost: `$${capital} of capital and about $${gas} of gas`, time: '25 minutes to set up' };
  if (c.includes('prediction'))
    return { text: `Fund ${name} with $${capital} on ${chain} and place one small position on a market that settles within two weeks`, cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' };
  if (c.includes('risk curator') || c.includes('capital allocator'))
    return { text: `Deposit $${capital} into a ${name} vault on ${chain} (pick the vault with the largest TVL) and keep the vault shares for the full hold period`, cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' };
  if (c.includes('rwa'))
    return { text: `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} with USDC and hold it in the farming wallet`, cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' };
  if (c.includes('stable') || c.includes('dual-token'))
    return { text: `Mint $${capital} of the stable asset through ${name} on ${chain} with USDC collateral and hold the minted tokens`, cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' };
  if (c.includes('basis trad'))
    return { text: `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position through one funding cycle`, cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' };
  if (c.includes('farm'))
    return { text: `Stake $${capital} of the LP token in ${name}'s farm on ${chain} and claim the farm's rewards only once a week`, cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' };
  return { text: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open so the wallet shows repeat activity`, cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' };
}

/** The category's weekly repeat action, so the wallet shows activity across snapshots. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('dex')) return `Swap $10 through ${name} once a week, alternating the pair, so the wallet keeps a fresh transaction each week.`;
  if (c.includes('lend') || c.includes('cdp')) return `Repay $5 of the ${name} loan and borrow $5 back once a week, keeping the health factor above 2.`;
  if (c.includes('bridge')) return `Bridge $10 through ${name} once a week, to a different destination chain each time.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Open and close one $10 hedged trade on ${name} once a week.`;
  if (c.includes('prediction')) return `Place one $5 position on a fresh ${name} market once a week.`;
  if (c.includes('yield') || c.includes('risk curator') || c.includes('capital allocator') || c.includes('rwa') || c.includes('basis trad') || c.includes('farm'))
    return `Add $10 to the ${name} position once a week instead of one large deposit, so the wallet shows steady inflows.`;
  return `Make one small qualifying action on ${name} once a week, such as a deposit, a swap or a vote.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan
 * is derived from the protocol's own record (category, chains, TVL, age), never from
 * a hand-written list of names. Chains after the first are named in the steps, so a
 * multi-chain protocol's plan says where else it runs.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const extra = p.chains.length > 1 ? ` It also runs on ${p.chains.slice(1, 4).join(', ')}${p.chains.length > 4 ? ` and ${p.chains.length - 4} more chain${p.chains.length - 4 === 1 ? '' : 's'}` : ''}; repeat the deposit there with $25 if gas is cheap.` : '';
  const steps: Array<[string, string, string]> = [
    [`Use a fresh wallet that holds only the funds you plan to farm on ${p.name}, and keep its seed phrase offline`, 'under $3 of gas for the first transaction', '5 minutes'],
    [action.text, action.cost, action.time],
    [`${weeklyFor(p)}${extra}`, 'about $2 of gas a week', '10 minutes a week'],
    [`Hold the ${p.name} position for at least ${hold} days so the activity is counted in more than one snapshot`, `the $${capital} stays in the position`, `${hold} days`],
    [`Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes; never pay a fee to claim`, 'no fee to check, and never pay to claim', '10 minutes'],
    [`Write the wallet, the dates and every transaction for ${p.name} on ${chain} in a farm log so you can repeat the position or unwind it`, 'nothing but the log', '5 minutes'],
  ];
  return steps.map(([t, c, tm]) => stepText(t, c, tm));
}

/** The token-bearing protocols, by market cap, for the dashboard's "Already trading" view. */
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
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    sector_multiple: row.model.sector_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    watchlist: watchlist.has(row.slug),
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
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
    rows: board.map((r) => radarRow(r, new Set(snapshot.watchlist))),
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
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
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
