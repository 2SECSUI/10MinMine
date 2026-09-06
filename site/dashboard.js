import { CONFIG } from "./config.js";
import { SuiClient, getFullnodeUrl } from "https://esm.sh/@mysten/sui@1.39.0/client";
// Note: public JSON-RPC may be deprecated; dashboard falls back to public/mine-*.json files.
const $ = (id) => document.getElementById(id);
const client = new SuiClient({ url: getFullnodeUrl(CONFIG.network) });
const fmt = (raw, decimals) => { try { const n = BigInt(raw || 0); const base = 10n ** BigInt(decimals); const whole = n / base; const frac = (n % base).toString().padStart(decimals, "0").replace(/0+$/, ""); return frac ? `${whole}.${frac}` : whole.toString(); } catch { return "—"; } };
const isHexId = (v) => typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v);
const coinType = () => CONFIG.coinType || (CONFIG.packageId ? `${CONFIG.packageId}::tenmm::TENMM` : "");
const byId = (id) => document.getElementById(id);
async function loadPoolSnapshot() {
  const set = (id, value) => { const el = byId(id); if (el) el.textContent = value; };
  const money = (value) => { const n = Number(value); return Number.isFinite(n) ? "\u0024" + n.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "—"; };
  const sui = (value) => { const n = Number(value); return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 8 }) + " SUI" : "—"; };
  let pool;
  try {
    const live = await fetch("https://api.dexscreener.com/latest/dex/pairs/sui/" + CONFIG.poolId, { cache: "no-store" });
    if (!live.ok) throw new Error("DexScreener unavailable");
    const payload = await live.json(); const pair = payload.pairs && payload.pairs[0];
    if (!pair) throw new Error("Cetus pair unavailable");
    pool = { priceNative: pair.priceNative, priceUsd: pair.priceUsd, liquidityUsd: pair.liquidity && pair.liquidity.usd, volume24hUsd: pair.volume && pair.volume.h24, url: pair.url, fetchedAt: new Date().toISOString() };
  } catch (_) { pool = await json("public/mine-pool.json"); }
  const priceSui = sui(pool.priceNative); const priceUsd = money(pool.priceUsd); const tvl = money(pool.liquidityUsd); const volume = money(pool.volume24hUsd);
  set("pool-price-sui", priceSui); set("pool-price-usd", priceUsd); set("pool-tvl", tvl); set("pool-volume", volume);
  set("board-pool-price", priceSui + " / " + priceUsd); set("board-pool-tvl", tvl); set("board-pool-volume", volume);
  set("cetus-stat-tvl", tvl); set("cetus-stat-price", priceSui + " / " + priceUsd); set("cetus-stat-volume", volume);
  const dexUrl = pool.url || "https://dexscreener.com/sui/" + CONFIG.poolId;
  const links = { "pool-swap-link": CONFIG.cetusBuyUrl, "pool-lp-link": CONFIG.poolUrl, "pool-dex-link": dexUrl, "board-pool-link": dexUrl };
  Object.entries(links).forEach(([id, href]) => { const el = byId(id); if (el && href) el.href = href; });
  const when = pool.fetchedAt ? new Date(pool.fetchedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "current snapshot";
  set("pool-source-status", "DexScreener · " + when);
}

