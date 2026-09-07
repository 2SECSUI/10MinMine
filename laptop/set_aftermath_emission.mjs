#!/usr/bin/env node
/**
 * Increase the 10MinMine Aftermath farm TENMM emission rate.
 *
 * Usage:
 *   node set_aftermath_emission.mjs [--execute]
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

const FARM_ID = "0x4312dd6776ffbc77801d0b85821f9d129eb6e0af0648ab7beea591f708f74ff7";
const OWNER_CAP_ID = "0x6b61c57c69dd56a419be9b384e1422a2056628dba993e576a2a42776335f92ed";
const OPS_WALLET = "0x58189b677894e0fe7ad38e0e516408a3500da57d86fc0436373bc1d9c6334d0a";
const TENMM_TYPE = "0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98::tenmm::TENMM";
const EMISSION_SCHEDULE_MS = 600000;
const EMISSION_RATE = 4570000000n;

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error("usage: node set_aftermath_emission.mjs [--execute]");
  process.exit(2);
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

function writeUnsignedArtifact(bytes) {
  const filename = `set_aftermath_emission_${Date.now()}.json`;
  const output = path.join(path.dirname(fileURLToPath(import.meta.url)), filename);
  fs.writeFileSync(output, JSON.stringify({
    network: "mainnet",
    farmId: FARM_ID,
    ownerCapId: OWNER_CAP_ID,
    sender: OPS_WALLET,
    rewardCoinType: TENMM_TYPE,
    emissionScheduleMs: EMISSION_SCHEDULE_MS,
    emissionRate: EMISSION_RATE.toString(),
    txBytesBase64: Buffer.from(bytes).toString("base64"),
  }, null, 2) + "\n");
  return output;
}

const execute = process.argv.includes("--execute");
const client = new SuiGrpcClient({ network: "mainnet", baseUrl: "https://fullnode.mainnet.sui.io:443" });
const sdk = await Aftermath.create({ network: "MAINNET" });
const farms = sdk.Farms();
const pool = await farms.getStakingPool({ objectId: FARM_ID });
const tx = await pool.getIncreaseRewardsEmissionsTransaction({
  ownerCapId: OWNER_CAP_ID,
  walletAddress: OPS_WALLET,
  rewards: [{ rewardCoinType: TENMM_TYPE, emissionScheduleMs: EMISSION_SCHEDULE_MS, emissionRate: EMISSION_RATE }],
});
tx.setSender(OPS_WALLET);

if (!execute) {
  const bytes = await tx.build({ client });
  const artifact = writeUnsignedArtifact(bytes);
  console.log(JSON.stringify({
    mode: "dry-run",
    farmId: FARM_ID,
    emissionScheduleMs: EMISSION_SCHEDULE_MS,
    emissionRate: EMISSION_RATE.toString(),
    artifact,
    note: "Unsigned transaction bytes were written; rerun with --execute after configuring the local Sui keystore.",
  }, null, 2));
  process.exit(0);
}

const signer = findLocalSigner();
if (!signer) {
  const bytes = await tx.build({ client });
  const artifact = writeUnsignedArtifact(bytes);
  console.error(`No Ed25519 keystore key for ${OPS_WALLET}; unsigned PTB written to ${artifact}`);
  process.exit(3);
}

const result = await client.signAndExecuteTransaction({
  signer,
  transaction: tx,
  include: { effects: true, balanceChanges: true },
});
const executed = result.Transaction ?? result.FailedTransaction ?? result;
console.log(JSON.stringify({
  mode: "executed",
  digest: executed.digest,
  status: executed.effects?.status,
  emissionScheduleMs: EMISSION_SCHEDULE_MS,
  emissionRate: EMISSION_RATE.toString(),
  farmId: FARM_ID,
}, null, 2));
