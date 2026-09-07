#!/usr/bin/env node
/**
 * Increase one of the existing 10MinMine Cetus positions.
 *
 * Usage:
 *   node cetus_lp_add.mjs --mode main|second --amount10mm 0.46666667 [--execute]
 *
 * The transaction is deliberately built against the existing position. It
 * never opens a new position. `main` fixes TENMM and supplies matching SUI;
 * `second` fixes TENMM and sends zero SUI.
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
const Q64 = 2 ** 64;
const MAIN_SUI_MAX_BUFFER_BPS = 200n;

function die(message) {
  console.error(`error: ${message}`);
  console.error("usage: node cetus_lp_add.mjs --mode main|second --amount10mm 0.46666667 [--execute]");
  process.exit(2);
}
function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
function parseAmount(value) {
  if (!/^\d+(?:\.\d{1,8})?$/.test(value ?? "")) die("amount10mm must be a positive decimal with at most 8 fractional digits");
  const [whole, fraction = ""] = value.split(".");
  const raw = BigInt(whole) * 10n ** BigInt(DECIMALS) + BigInt((fraction + "0".repeat(DECIMALS)).slice(0, DECIMALS));
  if (raw <= 0n) die("amount10mm must be greater than zero");
  return { display: value, raw };
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
  fs.writeFileSync(output, JSON.stringify({
    network: "mainnet",
    ...details,
    sender: OPS_WALLET,
    txBytesBase64: Buffer.from(bytes).toString("base64"),
  }, null, 2) + "\n");
  return output;
}
function rawSqrtPrice(pool) {
  const value = Number(pool.current_sqrt_price);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid pool sqrt price: ${pool.current_sqrt_price}`);
  return value;
}
function matchingSuiRaw(pool, tenmmRaw) {
  const priceBPerA = (rawSqrtPrice(pool) / Q64) ** 2;
  if (!Number.isFinite(priceBPerA) || priceBPerA <= 0) throw new Error("could not quote SUI/TENMM price");
  const tenmmIsA = pool.coin_type_a.toLowerCase() === TENMM_TYPE.toLowerCase();
  const tenmmIsB = pool.coin_type_b.toLowerCase() === TENMM_TYPE.toLowerCase();
  if (!tenmmIsA && !tenmmIsB) throw new Error(`position pool does not contain TENMM: ${pool.coin_type_a}, ${pool.coin_type_b}`);
  const suiRawFloat = tenmmIsA ? Number(tenmmRaw) * priceBPerA : Number(tenmmRaw) / priceBPerA;
  if (!Number.isFinite(suiRawFloat) || suiRawFloat <= 0) throw new Error("could not calculate matching SUI amount");
  // SUI is a max input for fixed TENMM; the buffer covers a small quote move.
  return (BigInt(Math.ceil(suiRawFloat)) * (10_000n + MAIN_SUI_MAX_BUFFER_BPS) + 9_999n) / 10_000n;
}

const mode = arg("--mode");
if (mode !== "main" && mode !== "second") die("--mode must be main or second");
const amount = parseAmount(arg("--amount10mm"));
const execute = process.argv.includes("--execute");
const positionId = mode === "main" ? MAIN_POSITION_ID : SECOND_POSITION_ID;
const client = new SuiGrpcClient({ network: "mainnet", baseUrl: "https://fullnode.mainnet.sui.io:443" });
const sdk = CetusClmmSDK.createSDK({ env: "mainnet" });
const position = await sdk.Position.getPositionById(positionId, false);
const pool = await sdk.Pool.getPool(position.pool, false);

if (mode === "main" && (position.pool.toLowerCase() !== MAIN_POOL_ID.toLowerCase() || pool.id.toLowerCase() !== MAIN_POOL_ID.toLowerCase())) {
  throw new Error(`main position is not in expected Cetus pool ${MAIN_POOL_ID}`);
}
if (position.owner.toLowerCase() !== OPS_WALLET.toLowerCase()) {
  throw new Error(`position ${positionId} is owned by ${position.owner}, not ops wallet ${OPS_WALLET}`);
}
const tenmmIsA = pool.coin_type_a.toLowerCase() === TENMM_TYPE.toLowerCase();
const tenmmIsB = pool.coin_type_b.toLowerCase() === TENMM_TYPE.toLowerCase();
if (!tenmmIsA && !tenmmIsB) throw new Error(`position pool does not contain TENMM: ${pool.coin_type_a}, ${pool.coin_type_b}`);
const suiRaw = mode === "main" ? matchingSuiRaw(pool, amount.raw) : 0n;
const amountA = tenmmIsA ? amount.raw : suiRaw;
const amountB = tenmmIsB ? amount.raw : suiRaw;
const fixAmountA = tenmmIsA;

const tx = await sdk.Position.createAddLiquidityFixTokenPayload({
  amount_a: amountA.toString(),
  amount_b: amountB.toString(),
  slippage: 0,
  fix_amount_a: fixAmountA,
  is_open: false,
  tick_lower: position.tick_lower_index,
  tick_upper: position.tick_upper_index,
  collect_fee: false,
  rewarder_coin_types: [],
  coin_type_a: pool.coin_type_a,
  coin_type_b: pool.coin_type_b,
  pool_id: pool.id,
  pos_id: positionId,
});
tx.setSender(OPS_WALLET);

const details = {
  mode,
  positionId,
  poolId: pool.id,
  amount10mm: amount.display,
  tenmmAmountRaw: amount.raw.toString(),
  suiAmountMaxRaw: suiRaw.toString(),
  coinTypeA: pool.coin_type_a,
  coinTypeB: pool.coin_type_b,
  fixAmountA,
  note: mode === "main" ? "existing main Cetus LP; TENMM fixed with matching SUI max input" : "existing second Cetus LP; TENMM-only fallback (zero SUI when position is out of range)",
};

if (process.argv.includes("--plan-only")) {
  console.log(JSON.stringify({ ...details, mode: "plan-only", note: "Read-only LP plan; no PTB build because claimed TENMM is not yet in the wallet." }, null, 2));
  process.exit(0);
}

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
const result = await client.signAndExecuteTransaction({
  signer,
  transaction: tx,
  include: { effects: true, balanceChanges: true },
});
const executed = result.Transaction ?? result.FailedTransaction ?? result;
const status = executed.effects?.status;
console.log(JSON.stringify({ ...details, mode: "executed", digest: executed.digest, status }, null, 2));
if (status?.status && status.status !== "success") process.exit(1);
