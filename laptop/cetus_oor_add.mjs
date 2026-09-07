#!/usr/bin/env node
/**
 * Add TENMM to one still-out-of-range position per live Cetus pool, or open
 * a new single-sided OOR position when that pool has no suitable position.
 *
 * Default is a build-only dry run. --plan-only skips PTB building.
 * --execute signs and submits one batched transaction for all pools. SUI is used only as gas;
 * no SUI is supplied as liquidity. Keep the gas reserve.
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
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";

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
function floorSpacing(tick, spacing) { return Math.floor(tick / spacing) * spacing; }
function isStillOutOfRange(position, currentTick) {
  const lower = Number(position.tick_lower_index);
  const upper = Number(position.tick_upper_index);
  return Number.isFinite(lower) && Number.isFinite(upper) && (currentTick <= lower || currentTick >= upper);
}
async function findStillOorPosition(sdk, poolId, currentTick) {
  const positions = await sdk.Position.getPositionList(OPS_WALLET, [poolId], true);
  return positions
    .filter((position) => isType(position.pool, poolId) && BigInt(position.liquidity ?? 0) > 0n && isStillOutOfRange(position, currentTick))
    .sort((a, b) => {
      const liquidityDelta = BigInt(b.liquidity ?? 0) - BigInt(a.liquidity ?? 0);
      return liquidityDelta === 0n ? String(a.pos_object_id).localeCompare(String(b.pos_object_id)) : (liquidityDelta > 0n ? 1 : -1);
    })[0] ?? null;
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
  const reserveArg = arg("--gas-reserve-sui") ?? arg("--reserve-sui") ?? "0.75";
  const reserveSuiRaw = parseRaw(reserveArg, SUI_DECIMALS, "gas-reserve-sui");
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
  const requestedTotal = arg("--total-10mm") ? parseRaw(arg("--total-10mm"), TENMM_DECIMALS, "total-10mm") : availableTenmmRaw;
  const totalRaw = requestedTotal < availableTenmmRaw ? requestedTotal : availableTenmmRaw;
  if (totalRaw <= 0n) die("wallet has no available TENMM");
  const eachRaw = totalRaw / BigInt(pools.length);
  const leftoverRaw = totalRaw - eachRaw * BigInt(pools.length);
  if (eachRaw <= 0n) die(`available TENMM is too small to split across ${pools.length} pools`);
  if (availableSuiRaw < reserveSuiRaw) die(`SUI guard stopped: ${display(availableSuiRaw, SUI_DECIMALS)} SUI is below reserve ${display(reserveSuiRaw, SUI_DECIMALS)} SUI`);
  if (has("--execute") && availableSuiRaw < reserveSuiRaw + GAS_BUDGET_RAW) die(`SUI guard stopped: ${display(availableSuiRaw, SUI_DECIMALS)} SUI cannot cover the batched PTB gas budget and reserve`);
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
  let batchTx = has("--plan-only") ? null : new Transaction();
  const sharedTenmmCoin = batchTx ? batchTx.add(coinWithBalance({ balance: totalRaw, type: TENMM_TYPE })) : null;
  const tenmmParts = batchTx ? batchTx.splitCoins(sharedTenmmCoin, pools.map(() => batchTx.pure.u64(eachRaw))) : [];
  if (batchTx) batchTx.transferObjects([sharedTenmmCoin], OPS_WALLET);
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
    const range = rangeFor(pool, decA, decB, currentQuotePerTenmm, usdPrice);
    const existing = await findStillOorPosition(sdk, pool.id, range.currentTick);
    const action = existing ? "add" : "open";
    const tickLower = existing ? Number(existing.tick_lower_index) : range.lower;
    const tickUpper = existing ? Number(existing.tick_upper_index) : range.upper;
    const amountA = tenmmIsA ? eachRaw : 0n;
    const amountB = tenmmIsB ? eachRaw : 0n;
    const plan = { pair: item.entry.pair, dex: item.entry.dex, symbol: String(item.entry.pair).replace(/^10MM\//i, "").replace(/[^A-Za-z0-9]/g, ""), poolId: pool.id, positionId: existing?.pos_object_id ?? null, action, coinTypeA: pool.coin_type_a, coinTypeB: pool.coin_type_b, decimalsA: decA, decimalsB: decB, tickSpacing: range.spacing, currentTick: range.currentTick, tickLower, tickUpper, currentQuotePerTenmm, targetLowQuotePerTenmm: range.lowQuote, targetHighQuotePerTenmm: range.highQuote, actualLowQuotePerTenmm: range.actualLowQuote, actualHighQuotePerTenmm: range.actualHighQuote, targetLowUsd: range.lowUsd, targetHighUsd: range.highUsd, amount10mm: display(eachRaw, TENMM_DECIMALS), amount10mmRaw: eachRaw.toString(), amountA: amountA.toString(), amountB: amountB.toString(), fixAmountA: tenmmIsA, positionMode: tenmmIsA ? "TENMM-only below-range; quoted price band above spot" : "TENMM-only above-range; quoted price band above spot", priceSource: `DexScreener ${marketUrl}` };
    if (!has("--plan-only")) {
      batchTx = await sdk.Position.createAddLiquidityFixTokenPayload({ amount_a: amountA.toString(), amount_b: amountB.toString(), slippage: 0, fix_amount_a: tenmmIsA, is_open: !existing, tick_lower: tickLower, tick_upper: tickUpper, collect_fee: false, rewarder_coin_types: [], coin_type_a: pool.coin_type_a, coin_type_b: pool.coin_type_b, pool_id: pool.id, pos_id: existing?.pos_object_id ?? "" }, batchTx, tenmmIsA ? tenmmParts[plans.length] : undefined, tenmmIsB ? tenmmParts[plans.length] : undefined);
    }
    plans.push(plan);
  }
  let batch = {};
  if (!has("--plan-only")) {
    batchTx.setSender(OPS_WALLET);
    batchTx.setGasBudget(Number(GAS_BUDGET_RAW));
    const bytes = await batchTx.build({ client });
    if (!has("--execute")) {
      batch.artifact = writeArtifact(bytes, { symbol: "batch", batchedPools: pools.length, plans });
    } else {
      const signer = signerForWallet();
      if (!signer) die(`no local Ed25519 signer for ${OPS_WALLET}`);
      const result = await client.signAndExecuteTransaction({ signer, transaction: bytes, include: { effects: true, events: true, balanceChanges: true, transaction: true } });
      const executed = extractTx(result);
      const status = executed.effects?.status;
      batch = { digest: executed.digest, status, created: executed.effects?.created ?? [], events: executed.events ?? [], balanceChanges: executed.balanceChanges ?? [] };
      if (status?.status && status.status !== "success") throw new Error(`batched transaction ${executed.digest ?? "unknown"} failed: ${JSON.stringify(status)}`);
    }
  }
  const mode = has("--execute") ? "executed" : (has("--plan-only") ? "plan-only" : "dry-run");
  console.log(JSON.stringify({ network: "mainnet", mode, wallet: OPS_WALLET, availableTenmm: display(availableTenmmRaw, TENMM_DECIMALS), availableSui: display(availableSuiRaw, SUI_DECIMALS), dexScreenerUsd10mm: usdPrice, usdOffset: CENTS_ABOVE, totalAllocated10mm: display(eachRaw * BigInt(pools.length), TENMM_DECIMALS), perPool10mm: display(eachRaw, TENMM_DECIMALS), leftover10mm: display(leftoverRaw, TENMM_DECIMALS), gasReserveSui: display(reserveSuiRaw, SUI_DECIMALS),
    suiLiquidityInputRaw: "0", liveCetusPools: pools.length, batchedPtbCount: has("--plan-only") ? 0 : 1, skippedLivePools: skipped, ...batch, plans }, null, 2));
}
main().catch((error) => { console.error(error?.stack ?? error); process.exit(1); });
