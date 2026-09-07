#!/usr/bin/env node
/**
 * Cetus mainnet SUI -> DEEP -> [coin] -> SUI loop scanner.
 * Dry-run is the default. --execute is atomic, reserve-checked, and only
 * allowed when the conservative net profit is >= --min-profit.
 *
 * Uses the same Cetus CLMM SDK v1 patterns as cetus_swap_sui_to_coin.mjs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { CetusClmmSDK } from "@cetusprotocol/sui-clmm-sdk";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

const OPS_WALLET = "0x58189b677894e0fe7ad38e0e516408a3500da57d86fc0436373bc1d9c6334d0a";
const SUI_TYPE = "0x2::sui::SUI";
const DEFAULT_SYMBOLS = ["DEEP", "WAL", "USDC", "NAVX", "NS", "vSUI", "suiUSDT"];
const SPACINGS = [2, 4, 10, 20, 60, 100, 200];
const MIN_SQRT_PRICE = 4295048016n;
const MAX_SQRT_PRICE = 79226673515401279992447579055n;
const DEFAULT_GAS_SUI = "0.002";

const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const has = (name) => process.argv.includes(name);
function die(message) { console.error(`error: ${message}`); process.exitCode = 2; throw new Error(message); }
function parseDecimal(value, decimals, label) {
  if (!/^\d+(?:\.\d+)?$/.test(value ?? "")) die(`${label} must be a non-negative decimal`);
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) die(`${label} has more than ${decimals} decimals`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
}
function display(raw, decimals) {
  const n = BigInt(raw); const base = 10n ** BigInt(decimals);
  const f = (n % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return f ? `${n / base}.${f}` : `${n / base}`;
}
function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) die(`${label} must be an integer from 0 to ${max}`);
  return n;
}
function totalBalance(balance) { return BigInt(balance?.totalBalance ?? balance?.balance?.balance ?? balance?.balance?.addressBalance ?? 0); }
function isPaused(pool) { return pool?.is_pause === true || pool?.pool_status?.disable_swap === true || pool?.pool_status?.disableSwap === true; }
function isLive(pool) { return pool && !isPaused(pool) && BigInt(pool.liquidity ?? 0) > 0n; }
function canonicalPair(left, right) {
  return left.toLowerCase() > right.toLowerCase() ? [left, right] : [right, left];
}
function typeEquals(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
function feeRateDisplay(rate) {
  try { return `${(Number(rate) / 1_000_000 * 100).toFixed(4)}%`; } catch { return String(rate ?? "unknown"); }
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
    } catch { /* unrelated keystore entry */ }
  }
  return null;
}

const amountSuiText = arg("--sui-amount") ?? "1";
const reserveSuiText = arg("--reserve-sui") ?? "0.75";
const minProfitText = arg("--min-profit") ?? "0.01";
const gasSuiText = arg("--gas-sui") ?? DEFAULT_GAS_SUI;
const slippageBps = positiveInt(arg("--slippage-bps") ?? "100", "--slippage-bps", 1000);
const maxHops = positiveInt(arg("--max-hops") ?? "3", "--max-hops", 3);
if (maxHops < 2) die("--max-hops must be 2 or 3");
const execute = has("--execute");
const amountRaw = parseDecimal(amountSuiText, 9, "--sui-amount");
const reserveRaw = parseDecimal(reserveSuiText, 9, "--reserve-sui");
const minProfitRaw = parseDecimal(minProfitText, 9, "--min-profit");
const gasRaw = parseDecimal(gasSuiText, 9, "--gas-sui");
if (amountRaw <= 0n) die("--sui-amount must be greater than zero");
if (amountRaw > 1_000_000_000n) die("--sui-amount exceeds the 1 SUI default cap; pass a smaller amount");
const requestedSymbols = (arg("--symbols") ?? DEFAULT_SYMBOLS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);

const sdk = CetusClmmSDK.createSDK({ env: "mainnet" });
sdk.setSenderAddress(OPS_WALLET);
const client = new SuiGrpcClient({ network: "mainnet", baseUrl: "https://fullnode.mainnet.sui.io:443" });

async function resolveCoins() {
  const configs = await sdk.CetusConfig.getCoinConfigs(true);
  const find = (name) => {
    const exact = configs.find((x) => x.address?.toLowerCase() === name.toLowerCase());
    if (exact) return { symbol: exact.symbol, decimals: Number(exact.decimals), type: exact.address };
    const hits = configs.filter((x) => x.symbol?.toLowerCase() === name.toLowerCase() || x.official_symbol?.toLowerCase() === name.toLowerCase());
    if (hits.length === 1) return { symbol: hits[0].symbol, decimals: Number(hits[0].decimals), type: hits[0].address };
    if (hits.length > 1) throw new Error(`symbol ${name} is ambiguous; pass a full coin type`);
    throw new Error(`symbol ${name} is not in Cetus metadata`);
  };
  const deep = find("DEEP");
  const coins = [];
  for (const symbol of requestedSymbols) {
    try { const coin = find(symbol); if (!coins.some((x) => typeEquals(x.type, coin.type))) coins.push(coin); }
    catch (error) { console.warn(`skip ${symbol}: ${error.message}`); }
  }
  return { deep, coins };
}

