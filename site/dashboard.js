import { CONFIG } from "./config.js";
import { SuiClient, getFullnodeUrl } from "https://esm.sh/@mysten/sui@1.39.0/client";
// Note: public JSON-RPC may be deprecated; dashboard falls back to public/mine-*.json files.
const $ = (id) => document.getElementById(id);
const client = new SuiClient({ url: getFullnodeUrl(CONFIG.network) });
const fmt = (raw, decimals) => { try { const n = BigInt(raw || 0); const base = 10n ** BigInt(decimals); const whole = n / base; const frac = (n % base).toString().padStart(decimals, "0").replace(/0+$/, ""); return frac ? `${whole}.${frac}` : whole.toString(); } catch { return "—"; } };
const isHexId = (v) => typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v);
const coinType = () => CONFIG.coinType || (CONFIG.packageId ? `${CONFIG.packageId}::tenmm::TENMM` : "");
const byId = (id) => document.getElementById(id);
const registryFallbacks = CONFIG.stats?.holderRegistryFallbacks || { principal: "Registry lookup unavailable", pendingFee: "Paid during mine - lookup unavailable" };
const registryValue = (value) => value !== undefined && value !== null && value !== "";
const formatRegistryAmount = (value) => registryValue(value) ? String(fmt(value, 8)) + " 10MM" : null;
const holderFields = (node) => {
  let current = node;
  for (let i = 0; i < 5 && current; i += 1) {
    if (current.fields && typeof current.fields === "object") {
      const fields = current.fields;
      if (registryValue(fields.principal) || registryValue(fields.owed) || registryValue(fields.pending_rewards)) return fields;
      if (fields.value) { current = fields.value; continue; }
      current = fields; continue;
    }
    if (current.value) { current = current.value; continue; }
    break;
  }
  return current && typeof current === "object" ? current : {};
};
async function loadHolderRegistry(address) {
  const addressEl = byId("holder-registry-address");
  const principalEl = byId("holder-principal");
  const pendingEl = byId("holder-pending-fee");
  const stateEl = byId("holder-registry-state");
  const noteEl = byId("holder-registry-note");
  if (addressEl) addressEl.textContent = address;
  if (principalEl) principalEl.textContent = registryFallbacks.principal;
  if (pendingEl) pendingEl.textContent = registryFallbacks.pendingFee;
  if (stateEl) stateEl.textContent = "Reading registry...";
  try {
    const obj = await client.getObject({ id: CONFIG.holderRegistryId, options: { showContent: true } });
    const fields = obj.data?.content?.fields || {};
    let holder = holderFields(fields);
    const table = fields.holders;
    const tableId = table?.fields?.id?.id || table?.fields?.id || table?.id?.id || table?.id;
    if (tableId && typeof client.getDynamicFieldObject === "function") {
      try {
        const entry = await client.getDynamicFieldObject({ parentId: tableId, name: { type: "address", value: address } });
        holder = holderFields(entry?.data?.content?.fields || entry?.data?.value || entry?.data);
      } catch (_) { /* table lookup may be unavailable on public RPC */ }
    }
    const principal = holder.principal ?? holder.tracked_principal;
    const pending = holder.owed ?? holder.pending_fee ?? holder.pending_rewards;
    if (registryValue(principal) && principalEl) principalEl.textContent = formatRegistryAmount(principal);
    if (registryValue(pending) && pendingEl) pendingEl.textContent = formatRegistryAmount(pending);
    const direct = registryValue(principal) || registryValue(pending);
    if (stateEl) stateEl.textContent = direct ? "Registry data readable" : "Connected - holder table not directly readable";
    if (noteEl) noteEl.innerHTML = "Connected address: <code>" + address + "</code>. Rewards pay during mine. " + (direct ? "Use " : "The public registry exposes a table rather than a direct wallet row. Use ") + "<a href='#send'>Send</a> for tracked transfers.";
  } catch (_) {
    if (stateEl) stateEl.textContent = "RPC unavailable - fallback shown";
    if (noteEl) noteEl.innerHTML = "Connected address: <code>" + address + "</code>. Rewards pay during mine. Registry lookup failed, so the configured placeholders are shown. Use <a href='#send'>Send</a> for tracked transfers.";
  }
}
async function loadPoolSnapshot() {
  const set = (id, value) => { const el = byId(id); if (el) el.textContent = value; };
  const money = (value) => { const n = Number(value); return Number.isFinite(n) ? "\u0024" + n.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "-"; };
  const sui = (value) => { const n = Number(value); return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 8 }) + " SUI" : "-"; };
  try {
    const pool = await json("public/mine-pool.json");
    const priceSui = sui(pool.priceNative);
    const priceUsd = money(pool.priceUsd);
    const tvl = money(pool.liquidityUsd);
    const volume = money(pool.volume24hUsd);
    set("pool-price-sui", priceSui); set("pool-price-usd", priceUsd); set("pool-tvl", tvl); set("pool-volume", volume);
    set("board-pool-price", priceSui + " / " + priceUsd); set("board-pool-tvl", tvl); set("board-pool-volume", volume);
    const dexUrl = pool.url || "https://dexscreener.com/sui/0xdee1982f5a75e5dace09b2f4dac1ed473cbbbd0ca34ad06a9876abffac7e2bb2";
    const links = { "pool-swap-link": CONFIG.cetusBuyUrl, "pool-lp-link": CONFIG.poolUrl, "pool-dex-link": dexUrl, "board-pool-link": dexUrl };
    Object.entries(links).forEach(([id, href]) => { const el = byId(id); if (el && href) el.href = href; });
    const when = pool.fetchedAt ? new Date(pool.fetchedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "current snapshot";
    set("pool-source-status", "DexScreener - " + when);
  } catch (_) {
    set("pool-source-status", "DexScreener snapshot unavailable");
    set("pool-note", "The cached DexScreener snapshot is unavailable right now; use the Cetus links below.");
  }
}
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
  await loadHolderRegistry(address);
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
  if (!rows.length) { body.innerHTML = `<tr><td colspan="5">No mint events published yet.</td></tr>`; status.textContent = "No recent blocks"; return; }
  rows.forEach((entry) => {
    const row = document.createElement("tr");
    const rewarded = entry.rewarded || entry.rewards || entry.recipients;
    let rewardedText = "—";
    if (Array.isArray(rewarded) && rewarded.length) {
      rewardedText = rewarded.map((r) => {
        if (typeof r === "string") return `${r.slice(0, 6)}…${r.slice(-4)}`;
        const addr = r.address || r.recipient || "";
        const amt = r.amount_10mm ?? r.amount ?? r.raw;
        const short = addr ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : "—";
        return amt != null ? `${short}: ${amt} 10MM` : short;
      }).join(" · ");
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
  const stats = CONFIG.stats || {};
  $("mine-network").textContent = CONFIG.network;
  $("stat-network").textContent = CONFIG.network;

  // Always seed from config so cards never stay on "Pending…"
  $("stat-reward").textContent = stats.blockReward || "50 10MM / block (then halvings)";
  $("mine-subsidy").textContent = stats.currentSubsidy || "50 10MM / block";
  $("stat-holders").textContent = stats.holders || "Hold-to-earn registry live";
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
    if (hasValue(status.holders)) $("stat-holders").textContent = String(status.holders);
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

function renderDapps() { const host = $("dapps"); (CONFIG.dapps || []).forEach((dapp) => { const el = dapp.url ? document.createElement("a") : document.createElement("span"); el.className = "dapp"; el.textContent = dapp.name; const note = document.createElement("small"); note.textContent = dapp.note || (dapp.url ? "Open" : "Coming at launch"); el.append(" ", note); if (dapp.url) { el.href = dapp.url; el.target = "_blank"; el.rel = "noopener noreferrer"; } host.append(el); }); }
renderDapps(); loadPoolSnapshot(); loadCountdownAnchor().then(updateCountdown); refreshMine(); refreshMintData(); setInterval(updateCountdown, 1000); setInterval(() => { loadCountdownAnchor().then(updateCountdown); refreshMine(); }, 60000); setInterval(refreshMintData, 60000); setInterval(loadPoolSnapshot, 300000);