async function loadAftermathFarm() {
  const set = (id, value) => { const el = byId(id); if (el) el.textContent = value; };
  const endpoints = ["https://mainnet.suiet.app", CONFIG.rpcUrl].filter(Boolean);
  try {
    let fields;
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sui_getObject", params: [CONFIG.aftermathFarmId, { showContent: true }] }), cache: "no-store" });
        const result = await response.json();
        if (result.result && result.result.data && result.result.data.content && result.result.data.content.fields) { fields = result.result.data.content.fields; break; }
      } catch (_) {}
    }
    if (!fields) throw new Error("Aftermath farm RPC unavailable");
    const pick = (value) => Array.isArray(value) ? value[0] : value;
    const rate = pick(fields.emission_rates); const frequency = Number(pick(fields.emission_frequencies_ms)); const emitted = pick(fields.total_rewards_emitted); const remaining = pick(fields.total_rewards_remaining); const staked = pick(fields.total_staked_amount);
    const minutes = Number.isFinite(frequency) && frequency > 0 ? Math.round(frequency / 60000) : 10;
    set("aftermath-tvl", fmt(staked, 8) + " 10MM");
    set("aftermath-reward-rate", "0.00004185 10MM / " + minutes + " min initial · 98% top-ups");
    set("aftermath-rewards", fmt(emitted, 8) + " paid · " + fmt(remaining, 8) + " remaining");
    set("stat-farm", fmt(staked, 8) + " 10MM");
    set("aftermath-farm-status", "Live farm · " + fmt(rate, 8) + " configured now · 98% top-ups until height 210000");
  } catch (_) { set("aftermath-farm-status", "Live farm stats unavailable · retrying"); }
}
const decimalToMist = (value) => { const input = String(value || "").trim(); if (!/^[0-9]+([.][0-9]{1,9})?$/.test(input)) throw new Error("Enter a SUI amount with up to 9 decimal places."); const parts = input.split("."); return BigInt(parts[0]) * 1000000000n + BigInt(((parts[1] || "") + "000000000").slice(0, 9)); };
const feeEl = $("feePreview");
if (feeEl) feeEl.textContent = "Swaps use Cetus pool fees — review price impact on Cetus before confirming.";
async function loadDashboard(address) {
  $("dashboard").hidden = false; $("wallet-address").textContent = address;
  try { const sui = await client.getBalance({ owner: address, coinType: "0x2::sui::SUI" }); $("wallet-sui").textContent = `${fmt(sui.totalBalance, 9)} SUI`; } catch { $("wallet-sui").textContent = "Pending…"; }
  try { const ten = await client.getBalance({ owner: address, coinType: coinType() }); $("wallet-10mm").textContent = `${fmt(ten.totalBalance, 8)} 10MM`; } catch { $("wallet-10mm").textContent = "Pending…"; }
  const override = CONFIG.stats?.pendingRewards; $("wallet-rewards").textContent = override || "Legacy claim balance available";
  $("wallet-note").textContent = `Balances read from ${CONFIG.network} public RPC.`;
}
window.addEventListener("tenmm-connected", (event) => loadDashboard(event.detail.address));
let countdownAnchor = null;

