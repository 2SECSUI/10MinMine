#!/usr/bin/env node
/**
 * Claim pending TENMM rewards from the 10MinMine Aftermath farm to the ops wallet.
 *
 * Usage: node laptop/aftermath_claim_rewards.mjs [--execute]
 * Default mode is a read/build-only dry run. --execute signs and submits only
 * when a non-zero claimable TENMM balance is found.
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
const OPS_WALLET = "0x58189b677894e0fe7ad38e0e516408a3500da57d86fc0436373bc1d9c6334d0a";
const TENMM_TYPE = "0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98::tenmm::TENMM";
const DECIMALS = 8;

function fail(message, code = 2) {
  console.error(`error: ${message}`);
  console.error("usage: node laptop/aftermath_claim_rewards.mjs [--execute]");
  process.exit(code);
}
function decimal(raw) {
  const value = BigInt(raw);
  const whole = value / 10n ** BigInt(DECIMALS);
  const fraction = (value % 10n ** BigInt(DECIMALS)).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
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
    } catch { /* unrelated or unsupported key */ }
  }
  return null;
}
function writeUnsignedArtifact(bytes, details) {
  const output = path.join(path.dirname(fileURLToPath(import.meta.url)), `aftermath_claim_${Date.now()}.json`);
  fs.writeFileSync(output, JSON.stringify({ network: "mainnet", ...details, txBytesBase64: Buffer.from(bytes).toString("base64") }, null, 2) + "\n");
  return output;
}
function positiveTenmmBalance(result) {
  const changes = result?.Transaction?.balanceChanges ?? result?.balanceChanges ?? [];
  return changes.filter((change) =>
    String(change.coinType ?? "").toLowerCase() === TENMM_TYPE.toLowerCase() &&
    BigInt(change.amount ?? 0) > 0n
  ).reduce((sum, change) => sum + BigInt(change.amount), 0n);
}

const execute = process.argv.includes("--execute");
const client = new SuiGrpcClient({ network: "mainnet", baseUrl: "https://fullnode.mainnet.sui.io:443" });
const sdk = await Aftermath.create({ network: "MAINNET" });
const farms = sdk.Farms();
const pool = await farms.getStakingPool({ objectId: FARM_ID });
const owned = await farms.getOwnedStakedPositions({ walletAddress: OPS_WALLET });
const positions = owned.filter((position) => position.stakedPosition.stakingPoolObjectId.toLowerCase() === FARM_ID.toLowerCase());

let pendingRaw = 0n;
const positionDetails = [];
for (const position of positions) {
  // Recalculate local accounting from the fresh pool snapshot before reading pending rewards.
  position.updatePosition({ stakingPool: pool });
  const amount = position.rewardsEarned({ coinType: TENMM_TYPE, stakingPool: pool });
  pendingRaw += BigInt(amount);
  positionDetails.push({ positionId: position.stakedPosition.objectId, claimableRaw: BigInt(amount).toString(), claimable10mm: decimal(amount) });
}

const details = {
  farmId: FARM_ID,
  sender: OPS_WALLET,
  rewardCoinType: TENMM_TYPE,
  positionCount: positions.length,
  positions: positionDetails,
  pendingRewardRaw: pendingRaw.toString(),
  pendingReward10mm: decimal(pendingRaw),
};
if (pendingRaw <= 0n) {
  console.log(JSON.stringify({ mode: execute ? "execute-noop" : "dry-run", ...details, claimable: false, note: "No claimable TENMM found; no transaction was built or submitted." }, null, 2));
  process.exit(0);
}

const tx = await pool.getHarvestRewardsTransaction({
  stakedPositionIds: positions.map((position) => position.stakedPosition.objectId),
  walletAddress: OPS_WALLET,
});
tx.setSender(OPS_WALLET);

if (!execute) {
  const bytes = await tx.build({ client });
  const artifact = writeUnsignedArtifact(bytes, details);
  console.log(JSON.stringify({ mode: "dry-run", ...details, claimable: true, artifact, note: "Unsigned claim PTB written; pass --execute only after reviewing the amount." }, null, 2));
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
const claimedRaw = positiveTenmmBalance(result) || pendingRaw;
console.log(JSON.stringify({ mode: "executed", ...details, claimedRewardRaw: claimedRaw.toString(), claimedReward10mm: decimal(claimedRaw), digest: executed.digest, status }, null, 2));
if (status?.status && status.status !== "success") process.exit(1);