async function findBestPool(from, to) {
  const [coinA, coinB] = canonicalPair(from.type, to.type);
  const candidates = [];
  for (const spacing of SPACINGS) {
    try {
      const id = await sdk.Pool.getPoolAddress(coinA, coinB, spacing);
      if (!id) continue;
      const pool = await sdk.Pool.getPool(id, true);
      if (isLive(pool)) candidates.push(pool);
    } catch { /* no pool at this fee tier */ }
  }
  if (!candidates.length) return null;
  candidates.sort((x, y) => BigInt(y.liquidity) > BigInt(x.liquidity) ? 1 : -1);
  return candidates[0];
}

async function quoteLeg(from, to, amountInRaw) {
  const pool = await findBestPool(from, to);
  if (!pool) return null;
  const a2b = typeEquals(pool.coin_type_a, from.type);
  const decimalsA = typeEquals(pool.coin_type_a, from.type) ? from.decimals : to.decimals;
  const decimalsB = typeEquals(pool.coin_type_b, to.type) ? to.decimals : from.decimals;
  const quote = await sdk.Swap.preSwap({
    pool,
    current_sqrt_price: Number(pool.current_sqrt_price),
    decimals_a: decimalsA,
    decimals_b: decimalsB,
    a2b,
    by_amount_in: true,
    amount: amountInRaw.toString(),
    coin_type_a: pool.coin_type_a,
    coin_type_b: pool.coin_type_b,
  });
  const amountOutRaw = BigInt(quote?.estimated_amount_out ?? 0);
  const feeRaw = BigInt(quote?.estimated_fee_amount ?? 0);
  if (amountOutRaw <= 0n || quote?.is_exceed) return null;
  const minOutRaw = amountOutRaw * BigInt(10_000 - slippageBps) / 10_000n;
  return { from, to, pool, a2b, amountInRaw, amountOutRaw, minOutRaw, feeRaw, quote };
}

async function quotePath(coins, labels) {
  const legs = [];
  let amount = amountRaw;
  for (let i = 0; i < labels.length - 1; i += 1) {
    const from = coins.find((x) => typeEquals(x.type, labels[i].type));
    const to = coins.find((x) => typeEquals(x.type, labels[i + 1].type));
    const leg = await quoteLeg(from, to, amount);
    if (!leg) return null;
    legs.push(leg);
    amount = leg.amountOutRaw;
  }
  const conservativeOutRaw = amount * BigInt(10_000 - slippageBps) / 10_000n;
  const netRaw = conservativeOutRaw - amountRaw - gasRaw;
  return { labels, legs, expectedOutRaw: amount, conservativeOutRaw, netRaw };
}

function routeSummary(route) {
  return {
    path: route.labels.map((x) => x.symbol).join(" -> "),
    expectedOutSui: display(route.expectedOutRaw, 9),
    conservativeOutSui: display(route.conservativeOutRaw, 9),
    estimatedGasSui: display(gasRaw, 9),
    netVsInputSui: (route.netRaw < 0n ? "-" : "") + display(route.netRaw < 0n ? -route.netRaw : route.netRaw, 9),
    profitableAfterFloor: route.netRaw >= minProfitRaw,
    legs: route.legs.map((leg) => ({
      from: leg.from.symbol, to: leg.to.symbol,
      poolId: leg.pool.id,
      feeRate: feeRateDisplay(leg.pool.fee_rate),
      amountIn: display(leg.amountInRaw, leg.from.decimals),
      estimatedOut: display(leg.amountOutRaw, leg.to.decimals),
      estimatedAmmFee: display(leg.feeRaw, leg.from.decimals),
      minimumOutAtSlippage: display(leg.minOutRaw, leg.to.decimals),
      slippageBps,
    })),
  };
}

function addThreshold(tx, integrateAddress, coin, minimumRaw) {
  tx.moveCall({
    target: `${integrateAddress}::utils::check_coin_threshold`,
    typeArguments: [coin.type],
    arguments: [coin.object, tx.pure.u64(minimumRaw.toString())],
  });
}