const TICK_TOTAL = 600;
let tickBuilt = false;
let lastFilled = -1;
let celebratedForAnchor = null;
function ensureTickGrid() {
  const grid = $("tick-grid");
  if (!grid || tickBuilt) return grid;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < TICK_TOTAL; i++) {
    const cell = document.createElement("span");
    cell.className = "tick";
    cell.dataset.i = String(i);
    frag.append(cell);
  }
  grid.append(frag);
  tickBuilt = true;
  return grid;
}
function setTickFill(filled) {
  const grid = ensureTickGrid();
  if (!grid) return;
  const n = Math.max(0, Math.min(TICK_TOTAL, filled | 0));
  if (n === lastFilled) {
    const prog = $("tick-progress");
    if (prog) prog.textContent = `${n} / ${TICK_TOTAL}`;
    return;
  }
  const cells = grid.children;
  const start = Math.min(lastFilled < 0 ? 0 : lastFilled, n);
  const end = Math.max(lastFilled < 0 ? 0 : lastFilled, n);
  for (let i = start; i < end; i++) {
    if (!cells[i]) continue;
    cells[i].classList.toggle("on", i < n);
    cells[i].classList.remove("boom");
  }
  // if first paint, sync all
  if (lastFilled < 0) {
    for (let i = 0; i < TICK_TOTAL; i++) cells[i]?.classList.toggle("on", i < n);
  }
  lastFilled = n;
  const prog = $("tick-progress");
  if (prog) prog.textContent = `${n} / ${TICK_TOTAL}`;
}
async function celebrateMine() {
  const card = document.querySelector(".live-countdown-card");
  if (card) card.classList.add("celebrate");
  const grid = $("tick-grid");
  if (grid) {
    [...grid.children].forEach((c, i) => {
      if (i % 17 === 0) c.classList.add("boom");
    });
    setTimeout(() => [...grid.children].forEach((c) => c.classList.remove("boom")), 900);
  }
  try {
    const mod = await import("https://esm.sh/canvas-confetti@1.9.3");
    const confetti = mod.default;
    const canvas = document.getElementById("confetti-canvas");
    const fire = canvas ? confetti.create(canvas, { resize: true, useWorker: true }) : confetti;
    fire({ particleCount: 120, spread: 75, origin: { y: 0.3 }, colors: ["#f7931a", "#fb923c", "#fdba74", "#ffffff", "#22c55e"] });
    setTimeout(() => fire({ particleCount: 70, angle: 60, spread: 55, origin: { x: 0.1, y: 0.4 } }), 180);
    setTimeout(() => fire({ particleCount: 70, angle: 120, spread: 55, origin: { x: 0.9, y: 0.4 } }), 320);
  } catch (_) { /* ignore */ }
  setTimeout(() => card?.classList.remove("celebrate"), 1200);
}


const HALVING_INTERVAL = 210000;
const BLOCK_SECS = 600;
const INITIAL_SUBSIDY_10MM = 50;
const subsidyAtHeight = (height) => {
  const era = Math.floor(height / HALVING_INTERVAL);
  if (era >= 64) return 0;
  return INITIAL_SUBSIDY_10MM / (2 ** era);
};
const formatDuration = (secs) => {
  if (!Number.isFinite(secs) || secs < 0) return "—";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d >= 365) {
    const y = (secs / (365.25 * 86400));
    return `~${y.toFixed(1)} years`;
  }
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};
function renderHalvings(anchorTs, currentHeight) {
  const body = $("halving-body");
  if (!body) return;
  body.replaceChildren();
  const now = Math.floor(Date.now() / 1000);
  const baseTs = Number.isFinite(Number(anchorTs)) && Number(anchorTs) > 0
    ? Number(anchorTs)
    : now;
  const height = Number(currentHeight) || 0;
  const horizon = now + Math.floor(10 * 365.25 * 86400);
  const rows = [];
  let era = Math.floor(height / HALVING_INTERVAL) + 1;
  while (era < 64) {
    const atHeight = era * HALVING_INTERVAL;
    const blocksAway = Math.max(0, atHeight - height);
    const when = baseTs + blocksAway * BLOCK_SECS;
    if (when > horizon) break;
    const newSubsidy = subsidyAtHeight(atHeight);
    rows.push({ era, atHeight, newSubsidy, when, blocksAway });
    era += 1;
  }
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5">No halvings fall inside the next 10 years from the current height.</td></tr>`;
    return;
  }
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const whenDate = new Date(row.when * 1000);
    const whenText = whenDate.toLocaleString(undefined, {
      weekday: "short", year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", timeZoneName: "short"
    });
    const cells = [
      `Halving #${row.era}`,
      String(row.atHeight),
      `${row.newSubsidy} 10MM / block`,
      whenText,
      formatDuration(row.when - now),
    ];
    cells.forEach((text, i) => {
      const td = document.createElement("td");
      if (i === 0) {
        const pill = document.createElement("span");
        pill.className = "pill";
        pill.textContent = text;
        td.append(pill);
      } else td.textContent = text;
      tr.append(td);
    });
    body.append(tr);
  });
}

