#!/usr/bin/env node
/**
 * Open new single-sided TENMM positions above the current TENMM/quote price
 * in every live Cetus pool listed by site/config.js.
 *
 * Default is a build-only dry run. --plan-only skips PTB building.
 * --execute signs and submits one transaction per pool. Keep the SUI reserve.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../site/config.js";
import { CetusClmmSDK } from "@cetusprotocol/sui-clmm-sdk";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const OPS_WALLET = "0x58189b677894e0fe7ad38e0e516408a3500da57d86fc0436373bc1d9c6334d0a";
const TENMM_TYPE = "0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98::tenmm::TENMM";
const SUI_TYPE = "0x2::sui::SUI";
const TENMM_DECIMALS = 8;
const SUI_DECIMALS = 9;
const GAS_BUDGET_RAW = 500_000_000n;
const TICK_MIN = -443636;
const TICK_MAX = 443636;
const CENTS_ABOVE = 0.002;
const PRICE_LOG_BASE = Math.log(1.0001);
const CETUS_PACKAGE = "0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb";
const CETUS_POSITION_TYPE = `${CETUS_PACKAGE}::position::Position`;

const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const has = (name) => process.argv.includes(name);
function die(message) { console.error(`error: ${message}`); process.exit(2); }
function normalizeType(type) {
  const text = String(type).toLowerCase();
  const m = text.match(/^0x([0-9a-f]+)(::.*)$/);
  if (!m) return text;
  return `0x${BigInt(`0x${m[1]}`).toString(16)}${m[2]}`;
}
function isType(a, b) { return normalizeType(a) === normalizeType(b); }
function totalBalance(balance) { return BigInt(balance?.totalBalance ?? balance?.balance?.balance ?? balance?.balance?.addressBalance ?? 0); }
function parseRaw(value, decimals, label) {
  if (!/^\d+(?:\.\d+)?$/.test(value ?? "")) die(`${label} must be a non-negative decimal`);
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) die(`${label} has more than ${decimals} decimals`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
}
function display(raw, decimals) {
  const n = BigInt(raw), base = 10n ** BigInt(decimals);
  const f = (n % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return f ? `${n / base}.${f}` : `${n / base}`;
}
function loadEntries() {
  const dir = process.env.SUI_CONFIG_DIR || path.join(os.homedir(), ".sui", "sui_config");
  const file = path.join(dir, "sui.keystore");
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(parsed) ? parsed : (parsed?.keys ?? []);
}
function signerForWallet() {
  for (const entry of loadEntries()) {
    try {
      if (typeof entry !== "string") continue;
      let keypair;
      if (entry.startsWith("suiprivkey")) {
        const decoded = decodeSuiPrivateKey(entry);
        if (decoded.schema !== "ED25519") continue;
        keypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);
      } else {
        const bytes = Uint8Array.from(Buffer.from(entry, "base64"));
        if (bytes.length !== 33 || bytes[0] !== 0) continue;
        keypair = Ed25519Keypair.fromSecretKey(bytes.slice(1));
      }
      if (keypair.getPublicKey().toSuiAddress().toLowerCase() === OPS_WALLET.toLowerCase()) return keypair;
    } catch { /* unrelated or unsupported keystore entry */ }
  }
  return null;
}
function writeArtifact(bytes, details) {
  const filename = `cetus_oor_add_${details.symbol}_${Date.now()}.json`;
  const output = path.join(path.dirname(fileURLToPath(import.meta.url)), filename);
  fs.writeFileSync(output, JSON.stringify({ ...details, txBytesBase64: Buffer.from(bytes).toString("base64") }, null, 2) + "\n");
  return output;
}
function extractTx(result) { return result.Transaction ?? result.FailedTransaction ?? result; }
function quotePerTenmmFromRaw(pool, decA, decB) {
  const sqrt = Number(pool.current_sqrt_price) / 2 ** 64;
  const rawBPerA = sqrt * sqrt;
  const humanBPerA = rawBPerA * 10 ** (decA - decB);
  if (!Number.isFinite(humanBPerA) || humanBPerA <= 0) throw new Error(`invalid current price in ${pool.id}`);
  return isType(pool.coin_type_a, TENMM_TYPE) ? humanBPerA : 1 / humanBPerA;
}
function rawPriceForQuotePerTenmm(pool, decA, decB, quotePerTenmm) {
  const raw = (isType(pool.coin_type_a, TENMM_TYPE) ? quotePerTenmm : 1 / quotePerTenmm) * 10 ** (decB - decA);
  if (!Number.isFinite(raw) || raw <= 0) throw new Error(`invalid target price for ${pool.id}`);
  return raw;
}
function tickAtRawPrice(raw) { return Math.log(raw) / PRICE_LOG_BASE; }
function ceilSpacing(tick, spacing) { return Math.ceil(tick / spacing) * spacing; }
function floorSpacing(tick, spacing) { return Math.floor(tick / spacing) * spacing; }function signedTick(value) {
  const n = Number(value?.bits ?? value);
  if (!Number.isFinite(n)) throw new Error(`invalid position tick ${value}`);
  return n > 0x7fffffff ? n - 0x100000000 : n;
}
function positionIsInRange(position, currentTick) {
  const lower = signedTick(position.tick_lower_index);
  const upper = signedTick(position.tick_upper_index);
  return currentTick >= lower && currentTick <= upper;
}
async function listOwnedCetusPositions(client) {
  const positions = [];
  let cursor = null;
  do {
    const page = await client.listOwnedObjects({
      owner: OPS_WALLET,
      type: CETUS_POSITION_TYPE,
      limit: 100,
      cursor,
      include: { json: true },
    });
    positions.push(...page.objects);
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor);
  return positions
    .filter((object) => object?.json?.pool && String(object.type).toLowerCase().endsWith("::position::position"))
    .map((object) => ({
      id: object.objectId,
      pool: object.json.pool,
      tickLower: signedTick(object.json.tick_lower_index),
      tickUpper: signedTick(object.json.tick_upper_index),
      liquidity: String(object.json.liquidity ?? "0"),
    }));
}
function chooseExistingOutOfRangePosition(positions, currentTick) {
  return positions
    .filter((position) => !positionIsInRange({ tick_lower_index: position.tickLower, tick_upper_index: position.tickUpper }, currentTick))
    .sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
}
function rangeFor(pool, decA, decB, currentQuotePerTenmm, usdPrice) {
  const lowUsd = usdPrice + CENTS_ABOVE;
  const highUsd = 1;
  if (!(usdPrice > 0) || !(highUsd > lowUsd)) throw new Error(`10MM USD price ${usdPrice} is not below $1`);
  const lowQuote = currentQuotePerTenmm * (lowUsd / usdPrice);
  const highQuote = currentQuotePerTenmm * (highUsd / usdPrice);
  const lowRaw = rawPriceForQuotePerTenmm(pool, decA, decB, lowQuote);
  const highRaw = rawPriceForQuotePerTenmm(pool, decA, decB, highQuote);
  const spacing = Number(pool.tick_spacing);
  const currentTick = Number(pool.current_tick_index);
  let lower;
  let upper;
  // Cetus price is coin B per coin A. A TENMM-only range is below spot
  // when TENMM is A, and above spot when TENMM is B. In both cases the
  // displayed TENMM/quote price band is above the current spot.
  if (isType(pool.coin_type_a, TENMM_TYPE)) {
    lower = ceilSpacing(tickAtRawPrice(lowRaw), spacing);
    upper = ceilSpacing(tickAtRawPrice(highRaw), spacing);
    if (lower <= currentTick) lower = (Math.floor(currentTick / spacing) + 1) * spacing;
    if (upper <= lower) upper = lower + spacing;
  } else {
    lower = floorSpacing(tickAtRawPrice(highRaw), spacing);
    upper = floorSpacing(tickAtRawPrice(lowRaw), spacing);
    const strictUpper = floorSpacing(currentTick - 1, spacing);
    if (upper >= currentTick) upper = strictUpper;
    if (lower >= upper) lower = upper - spacing;
  }
  if (lower < TICK_MIN || upper > TICK_MAX || lower >= upper) throw new Error(`invalid tick range ${lower}-${upper} for ${pool.id}`);
  const actualLowRaw = (isType(pool.coin_type_a, TENMM_TYPE) ? Math.pow(1.0001, lower) : Math.pow(1.0001, upper));
  const actualHighRaw = (isType(pool.coin_type_a, TENMM_TYPE) ? Math.pow(1.0001, upper) : Math.pow(1.0001, lower));
  const actualLowQuote = isType(pool.coin_type_a, TENMM_TYPE) ? actualLowRaw * 10 ** (decA - decB) : 1 / (actualLowRaw * 10 ** (decA - decB));
  const actualHighQuote = isType(pool.coin_type_a, TENMM_TYPE) ? actualHighRaw * 10 ** (decA - decB) : 1 / (actualHighRaw * 10 ** (decA - decB));
  return { lower, upper, spacing, currentTick, lowUsd, highUsd, lowQuote, highQuote, actualLowQuote, actualHighQuote };
}
async function main() {
  if (has("--execute") && has("--plan-only")) die("choose only one of --execute or --plan-only");
  const reserveSuiRaw = parseRaw(arg("--reserve-sui") ?? "4", SUI_DECIMALS, "reserve-sui");
  const client = new SuiGrpcClient({ network: "mainnet", baseUrl: "https://rpc-mainnet.suiscan.xyz:443" });
  const sdk = CetusClmmSDK.createSDK({ env: "mainnet" });
  sdk.setSenderAddress(OPS_WALLET);
  const liveEntries = (CONFIG.lpPools ?? []).filter((x) => x.status === "live");
  const cetusEntries = liveEntries.filter((x) => String(x.dex).toLowerCase() === "cetus");
  const skipped = liveEntries.filter((x) => String(x.dex).toLowerCase() !== "cetus").map((x) => ({ pair: x.pair, dex: x.dex, reason: "not handled by this Cetus script" }));
  const pools = cetusEntries.map((entry) => {
    const match = String(entry.note ?? "").match(/Pool\s+(0x[a-f0-9]+)/i);
    const poolId = match?.[1] ?? (entry.pair === "10MM/SUI" ? CONFIG.poolId : undefined);
    if (!poolId) die(`cannot parse Cetus pool id from config entry ${entry.pair}`);
    return { entry, poolId };
  });
  if (!pools.length) die("no live Cetus pools found in site/config.js");
  const [tenBalance, suiBalance] = await Promise.all([
    client.getBalance({ owner: OPS_WALLET, coinType: TENMM_TYPE }),
    client.getBalance({ owner: OPS_WALLET, coinType: SUI_TYPE }),
  ]);
  const availableTenmmRaw = totalBalance(tenBalance);
  const availableSuiRaw = totalBalance(suiBalance);
  const ownedPositions = await listOwnedCetusPositions(client);
  const requestedTotal = arg("--total-10mm") ? parseRaw(arg("--total-10mm"), TENMM_DECIMALS, "total-10mm") : availableTenmmRaw;
  const totalRaw = requestedTotal < availableTenmmRaw ? requestedTotal : availableTenmmRaw;
  if (totalRaw <= 0n && !has("--plan-only")) die("wallet has no available TENMM");
  const eachRaw = totalRaw / BigInt(pools.length);
  const allocatedRaw = eachRaw * BigInt(pools.length);
  const leftoverRaw = totalRaw - allocatedRaw;
  if (eachRaw <= 0n && !has("--plan-only")) die(`available TENMM is too small to split across ${pools.length} pools`);
  if (availableSuiRaw < reserveSuiRaw) die(`SUI guard stopped: ${display(availableSuiRaw, SUI_DECIMALS)} SUI is below reserve ${display(reserveSuiRaw, SUI_DECIMALS)} SUI`);
  if (has("--execute") && availableSuiRaw < reserveSuiRaw + GAS_BUDGET_RAW * BigInt(pools.length)) die(`SUI guard stopped: ${display(availableSuiRaw, SUI_DECIMALS)} SUI cannot cover worst-case gas for ${pools.length} transactions and reserve`);
  const marketUrl = CONFIG.dexscreenerUrl;
  const marketResponse = await fetch(marketUrl.replace("https://dexscreener.com", "https://api.dexscreener.com/latest/dex/pairs/sui"), { headers: { accept: "application/json" } }).catch(() => null);
  // The configured URL is a page URL; use the known pair id from its final path.
  const pairId = marketUrl.split("/").pop();
  const priceResponse = marketResponse?.ok ? marketResponse : await fetch(`https://api.dexscreener.com/latest/dex/pairs/sui/${pairId}`, { headers: { accept: "application/json" } });
  if (!priceResponse.ok) throw new Error(`DexScreener request failed (${priceResponse.status})`);
  const pricePayload = await priceResponse.json();
  const pair = pricePayload.pair ?? pricePayload.pairs?.find((x) => x.pairAddress?.toLowerCase() === pairId.toLowerCase()) ?? pricePayload.pairs?.[0];
  const usdPrice = Number(pair?.priceUsd);
  if (!Number.isFinite(usdPrice) || usdPrice <= 0) throw new Error(`invalid DexScreener 10MM USD price ${pair?.priceUsd}`);
  const configs = await sdk.CetusConfig.getCoinConfigs(true);
  const decimalsByType = new Map(configs.map((x) => [normalizeType(x.address), Number(x.decimals)]));
  decimalsByType.set(normalizeType(TENMM_TYPE), TENMM_DECIMALS);
  decimalsByType.set(normalizeType(SUI_TYPE), SUI_DECIMALS);
  const plans = [];
  for (const item of pools) {
    const pool = await sdk.Pool.getPool(item.poolId, true);
    const decA = decimalsByType.get(normalizeType(pool.coin_type_a));
    const decB = decimalsByType.get(normalizeType(pool.coin_type_b));
    if (!Number.isInteger(decA) || !Number.isInteger(decB)) throw new Error(`missing decimals for ${pool.coin_type_a}/${pool.coin_type_b}`);
    const tenmmIsA = isType(pool.coin_type_a, TENMM_TYPE);
    const tenmmIsB = isType(pool.coin_type_b, TENMM_TYPE);
    if (!tenmmIsA && !tenmmIsB) throw new Error(`${item.poolId} does not contain TENMM`);
    if (pool.is_pause || BigInt(pool.liquidity ?? 0) <= 0n) throw new Error(`pool ${item.entry.pair} is paused or empty`);
    const currentQuotePerTenmm = quotePerTenmmFromRaw(pool, decA, decB);
    const poolPositions = ownedPositions.filter((position) => position.pool.toLowerCase() === pool.id.toLowerCase());
    const existingOor = chooseExistingOutOfRangePosition(poolPositions, Number(pool.current_tick_index));
    const action = existingOor ? "add-existing-oor" : "new-oor";
    const range = existingOor ? { spacing: Number(pool.tick_spacing), currentTick: Number(pool.current_tick_index) } : rangeFor(pool, decA, decB, currentQuotePerTenmm, usdPrice);
    const targetPositionId = existingOor?.id ?? "";
    const tickLower = existingOor?.tickLower ?? range.lower;
    const tickUpper = existingOor?.tickUpper ?? range.upper;
    const amountA = tenmmIsA ? eachRaw : 0n;
    const amountB = tenmmIsB ? eachRaw : 0n;
    const plan = { pair: item.entry.pair, dex: item.entry.dex, symbol: String(item.entry.pair).replace(/^10MM\//i, "").replace(/[^A-Za-z0-9]/g, ""), poolId: pool.id, coinTypeA: pool.coin_type_a, coinTypeB: pool.coin_type_b, decimalsA: decA, decimalsB: decB, action, existingPositionId: existingOor?.id ?? null, existingPositionCount: poolPositions.length, tickSpacing: range.spacing, currentTick: range.currentTick, tickLower, tickUpper, currentQuotePerTenmm, targetLowQuotePerTenmm: existingOor ? null : range.lowQuote, targetHighQuotePerTenmm: existingOor ? null : range.highQuote, actualLowQuotePerTenmm: existingOor ? null : range.actualLowQuote, actualHighQuotePerTenmm: existingOor ? null : range.actualHighQuote, targetLowUsd: existingOor ? null : range.lowUsd, targetHighUsd: existingOor ? null : range.highUsd, amount10mm: display(eachRaw, TENMM_DECIMALS), amount10mmRaw: eachRaw.toString(), amountA: amountA.toString(), amountB: amountB.toString(), fixAmountA: tenmmIsA, positionMode: tenmmIsA ? "TENMM-only below-range; quoted price band above spot" : "TENMM-only above-range; quoted price band above spot", priceSource: `DexScreener ${marketUrl}` };
    if (has("--plan-only")) { plans.push(plan); continue; }
    const tx = await sdk.Position.createAddLiquidityFixTokenPayload({ amount_a: amountA.toString(), amount_b: amountB.toString(), slippage: 0, fix_amount_a: tenmmIsA, is_open: !existingOor, tick_lower: tickLower, tick_upper: tickUpper, collect_fee: false, rewarder_coin_types: [], coin_type_a: pool.coin_type_a, coin_type_b: pool.coin_type_b, pool_id: pool.id, pos_id: targetPositionId });    tx.setSender(OPS_WALLET);
    tx.setGasBudget(Number(GAS_BUDGET_RAW));
    if (!has("--execute")) {
      const bytes = await tx.build({ client });
      plan.artifact = writeArtifact(bytes, plan);
      plans.push(plan);
      continue;
    }
    const bytes = await tx.build({ client });
    const signer = signerForWallet();
    if (!signer) die(`no local Ed25519 signer for ${OPS_WALLET}`);
    const result = await client.signAndExecuteTransaction({ signer, transaction: bytes, include: { effects: true, events: true, balanceChanges: true, transaction: true } });
    const executed = extractTx(result);
    const status = executed.effects?.status;
    plan.digest = executed.digest;
    plan.status = status;
    plan.created = executed.effects?.created ?? [];
    plan.events = executed.events ?? [];
    plan.balanceChanges = executed.balanceChanges ?? [];
    plans.push(plan);
    if (status?.status && status.status !== "success") throw new Error(`transaction ${executed.digest ?? "unknown"} failed: ${JSON.stringify(status)}`);
  }
  const mode = has("--execute") ? "executed" : (has("--plan-only") ? "plan-only" : "dry-run");
  console.log(JSON.stringify({ network: "mainnet", mode, wallet: OPS_WALLET, availableTenmm: display(availableTenmmRaw, TENMM_DECIMALS), availableSui: display(availableSuiRaw, SUI_DECIMALS), dexScreenerUsd10mm: usdPrice, usdOffset: CENTS_ABOVE, totalAllocated10mm: display(allocatedRaw, TENMM_DECIMALS), perPool10mm: display(eachRaw, TENMM_DECIMALS), leftover10mm: display(leftoverRaw, TENMM_DECIMALS), reserveSui: display(reserveSuiRaw, SUI_DECIMALS), liveCetusPools: pools.length, skippedLivePools: skipped, ownedCetusPositions: ownedPositions.length, plans }, null, 2));
}
main().catch((error) => { console.error(error?.stack ?? error); process.exit(1); });
