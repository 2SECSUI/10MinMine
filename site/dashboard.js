import { CONFIG } from "./config.js";
import { SuiClient, getFullnodeUrl } from "https://esm.sh/@mysten/sui@1.39.0/client";
const $ = (id) => document.getElementById(id);
const client = new SuiClient({ url: getFullnodeUrl(CONFIG.network) });
const fmt = (raw, decimals) => { try { const n = BigInt(raw || 0); const base = 10n ** BigInt(decimals); const whole = n / base; const frac = (n % base).toString().padStart(decimals, "0").replace(/0+$/, ""); return frac ? `${whole}.${frac}` : whole.toString(); } catch { return "—"; } };
const isHexId = (v) => typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v);
const coinType = () => CONFIG.coinType || (CONFIG.packageId ? `${CONFIG.packageId}::tenmm::TENMM` : "");
const decimalToMist = (value) => { const input = String(value || "").trim(); if (!/^[0-9]+([.][0-9]{1,9})?$/.test(input)) throw new Error("Enter a SUI amount with up to 9 decimal places."); const parts = input.split("."); return BigInt(parts[0]) * 1000000000n + BigInt(((parts[1] || "") + "000000000").slice(0, 9)); };
const feeEl = $("feePreview");
if (feeEl) feeEl.textContent = "Swaps use Cetus pool fees — review price impact on Cetus before confirming.";
async function loadDashboard(address) {
  $("dashboard").hidden = false; $("wallet-address").textContent = address;
  try { const sui = await client.getBalance({ owner: address, coinType: "0x2::sui::SUI" }); $("wallet-sui").textContent = `${fmt(sui.totalBalance, 9)} SUI`; } catch { $("wallet-sui").textContent = "Pending…"; }
  try { const ten = await client.getBalance({ owner: address, coinType: coinType() }); $("wallet-10mm").textContent = `${fmt(ten.totalBalance, 8)} 10MM`; } catch { $("wallet-10mm").textContent = "Pending…"; }
  const override = CONFIG.stats?.pendingRewards; $("wallet-rewards").textContent = override || (isHexId(CONFIG.holderRegistryId) ? "Registry live · pending field TBD" : "Pending publish");
  if (isHexId(CONFIG.holderRegistryId)) { try { const obj = await client.getObject({ id: CONFIG.holderRegistryId, options: { showContent: true } }); const f = obj.data?.content?.fields || {}; const value = f.pending_rewards ?? f.pending_reward; if (value != null) $("wallet-rewards").textContent = String(value); } catch {} }
  $("wallet-note").textContent = `Balances read from ${CONFIG.network} public RPC.`;
}
window.addEventListener("tenmm-connected", (event) => loadDashboard(event.detail.address));
const updateCountdown = () => { const now = Math.floor(Date.now() / 1000); const next = (Math.floor(now / 600) + 1) * 600; const left = Math.max(0, next - now); $("countdown").textContent = `Next boundary in ${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`; };
const field = (obj, names) => names.map((name) => obj[name]).find((value) => value !== undefined && value !== null);
const hasValue = (value) => value !== undefined && value !== null && value !== "";
const json = async (path) => { const response = await fetch(path, { cache: "no-store" }); if (!response.ok) throw new Error(`${path}: ${response.status}`); return response.json(); };
const displayTime = (value) => { if (!hasValue(value)) return "—"; const date = new Date(typeof value === "number" || /^\d+$/.test(String(value)) ? Number(value) * (Number(value) < 100000000000 ? 1000 : 1) : value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); };
const shortDigest = (value) => { const text = String(value || "—"); return text.length > 18 ? `${text.slice(0, 10)}…${text.slice(-6)}` : text; };
function renderMintLog(entries) {
  const body = $("mint-log-body"); const status = $("mint-log-status");
  if (!body || !status) return;
  body.replaceChildren();
  const rows = Array.isArray(entries) ? entries.filter((entry) => entry && typeof entry === "object").slice().sort((a, b) => Number(b.height ?? b.block_height ?? 0) - Number(a.height ?? a.block_height ?? 0)) : [];
  if (!rows.length) { body.innerHTML = `<tr><td colspan="5">No mint events published yet.</td></tr>`; status.textContent = "No recent blocks"; return; }
  rows.slice(0, 20).forEach((entry) => {
    const row = document.createElement("tr");
    const rewarded = entry.rewarded || entry.rewards || entry.recipients;
    let rewardedText = "—";
    if (Array.isArray(rewarded) && rewarded.length) {
      rewardedText = rewarded.map((r) => {
        if (typeof r === "string") return `${r.slice(0, 6)}…${r.slice(-4)}`;
        const addr = r.address || r.recipient || "";
        const amt = r.amount_10mm ?? r.amount ?? r.raw;
        const short = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";
        return amt != null ? `${short} (${amt} 10MM)` : short;
      }).join(", ");
    } else if (typeof rewarded === "string") rewardedText = rewarded;
    const values = [entry.height ?? entry.block_height ?? "—", displayTime(entry.ts ?? entry.timestamp ?? entry.time), shortDigest(entry.digest ?? entry.tx_digest), rewardedText, entry.event ?? entry.type ?? "mint"];
    values.forEach((value, index) => { const cell = document.createElement("td"); if (index === 2) { const code = document.createElement("code"); code.textContent = String(value); cell.append(code); } else cell.textContent = String(value); row.append(cell); });
    body.append(row);
  });
  status.textContent = `${rows.length} recent block${rows.length === 1 ? "" : "s"}`;
}
async function refreshMintData() {
  try { const log = await json("public/mine-log.json"); renderMintLog(log); } catch { renderMintLog([]); $("mint-log-status").textContent = "Mint log unavailable"; }
}
async function refreshMine() {
  $("mine-network").textContent = CONFIG.network; $("stat-network").textContent = CONFIG.network;
  const stats = CONFIG.stats || {};
  const statusPromise = json("public/mine-status.json").catch(() => null);
  if (hasValue(stats.currentSubsidy)) $("mine-subsidy").textContent = stats.currentSubsidy;
  if (hasValue(stats.lastBlockHeight)) $("mine-height").textContent = stats.lastBlockHeight;
  if (hasValue(stats.supply)) $("mine-minted").textContent = stats.supply;
  let liveHeight = false; let liveSubsidy = false;
  if (isHexId(CONFIG.rewardPoolId)) {
    try {
      const obj = await client.getObject({ id: CONFIG.rewardPoolId, options: { showContent: true } });
      const f = obj.data?.content?.fields || {};
      const subsidy = field(f, ["current_subsidy", "subsidy"]); const height = field(f, ["block_height", "height"]);
      if (hasValue(subsidy)) { $("mine-subsidy").textContent = `${subsidy} base units`; liveSubsidy = true; }
      if (hasValue(height)) { $("mine-height").textContent = String(height); liveHeight = true; }
      if (!hasValue(stats.blockReward)) $("stat-reward").textContent = subsidy == null ? "Connected · parsing fields…" : `${subsidy} base units / block`;
    } catch { if (!hasValue(stats.currentSubsidy)) $("mine-subsidy").textContent = "Awaiting live object"; }
  }
  const status = await statusPromise;
  if (status) {
    if (!liveHeight && hasValue(status.block_height)) $("mine-height").textContent = String(status.block_height);
    if (hasValue(status.total_minted_10mm)) $("mine-minted").textContent = `${status.total_minted_10mm} 10MM`;
    if (!liveSubsidy && !hasValue(stats.blockReward) && hasValue(status.total_minted_10mm)) $("stat-reward").textContent = `Total minted: ${status.total_minted_10mm} 10MM`;
  }
}
function renderDapps() { const host = $("dapps"); (CONFIG.dapps || []).forEach((dapp) => { const el = dapp.url ? document.createElement("a") : document.createElement("span"); el.className = "dapp"; el.textContent = dapp.name; const note = document.createElement("small"); note.textContent = dapp.url ? "Open" : "Coming at launch"; el.append(" ", note); if (dapp.url) { el.href = dapp.url; el.target = "_blank"; el.rel = "noopener noreferrer"; } host.append(el); }); }
renderDapps(); updateCountdown(); refreshMine(); refreshMintData(); setInterval(updateCountdown, 1000); setInterval(refreshMine, 60000); setInterval(refreshMintData, 60000);