const wallClockNextBoundary = () => {
  const now = Math.floor(Date.now() / 1000);
  return (Math.floor(now / 600) + 1) * 600;
};
const parseStatusTs = (status) => {
  if (!status || typeof status !== 'object') return null;
  const next = Number(status.next_block_ts);
  if (Number.isFinite(next) && next > 0) return next;
  const last = Number(status.last_block_ts);
  if (Number.isFinite(last) && last > 0) return last + 600;
  const updated = status.updatedAt || status.updated_at;
  if (updated) {
    const ms = Date.parse(updated);
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000) + 600;
  }
  return null;
};
async function loadCountdownAnchor() {
  try {
    const status = await json('public/mine-status.json');
    countdownAnchor = parseStatusTs(status);
    if (countdownAnchor != null && celebratedForAnchor != null && celebratedForAnchor !== countdownAnchor) {
      celebratedForAnchor = null;
      lastFilled = -1;
    }
    const height = Number(status.block_height ?? status.height ?? status.lastBlockHeight ?? 0);
    const lastTs = Number(status.last_block_ts);
    const anchorForHalving = Number.isFinite(lastTs) && lastTs > 0 ? lastTs : countdownAnchor;
    if (height !== lastHalvingHeight || true) {
      renderHalvings(anchorForHalving, height);
      lastHalvingHeight = height;
    }
  } catch {
    /* keep prior anchor */
  }
}
let lastHalvingHeight = null;
const updateCountdown = () => {
  const el = $('countdown');
  if (!el) return;
  const now = Math.floor(Date.now() / 1000);
  const next = countdownAnchor || wallClockNextBoundary();
  const left = Math.max(0, next - now);
  el.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  const filled = Math.min(TICK_TOTAL, Math.max(0, TICK_TOTAL - left));
  setTickFill(filled);
  if (left === 0 && celebratedForAnchor !== next) {
    celebratedForAnchor = next;
    celebrateMine();
  }
  if (left > 0 && celebratedForAnchor === next) {
    /* keep flag until anchor moves */
  }
  const sub = $('countdown-sub');
  if (sub) {
    if (left === 0) sub.textContent = 'Block is mineable now · celebration · waiting for next mine';
    else if (countdownAnchor) sub.textContent = `Next mine in ${Math.floor(left / 60)}m ${left % 60}s · ${filled}/600 seconds filled`;
    else sub.textContent = 'Waiting for mine-status.json · showing wall-clock boundary';
  }
  const mineCopy = $('countdown-mine');
  if (mineCopy) mineCopy.textContent = left === 0 ? 'Ready now ↑' : `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')} ↑`;
};
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
  if (!rows.length) { body.innerHTML = `<tr><td colspan="2">No mint events published yet.</td></tr>`; status.textContent = "No recent blocks"; return; }
  rows.forEach((entry) => {
    const row = document.createElement("tr");
    const amount = entry.amount_10mm ?? entry.minted_10mm ?? entry.amount ?? (entry.minted_raw != null ? Number(entry.minted_raw) / 1e8 : null);
    const amountText = amount == null || amount === "" ? "—" : `${amount} 10MM`;
    const timeText = displayTime(entry.ts ?? entry.timestamp ?? entry.time);
    [amountText, timeText].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      row.append(cell);
    });
    body.append(row);
  });
  status.textContent = rows.length + " blocks · newest 10 in view · scroll for older";
}
async function refreshMintData() {
  try { const log = await json("public/mine-log.json"); renderMintLog(log); } catch { renderMintLog([]); $("mint-log-status").textContent = "Mint log unavailable"; }
}
async function refreshMine() {
  const stats = CONFIG.stats || {};
  $("mine-network").textContent = CONFIG.network;
  $("stat-network").textContent = CONFIG.network;

  // Always seed from config so cards never stay on "Pending…"
  $("stat-reward").textContent = stats.blockReward || "50 10MM / block (then halvings)";
  $("mine-subsidy").textContent = stats.currentSubsidy || "50 10MM / block";
  $("stat-price").textContent = stats.price || "Cetus 10MM/SUI LP";
  $("stat-feepot").textContent = stats.feePot || "0.01 SUI tip / mine when funded";
  if ($("mine-slot")) $("mine-slot").textContent = stats.holdSlot || "Pays each ~10m block · see countdown";

  const pool = $("stat-pool");
  if (pool) {
    pool.replaceChildren();
    if (CONFIG.poolUrl) {
      const a = document.createElement("a");
      a.href = CONFIG.poolUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "Open Cetus position";
      pool.append(a);
    } else {
      pool.textContent = stats.pool || "Cetus pool linked at launch";
    }
  }

  const status = await json("public/mine-status.json").catch(() => null);
  let log = null;
  try { log = await json("public/mine-log.json"); } catch {}

  let height = null;
  let minted = null;
  let subsidy = null;

  // Prefer published status files (works without public JSON-RPC)
  if (status) {
    height = status.block_height ?? status.height ?? status.lastBlockHeight ?? null;
    minted = status.total_minted_10mm ?? status.totalMinted10mm ?? status.supply ?? null;
    subsidy = status.current_subsidy_10mm ?? status.currentSubsidy ?? null;
    if (hasValue(status.price_note)) $("stat-price").textContent = String(status.price_note);
    if (hasValue(status.fee_pot_note)) $("stat-feepot").textContent = String(status.fee_pot_note);
    if (hasValue(status.hold_slot_note) && $("mine-slot")) $("mine-slot").textContent = String(status.hold_slot_note);
    if (hasValue(status.block_reward_note)) $("stat-reward").textContent = String(status.block_reward_note);
  }

  if (Array.isArray(log) && log.length) {
    if (minted == null) {
      const total = log.reduce((s, e) => s + Number(e.amount_10mm || 0), 0);
      if (total > 0) minted = total;
    }
    if (height == null) {
      const maxH = Math.max(0, ...log.map((e) => Number(e.height || 0)));
      if (maxH > 0) height = maxH;
    }
  }

  // Optional live RPC (may fail after JSON-RPC shutoff — ignore errors)
  if (isHexId(CONFIG.rewardPoolId)) {
    try {
      const obj = await client.getObject({ id: CONFIG.rewardPoolId, options: { showContent: true } });
      const f = obj.data?.content?.fields || {};
      const liveSubsidy = field(f, ["current_subsidy", "subsidy"]);
      const liveHeight = field(f, ["block_height", "height"]);
      if (hasValue(liveHeight)) height = liveHeight;
      if (hasValue(liveSubsidy)) {
        // Move base units -> 10MM if it looks like raw (8 decimals)
        const n = Number(liveSubsidy);
        subsidy = (Number.isFinite(n) && n >= 1e6) ? (n / 1e8) : liveSubsidy;
      }
    } catch {}
  }

  if (hasValue(height)) $("mine-height").textContent = String(height);
  else $("mine-height").textContent = stats.lastBlockHeight || "—";

  if (hasValue(minted)) $("mine-minted").textContent = `${minted} 10MM`;
  else $("mine-minted").textContent = stats.supply || "—";

  if (hasValue(subsidy)) $("mine-subsidy").textContent = `${subsidy} 10MM / block`;
  $("stat-reward").textContent = stats.blockReward || (hasValue(subsidy) ? `${subsidy} 10MM / block` : "50 10MM / block (then halvings)");
}

loadPoolSnapshot(); loadAftermathFarm(); loadCountdownAnchor().then(updateCountdown); refreshMine(); refreshMintData(); setInterval(updateCountdown, 1000); setInterval(() => { loadCountdownAnchor().then(updateCountdown); refreshMine(); }, 60000); setInterval(refreshMintData, 60000); setInterval(loadPoolSnapshot, 300000); setInterval(loadAftermathFarm, 60000);
