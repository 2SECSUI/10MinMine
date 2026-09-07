#!/usr/bin/env node
/** FlowX CLMM pool creator. Dry-run by default; --execute broadcasts. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { SuiClient } from "@mysten/sui/client";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import BN from "bn.js";
import { ClmmPool, ClmmPoolManager, ClmmPosition, ClmmPositionManager, ClmmTickMath, Coin, Percent } from "@flowx-finance/sdk";

const OPS_WALLET = "0x58189b677894e0fe7ad38e0e516408a3500da57d86fc0436373bc1d9c6334d0a";
const SUI_TYPE = "0x2::sui::SUI";
const TENMM_TYPE = "0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98::tenmm::TENMM";
const NETWORK = "mainnet";
const GAS_BUDGET = 500_000_000n;
const TICK_SPACING = 60;
const FLOWX_FEE = 3000;

const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const has = (name) => process.argv.includes(name);
function die(message) { console.error(`error: ${message}`); process.exit(2); }
function display(raw, decimals) {
  const n = BigInt(raw); const base = 10n ** BigInt(decimals);
  const f = (n % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return f ? `${n / base}.${f}` : `${n / base}`;
}
function parseDecimal(value, decimals, label) {
  if (!/^\d+(?:\.\d+)?$/.test(value ?? "")) die(`${label} must be a non-negative decimal`);
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) die(`${label} has more than ${decimals} decimals`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
}
function parseFraction(value, label) {
  if (!/^\d+(?:\.\d+)?$/.test(value ?? "")) die(`${label} must be a positive decimal`);
  const [whole, fraction = ""] = value.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole) * denominator + BigInt(fraction || "0");
  if (numerator <= 0n) die(`${label} must be greater than zero`);
  return { numerator, denominator };
}
function integerSqrt(n) {
  if (n < 2n) return n;
  let x0 = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  let x1 = (x0 + n / x0) >> 1n;
  while (x1 < x0) { x0 = x1; x1 = (x0 + n / x0) >> 1n; }
  return x0;
}
function sqrtRatioX64(priceSuiPerTenmm) {
  const { numerator, denominator } = parseFraction(priceSuiPerTenmm, "price-sui-per-10mm");
  return integerSqrt(((10n ** 8n * denominator) << 128n) / (10n ** 9n * numerator));
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
function totalBalance(balance) { return BigInt(balance?.totalBalance ?? balance?.balance?.balance ?? balance?.balance?.addressBalance ?? 0); }
function extractTx(result) { return result.Transaction ?? result.FailedTransaction ?? result; }
function writeArtifact(details, bytes) {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), `flowx_create_pool_${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...details, txBytesBase64: Buffer.from(bytes).toString("base64") }, null, 2) + "\n");
  return file;
}

const priceText = arg("--price-sui-per-10mm") ?? "0.04080";
const quoteText = arg("--sui-amount") ?? "1";
const reserveText = arg("--reserve-sui") ?? "0.75";
const quoteAmountRaw = parseDecimal(quoteText, 9, "sui-amount");
const reserveRaw = parseDecimal(reserveText, 9, "reserve-sui");
if (quoteAmountRaw <= 0n) die("sui-amount must be greater than zero");
const price = parseFraction(priceText, "price-sui-per-10mm");
const tenmmRaw = (10n ** 8n * price.denominator) / price.numerator;
if (tenmmRaw <= 0n) die("price produces zero TENMM amount");
const sqrtPrice = sqrtRatioX64(priceText);
const tickCurrent = ClmmTickMath.sqrtPriceX64ToTickIndex(new BN(sqrtPrice.toString()));
const tickLower = Math.ceil(ClmmTickMath.MIN_TICK / TICK_SPACING) * TICK_SPACING;
const tickUpper = Math.floor(ClmmTickMath.MAX_TICK / TICK_SPACING) * TICK_SPACING;

const sdkClient = new SuiClient({ url: "https://fullnode.mainnet.sui.io:443" });
const client = new SuiGrpcClient({ network: NETWORK, baseUrl: "https://fullnode.mainnet.sui.io:443" });
const poolManager = new ClmmPoolManager(NETWORK).suiClient(sdkClient);
const positionManager = new ClmmPositionManager(NETWORK, poolManager).suiClient(sdkClient);
const pool = new ClmmPool("", [new Coin(SUI_TYPE), new Coin(TENMM_TYPE)], [], [0, 0], FLOWX_FEE, sqrtPrice.toString(), tickCurrent, 0, 0, 0);

const [suiBalance, tenmmBalance, suiMetadata, tenmmMetadata] = await Promise.all([
  client.getBalance({ owner: OPS_WALLET, coinType: SUI_TYPE }),
  client.getBalance({ owner: OPS_WALLET, coinType: TENMM_TYPE }),
  sdkClient.getCoinMetadata({ coinType: SUI_TYPE }),
  sdkClient.getCoinMetadata({ coinType: TENMM_TYPE }),
]);
const walletSui = totalBalance(suiBalance);
const walletTenmm = totalBalance(tenmmBalance);
if (!suiMetadata?.id || !tenmmMetadata?.id) die("could not resolve SUI/TENMM coin metadata");
if (walletSui < reserveRaw + quoteAmountRaw + GAS_BUDGET) die(`SUI guard stopped: ${display(walletSui, 9)} SUI; need ${display(reserveRaw + quoteAmountRaw + GAS_BUDGET, 9)}`);
if (has("--execute") && walletTenmm < tenmmRaw) die(`TENMM guard stopped: wallet has ${display(walletTenmm, 8)}, need ${display(tenmmRaw, 8)}`);
const details = {
  network: NETWORK, dex: "FlowX", pair: "10MM/SUI", wallet: OPS_WALLET,
  mode: has("--execute") ? "execute-pending" : "dry-run",
  flowxPackage: "0xde2c47eb0da8c74e4d0f6a220c41619681221b9c2590518095f0f0c2d3f3c772",
  poolRegistry: "0x27565d24a4cd51127ac90e4074a841bbe356cca7bf5759ddc14a975be1632abc",
  positionRegistry: "0x7dffe3229d675645564273aa68c67406b6a80aa29e245ac78283acd7ed5e4912",
  fee: FLOWX_FEE, tickSpacing: TICK_SPACING, tickLower, tickUpper, tickCurrent,
  priceSuiPer10mm: priceText, sqrtPriceX64: sqrtPrice.toString(),
  suiAmount: display(quoteAmountRaw, 9), suiAmountRaw: quoteAmountRaw.toString(),
  tenmmAmount: display(tenmmRaw, 8), tenmmAmountRaw: tenmmRaw.toString(),
  walletSui: display(walletSui, 9), walletTenmm: display(walletTenmm, 8),
  reserveSui: display(reserveRaw, 9), gasBudget: display(GAS_BUDGET, 9),
};
if (has("--plan-only")) { console.log(JSON.stringify({ ...details, mode: "plan-only" }, null, 2)); process.exit(0); }

const position = ClmmPosition.fromAmounts({ owner: OPS_WALLET, pool, tickLower, tickUpper, amountX: quoteAmountRaw.toString(), amountY: tenmmRaw.toString(), useFullPrecision: true });
const mint = position.mintAmounts;
details.mintSuiRaw = mint.amountX.toString(); details.mintTenmmRaw = mint.amountY.toString();
details.mintSui = display(mint.amountX, 9); details.mintTenmm = display(mint.amountY, 8);
if (mint.amountX <= 0 || mint.amountY <= 0) die("calculated position has a zero-side mint amount");
if (has("--execute") && walletSui < reserveRaw + mint.amountX + GAS_BUDGET) die("SUI guard stopped after position calculation");
if (has("--execute") && walletTenmm < mint.amountY) die(`TENMM guard stopped after position calculation: need ${display(mint.amountY, 8)}`);

const tx = new Transaction();
tx.setSender(OPS_WALLET); tx.setGasBudget(Number(GAS_BUDGET));
poolManager.tx(tx); await poolManager.createPoolV2(pool);
positionManager.tx(tx);
const positionResult = positionManager.increaseLiquidity(position, { slippageTolerance: new Percent(1, 100), deadline: Date.now() + 3600 * 1000, createPosition: true });
if (!positionResult) die("FlowX SDK did not return a created position");
tx.transferObjects([positionResult], OPS_WALLET);

if (!has("--execute")) {
  const bytes = await tx.build({ client });
  details.artifact = writeArtifact(details, bytes);
  console.log(JSON.stringify(details, null, 2));
  process.exit(0);
}
const signer = signerForWallet();
if (!signer) die(`no local Ed25519 signer for ${OPS_WALLET}`);
const result = await client.signAndExecuteTransaction({ signer, transaction: tx, include: { effects: true, events: true, balanceChanges: true, transaction: true } });
const executed = extractTx(result); const status = executed.effects?.status;
console.log(JSON.stringify({ ...details, mode: "executed", digest: executed.digest, status, created: executed.effects?.created ?? [], events: executed.events ?? [], balanceChanges: executed.balanceChanges ?? [], error: result.FailedTransaction?.error ?? null }, null, 2));
if (status?.status && status.status !== "success") process.exit(1);
