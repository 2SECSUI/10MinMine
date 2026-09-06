import { CONFIG } from "../config.js";
const $ = (id) => document.getElementById(id);
$("network").textContent = CONFIG.network; $("package").textContent = CONFIG.packageId || "Pending publish"; $("metadata").textContent = CONFIG.coinMetadataId || "Pending publish";
if (CONFIG.stats?.supply) $("supply").textContent = CONFIG.stats.supply;
if (CONFIG.stats?.circulatingSupply) $("circulating").textContent = CONFIG.stats.circulatingSupply;
if (CONFIG.poolUrl) { const a = document.createElement("a"); a.href = CONFIG.poolUrl; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = "View liquidity pool →"; $("pool").append(a); }
else if (CONFIG.poolId) $("pool").textContent = `Pool: ${CONFIG.poolId}`;
else $("pool").textContent = "Liquidity pool link: Pending launch";
for (const d of CONFIG.dapps || []) { const box = document.createElement("div"); box.className = "result"; const el = d.url ? document.createElement("a") : document.createElement("span"); el.textContent = d.name; const note = document.createElement("small"); note.textContent = d.url ? "Open" : "Coming at launch"; box.append(el, note); if (d.url) { el.href = d.url; el.target = "_blank"; el.rel = "noopener noreferrer"; } $("dapps").append(box); }
