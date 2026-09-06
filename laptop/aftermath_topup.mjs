#!/usr/bin/env node
/**
 * Top up the 10MinMine Aftermath farm with TENMM.
 *
 * Usage:
 *   node aftermath_topup.mjs <amount10mm> [--execute]
 *
 * Without --execute this builds the SDK PTB and writes its BCS bytes to a
 * JSON artifact. With --execute it signs and waits for execution using the
 * matching local Sui keystore key.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Aftermath } from "aftermath-ts-sdk";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const FARM_ID = "0x89a692f70e2b831d1d6a1ec299f571ba2032c94df4fe8ed8dde2ef9b711df035";
const OWNER_CAP_ID = "0x8ceefc5fa687c014bd51273710e2e5ec96e6dd4ad36bc7d43bf866a36ae7c76e";
const OPS_WALLET = "0x58189b677894e0fe7ad38e0e516408a3500da57d86fc0436373bc1d9c6334d0a";
const TENMM_TYPE = "0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98::tenmm::TENMM";
const DECIMALS = 8;

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error("usage: node aftermath_topup.mjs <amount10mm> [--execute]");
  process.exit(2);
}

function parseAmount(value) {
  if (!/^\d+(?:\.\d{1,8})?$/.test(value ?? "")) {
    usage("amount10mm must be a positive decimal with at most 8 fractional digits");
  }
  const [whole, fraction = ""] = value.split(".");
  const raw = BigInt(whole) * 10n ** BigInt(DECIMALS) + BigInt((fraction + "0".repeat(DECIMALS)).slice(0, DECIMALS));
  if (raw <= 0n) usage("amount10mm must be greater than zero");
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
    if (decoded.schema === "ED25519") return Ed25519Keypair.fromSecretKey(decoded.secretKey);
    return null;
  }
  // Legacy Sui keystores store flag || secret-key as base64. Only use the
  // Ed25519 key here; other schemes can still use the serialized PTB path.
  const bytes = Uint8Array.from(Buffer.from(entry, "base64"));
  if (bytes.length === 33 && bytes[0] === 0) return Ed25519Keypair.fromSecretKey(bytes.slice(1));
  return null;
}

function findLocalSigner() {
  for (const entry of loadKeystoreEntries()) {
    try {
      const keypair = keypairFromEntry(entry);
      if (keypair && keypair.getPublicKey().toSuiAddress().toLowerCase() === OPS_WALLET.toLowerCase()) return keypair;
    } catch {
      // Ignore unrelated or unsupported keystore entries.
    }
  }
  return null;
}

function writeUnsignedArtifact(bytes, amount) {
  const filename = `aftermath_topup_${Date.now()}.json`;
  const output = path.join(path.dirname(fileURLToPath(import.meta.url)), filename);
  fs.writeFileSync(output, JSON.stringify({
    network: "mainnet",
    farmId: FARM_ID,
    ownerCapId: OWNER_CAP_ID,
    sender: OPS_WALLET,
    rewardCoinType: TENMM_TYPE,
    amount10mm: amount.display,
    rewardAmountRaw: amount.raw.toString(),
    txBytesBase64: Buffer.from(bytes).toString("base64"),
  }, null, 2) + "\n");
  return output;
}

const amount = parseAmount(process.argv[2]);
const execute = process.argv.includes("--execute");
const client = new SuiGrpcClient({ network: "mainnet", baseUrl: "https://fullnode.mainnet.sui.io:443" });
const sdk = await Aftermath.create({ network: "MAINNET" });
const farms = sdk.Farms();
const pool = await farms.getStakingPool({ objectId: FARM_ID });
const tx = await pool.getTopUpRewardsTransaction({
  ownerCapId: OWNER_CAP_ID,
  walletAddress: OPS_WALLET,
  rewards: [{ rewardAmount: amount.raw, rewardCoinType: TENMM_TYPE }],
});
tx.setSender(OPS_WALLET);

if (!execute) {
  const bytes = await tx.build({ client });
  const artifact = writeUnsignedArtifact(bytes, amount);
  console.log(JSON.stringify({
    mode: "dry-run",
    farmId: FARM_ID,
    amount10mm: amount.display,
    rewardAmountRaw: amount.raw.toString(),
    artifact,
    note: "Unsigned transaction bytes were written; rerun with --execute after configuring the local Sui keystore.",
  }, null, 2));
  process.exit(0);
}

const signer = findLocalSigner();
if (!signer) {
  const bytes = await tx.build({ client });
  const artifact = writeUnsignedArtifact(bytes, amount);
  console.error(`No Ed25519 keystore key for ${OPS_WALLET}; unsigned PTB written to ${artifact}`);
  process.exit(3);
}

const result = await client.signAndExecuteTransaction({
  signer,
  transaction: tx,
  include: { effects: true, balanceChanges: true },
  // gRPC waits for committed execution before returning.
});
const executed = result.Transaction ?? result.FailedTransaction ?? result;
console.log(JSON.stringify({
  mode: "executed",
  digest: executed.digest,
  status: executed.effects?.status,
  amount10mm: amount.display,
  rewardAmountRaw: amount.raw.toString(),
  farmId: FARM_ID,
}, null, 2));