function buildAtomicTransaction(route) {
  const integrate = sdk.sdkOptions.integrate?.published_at;
  const globalConfig = sdk.sdkOptions.clmm_pool?.config?.global_config_id ?? sdk.sdkOptions.clmm_pool?.global_config_id;
  if (!integrate || !globalConfig) throw new Error("Cetus SDK config does not expose the expected atomic swap config");
  const tx = new Transaction();
  tx.setSender(OPS_WALLET);
  let current = { type: SUI_TYPE, object: tx.splitCoins(tx.gas, [tx.pure.u64(amountRaw.toString())])[0] };
  const leftovers = [];
  for (const leg of route.legs) {
    const pool = leg.pool;
    const coinA = typeEquals(pool.coin_type_a, current.type) ? current : { type: pool.coin_type_a, object: tx.moveCall({ target: "0x2::coin::zero", typeArguments: [pool.coin_type_a], arguments: [] }) };
    const coinB = typeEquals(pool.coin_type_b, current.type) ? current : { type: pool.coin_type_b, object: tx.moveCall({ target: "0x2::coin::zero", typeArguments: [pool.coin_type_b], arguments: [] }) };
    const args = [
      tx.object(globalConfig), tx.object(pool.id), coinA.object, coinB.object,
      tx.pure.bool(leg.a2b), tx.pure.bool(true), tx.pure.u64(leg.amountInRaw.toString()),
      tx.pure.u128((leg.a2b ? MIN_SQRT_PRICE : MAX_SQRT_PRICE).toString()), tx.pure.bool(false), tx.object("0x6"),
    ];
    const result = tx.moveCall({ target: `${integrate}::router::swap`, typeArguments: [pool.coin_type_a, pool.coin_type_b], arguments: args });
    const next = leg.a2b ? { type: pool.coin_type_b, object: result[1] } : { type: pool.coin_type_a, object: result[0] };
    const remainder = leg.a2b ? { type: pool.coin_type_a, object: result[0] } : { type: pool.coin_type_b, object: result[1] };
    addThreshold(tx, integrate, next, leg.minOutRaw);
    leftovers.push(remainder);
    current = next;
  }
  leftovers.push(current);
  for (const coin of leftovers) tx.transferObjects([coin.object], tx.pure.address(OPS_WALLET));
  return tx;
}

async function executeRoute(route, balance) {
  if (route.netRaw < minProfitRaw) throw new Error(`execution gate stopped: net ${display(route.netRaw, 9)} SUI is below floor ${minProfitText} SUI`);
  if (balance < reserveRaw + amountRaw) throw new Error(`SUI reserve gate stopped: balance ${display(balance, 9)} SUI; need ${display(reserveRaw + amountRaw, 9)} SUI`);
  const signer = signerForWallet();
  if (!signer) throw new Error(`no local Ed25519 signer for ${OPS_WALLET}`);
  const tx = buildAtomicTransaction(route);
  const result = await client.signAndExecuteTransaction({ signer, transaction: tx, include: { effects: true, events: true, balanceChanges: true } });
  const executed = result.Transaction ?? result.FailedTransaction ?? result;
  return { digest: executed.digest, status: executed.effects?.status, balanceChanges: executed.balanceChanges ?? [], events: executed.events ?? [] };
}

async function main() {
  const balance = totalBalance(await client.getBalance({ owner: OPS_WALLET, coinType: SUI_TYPE }));
  if (balance < reserveRaw + amountRaw) throw new Error(`SUI reserve gate stopped: balance ${display(balance, 9)} SUI; need ${display(reserveRaw + amountRaw, 9)} SUI`);
  const { deep, coins } = await resolveCoins();
  const sui = { symbol: "SUI", decimals: 9, type: SUI_TYPE };
  if (!coins.some((x) => typeEquals(x.type, deep.type))) coins.unshift(deep);
  const coinMap = [sui, ...coins];
  const routes = [];
  const twoHop = await quotePath(coinMap, [sui, deep, sui]);
  if (twoHop) routes.push(twoHop);
  if (maxHops >= 3) {
    for (const middle of coins) {
      if (typeEquals(middle.type, deep.type) || typeEquals(middle.type, SUI_TYPE)) continue;
      try {
        const route = await quotePath(coinMap, [sui, deep, middle, sui]);
        if (route) routes.push(route);
      } catch (error) { console.warn(`route ${middle.symbol}: ${error.message}`); }
    }
  }
  routes.sort((a, b) => a.netRaw > b.netRaw ? -1 : a.netRaw < b.netRaw ? 1 : 0);
  const output = {
    network: "mainnet", wallet: OPS_WALLET, mode: execute ? "execute-requested" : "dry-run",
    inputSui: amountSuiText, reserveSui: reserveSuiText, availableSui: display(balance, 9),
    minProfitSui: minProfitText, gasEstimateSui: gasSuiText, slippageBps, maxHops,
    candidateSymbols: coins.map((x) => x.symbol), routeCount: routes.length,
    routes: routes.map(routeSummary),
    best: routes[0] ? routeSummary(routes[0]) : null,
    note: routes.length ? "Quotes are point-in-time Cetus estimates; conservative output applies slippage again before the profit gate." : "No complete SUI -> DEEP -> ... -> SUI Cetus paths were available.",
  };
  console.log(JSON.stringify(output, null, 2));
  if (execute) {
    if (!routes[0]) throw new Error("execution gate stopped: no complete route");
    if (routes[0].netRaw < minProfitRaw) throw new Error(`execution gate stopped: best net ${display(routes[0].netRaw, 9)} SUI is below floor ${minProfitText} SUI`);
    const result = await executeRoute(routes[0], balance);
    console.log(JSON.stringify({ execution: result }, null, 2));
    if (result.status?.status && result.status.status !== "success") process.exitCode = 1;
  }
}

main().catch((error) => { console.error(`fatal: ${error.message}`); process.exitCode = 1; });
