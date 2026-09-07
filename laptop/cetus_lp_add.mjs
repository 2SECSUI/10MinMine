#!/usr/bin/env node
/**
 * Safely add liquidity to one existing 10MinMine Cetus position.
 *
 * The amount is derived from the live DexScreener TENMM/SUI price and a
 * bounded SUI budget. It never spends more than the requested budget and
 * leaves the configured SUI reserve untouched. Existing positions only;
 * this script never opens a new position.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { CetusClmmSDK } from "@cetusprotocol/sui-clmm-sdk";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const OPS_WALLET = "0x58189b677894e0fe7ad38e0e516408a3500da57d86fc0436373bc1d9c6334d0a";
const TENMM_TYPE = "0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98::tenmm::TENMM";
const MAIN_POOL_ID = "0xdee1982f5a75e5dace09b2f4dac1ed473cbbbd0ca34ad06a9876abffac7e2bb2";
const MAIN_POSITION_ID = "0x64477aaf7c88421b161315957ec71484174840d075742c979e85dd5fb05d43be";
const SECOND_POSITION_ID = "0x885c09217753a405d987d0604ba4c78f4c34510576a478f803bf4ace91a10546";
const DECIMALS = 8;
const SUI_DECIMALS = 9;
const Q64 = 2 ** 64;
const MAIN_SUI_MAX_BUFFER_BPS = 200n;
const SUI_TYPE = "0x2::sui::SUI";

function die(message) {
  console.error(`error: ${message}`);
  console.error("usage: node cetus_lp_add.mjs --mode main|second [--sui-budget 1] [--reserve-sui 4] [--execute|--plan-only]");
  process.exit(2);
}
function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
function parseRaw(value, decimals, label) {
  if (!/^\d+(?:\.\d+)?$/.test(value ?? "")) die(`${label} must be a non-negative decimal`);
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) die(`${label} has too many decimal places (maximum ${decimals})`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
}
function parseAmount(value) {
  const raw = parseRaw(value, DECIMALS, "amount10mm");
  if (raw <= 0n) die("amount10mm must be greater than zero");
  return { display: value, raw };
}
function decimal(raw, decimals) {
  const value = BigInt(raw);
  const whole = value / 10n ** BigInt(decimals);
  const fraction = (value % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}
function loadKeystoreEntries() {
  const configDir = process.env.SUI_CONFIG_DIR || path.join(os.homedir(), ".sui", "sui_config");
  const file = path.join(configDir, "sui.keystore");
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(parsed) ? parsed : (parsed?.keys ?? []);
}
function keypairFromEntry(entry) {
  if (typeof entry !== "string") return null;
  if (entry.startsWith("suiprivkey")) {
    const decoded = decodeSuiPrivateKey(entry);
    return decoded.schema === "ED25519" ? Ed25519Keypair.fromSecretKey(decoded.secretKey) : null;
  }
  const bytes = Uint8Array.from(Buffer.from(entry, "base64"));
  return bytes.length === 33 && bytes[0] === 0 ? Ed25519Keypair.fromSecretKey(bytes.slice(1)) : null;
}
function findLocalSigner() {
  for (const entry of loadKeystoreEntries()) {
    try {
      const keypair = keypairFromEntry(entry);
      if (keypair?.getPublicKey().toSuiAddress().toLowerCase() === OPS_WALLET.toLowerCase()) return keypair;
    } catch {
      // Ignore unrelated or unsupported keystore entries.
    }
  }
  return null;
}
function writeUnsignedArtifact(bytes, details) {
  const filename = `cetus_lp_add_${details.mode}_${Date.now()}.json`;
  const output = path.join(path.dirname(fileURLToPath(import.meta.url)), filename);
  fs.writeFileSync(output, JSON.stringify({ network: "mainnet", ...details, sender: OPS_WALLET, txBytesBase64: Buffer.from(bytes).toString("base64") }, null, 2) + "\n");
  return output;
}
function rawSqrtPrice(pool) {
  const value = Number(pool.current_sqrt_price);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid pool sqrt price: ${pool.current_sqrt_price}`);
  return value;
}
function matchingSuiRaw(pool, tenmmRaw) {
  const priceBPerA = (rawSqrtPrice(pool) / Q64) ** 2;
  if (!Number.isFinite(priceBPerA) || priceBPerA <= 0) throw new Error("could not quote SUI/TENMM price from Cetus pool");
  const tenmmIsA = pool.coin_type_a.toLowerCase() === TENMM_TYPE.toLowerCase();
  const tenmmIsB = pool.coin_type_b.toLowerCase() === TENMM_TYPE.toLowerCase();
  if (!tenmmIsA && !tenmmIsB) throw new Error(`position pool does not contain TENMM: ${pool.coin_type_a}, ${pool.coin_type_b}`);
  const suiRawFloat = tenmmIsA ? Number(tenmmRaw) * priceBPerA : Number(tenmmRaw) / priceBPerA;
  if (!Number.isFinite(suiRawFloat) || suiRawFloat <= 0) throw new Error("could not calculate matching SUI amount");
  return (BigInt(Math.ceil(suiRawFloat)) * (10_000n + MAIN_SUI_MAX_BUFFER_BPS) + 9_999n) / 10_000n;
}
async function liveTenmmSuiPrice(poolId) {
  const url = `https://api.dexscreener.com/latest/dex/pairs/sui/${poolId}`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`DexScreener request failed (${response.status})`);
  const payload = await response.json();
  const pair = payload.pair ?? payload.pairs?.find((candidate) => candidate.pairAddress?.toLowerCase() === poolId.toLowerCase()) ?? payload.pairs?.[0];
  if (!pair?.priceNative) throw new Error("DexScreener returned no native pair price");
  const tenmmAddress = TENMM_TYPE.toLowerCase();
  const base = String(pair.baseToken?.address ?? "").toLowerCase();
  const quote = String(pair.quoteToken?.address ?? "").toLowerCase();
  const native = Number(pair.priceNative);
  if (!Number.isFinite(native) || native <= 0) throw new Error(`invalid DexScreener native price: ${pair.priceNative}`);
  const priceSuiPerTenmm = base === tenmmAddress ? native : quote === tenmmAddress ? 1 / native : NaN;
  if (!Number.isFinite(priceSuiPerTenmm) || priceSuiPerTenmm <= 0) throw new Error("DexScreener pair is not TENMM/SUI");
  return { priceSuiPerTenmm, url, pairAddress: pair.pairAddress, baseToken: pair.baseToken?.symbol, quoteToken: pair.quoteToken?.symbol };
}
function tenmmFromSuiBudget(suiRaw, priceSuiPerTenmm) {
  const tokens = Number(suiRaw) / 10 ** SUI_DECIMALS / priceSuiPerTenmm;
  const raw = BigInt(Math.floor(tokens * 10 ** DECIMALS));
  if (raw <= 0n) throw new Error("SUI budget is too small to buy one TENMM base unit at the live price");
  return raw;
}

const mode = arg("--mode");
if (mode !== "main" && mode !== "second") die("--mode must be main or second");
const execute = process.argv.includes("--execute");
const planOnly = process.argv.includes("--plan-only");
if (execute && planOnly) die("choose only one of --execute or --plan-only");
const reserveRaw = parseRaw(arg("--reserve-sui") ?? "0.75", SUI_DECIMALS, "reserve-sui");
const budgetRaw = parseRaw(arg("--sui-budget") ?? "1", SUI_DECIMALS, "sui-budget");
if (budgetRaw <= 0n) die("sui-budget must be greater than zero");
const requestedAmount = arg("--amount10mm") ? parseAmount(arg("--amount10mm")) : null;
const positionId = mode === "main" ? MAIN_POSITION_ID : SECOND_POSITION_ID;
const client = new SuiGrpcClient({ network: "mainnet", baseUrl: "https://fullnode.mainnet.sui.io:443" });
const sdk = CetusClmmSDK.createSDK({ env: "mainnet" });
const balance = await client.getBalance({ owner: OPS_WALLET, coinType: SUI_TYPE });
const tenmmBalance = await client.getBalance({ owner: OPS_WALLET, coinType: TENMM_TYPE });
const availableSuiRaw = BigInt(balance.totalBalance ?? balance.balance?.balance ?? balance.balance?.addressBalance ?? 0);
const availableTenmmRaw = BigInt(tenmmBalance.totalBalance ?? tenmmBalance.balance?.balance ?? tenmmBalance.balance?.addressBalance ?? 0);
const spendableRaw = availableSuiRaw > reserveRaw ? availableSuiRaw - reserveRaw : 0n;
const spendCapRaw = spendableRaw < budgetRaw ? spendableRaw : budgetRaw;
if (spendCapRaw <= 0n) throw new Error(`SUI guard stopped: balance ${decimal(availableSuiRaw, SUI_DECIMALS)} SUI would breach reserve ${decimal(reserveRaw, SUI_DECIMALS)} SUI`);

const position = await sdk.Position.getPositionById(positionId, false);
const pool = await sdk.Pool.getPool(position.pool, false);
if (mode === "main" && (position.pool.toLowerCase() !== MAIN_POOL_ID.toLowerCase() || pool.id.toLowerCase() !== MAIN_POOL_ID.toLowerCase())) {
  throw new Error(`main position is not in expected Cetus pool ${MAIN_POOL_ID}`);
}
if (position.owner.toLowerCase() !== OPS_WALLET.toLowerCase()) throw new Error(`position ${positionId} is owned by ${position.owner}, not ops wallet ${OPS_WALLET}`);
const tenmmIsA = pool.coin_type_a.toLowerCase() === TENMM_TYPE.toLowerCase();
const tenmmIsB = pool.coin_type_b.toLowerCase() === TENMM_TYPE.toLowerCase();
if (!tenmmIsA && !tenmmIsB) throw new Error(`position pool does not contain TENMM: ${pool.coin_type_a}, ${pool.coin_type_b}`);
const live = await liveTenmmSuiPrice(pool.id);
const currentTick = Number(pool.current_tick_index);
const needsMatchingSui = mode === "main" || (currentTick >= Number(position.tick_lower_index) && currentTick <= Number(position.tick_upper_index));
let tenmmRaw = requestedAmount?.raw ?? tenmmFromSuiBudget(spendCapRaw, live.priceSuiPerTenmm);
const priceSizedRaw = tenmmFromSuiBudget(spendCapRaw, live.priceSuiPerTenmm);
if (tenmmRaw > priceSizedRaw) throw new Error(`requested ${decimal(tenmmRaw, DECIMALS)} TENMM exceeds live-price SUI budget; maximum is ${decimal(priceSizedRaw, DECIMALS)} TENMM`);
let suiRaw = needsMatchingSui ? matchingSuiRaw(pool, tenmmRaw) : 0n;
// The pool quote is authoritative for the transaction max input. Reduce the
// live-price amount if the pool has moved so the hard SUI cap still holds.
for (let i = 0; i < 3 && suiRaw > spendCapRaw; i++) {
  tenmmRaw = (tenmmRaw * spendCapRaw) / suiRaw;
  if (tenmmRaw <= 0n) throw new Error("SUI cap leaves no positive TENMM amount");
  suiRaw = needsMatchingSui ? matchingSuiRaw(pool, tenmmRaw) : 0n;
}
if (suiRaw > spendCapRaw) throw new Error(`Cetus quote ${decimal(suiRaw, SUI_DECIMALS)} SUI exceeds hard cap ${decimal(spendCapRaw, SUI_DECIMALS)} SUI`);
if (availableTenmmRaw < tenmmRaw) throw new Error(`TENMM guard stopped: wallet has ${decimal(availableTenmmRaw, DECIMALS)} but plan needs ${decimal(tenmmRaw, DECIMALS)}`);
const amount = { display: decimal(tenmmRaw, DECIMALS), raw: tenmmRaw };
const amountA = tenmmIsA ? amount.raw : suiRaw;
const amountB = tenmmIsB ? amount.raw : suiRaw;
const fixAmountA = tenmmIsA;
const details = {
  network: "mainnet",
  mode,
  positionId,
  poolId: pool.id,
  amount10mm: amount.display,
  tenmmAmountRaw: amount.raw.toString(),
  livePriceSuiPer10mm: live.priceSuiPerTenmm,
  priceSource: live.url,
  availableSui: decimal(availableSuiRaw, SUI_DECIMALS),
  availableTenmm: decimal(availableTenmmRaw, DECIMALS),
  reserveSui: decimal(reserveRaw, SUI_DECIMALS),
  suiBudget: decimal(budgetRaw, SUI_DECIMALS),
  suiSpendCap: decimal(spendCapRaw, SUI_DECIMALS),
  suiAmountMax: decimal(suiRaw, SUI_DECIMALS),
  suiAmountMaxRaw: suiRaw.toString(),
  coinTypeA: pool.coin_type_a,
  coinTypeB: pool.coin_type_b,
  fixAmountA,
  note: mode === "main" ? "existing main Cetus LP; TENMM fixed with live-price-sized SUI max input" : (needsMatchingSui ? "existing second Cetus LP; in-range add with live-price-sized SUI max input" : "existing second Cetus LP; out-of-range TENMM-only add"),
};
if (planOnly) {
  console.log(JSON.stringify({ ...details, mode: "plan-only", note: `${details.note}; no transaction built or submitted` }, null, 2));
  process.exit(0);
}
const tx = await sdk.Position.createAddLiquidityFixTokenPayload({
  amount_a: amountA.toString(), amount_b: amountB.toString(), slippage: 0, fix_amount_a: fixAmountA,
  is_open: false, tick_lower: position.tick_lower_index, tick_upper: position.tick_upper_index,
  collect_fee: false, rewarder_coin_types: [], coin_type_a: pool.coin_type_a,
  coin_type_b: pool.coin_type_b, pool_id: pool.id, pos_id: positionId,
});
tx.setSender(OPS_WALLET);
if (!execute) {
  const bytes = await tx.build({ client });
  const artifact = writeUnsignedArtifact(bytes, details);
  console.log(JSON.stringify({ ...details, mode: "dry-run", artifact }, null, 2));
  process.exit(0);
}
const signer = findLocalSigner();
if (!signer) {
  const bytes = await tx.build({ client });
  const artifact = writeUnsignedArtifact(bytes, details);
  console.error(`No Ed25519 keystore key for ${OPS_WALLET}; unsigned PTB written to ${artifact}`);
  process.exit(3);
}
const result = await client.signAndExecuteTransaction({ signer, transaction: tx, include: { effects: true, balanceChanges: true } });
const executed = result.Transaction ?? result.FailedTransaction ?? result;
const status = executed.effects?.status;
console.log(JSON.stringify({ ...details, mode: "executed", digest: executed.digest, status }, null, 2));
if (status?.status && status.status !== "success") process.exit(1);
