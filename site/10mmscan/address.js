import { SuiClient, getFullnodeUrl } from "https://esm.sh/@mysten/sui@1.39.0/client";
import { CONFIG } from "../config.js";
const $ = (id) => document.getElementById(id);
const client = new SuiClient({ url: getFullnodeUrl(CONFIG.network) });
const valid = (a) => /^0x[0-9a-fA-F]+$/.test(a) && a.length >= 3;
const type = () => CONFIG.coinType || (CONFIG.packageId ? `${CONFIG.packageId}::tenmm::TENMM` : "");
const fmt = (raw, d) => { try { const n = BigInt(raw || 0), b = 10n ** BigInt(d), w = n / b, f = (n % b).toString().padStart(d, "0").replace(/0+$/, ""); return f ? `${w}.${f}` : w.toString(); } catch { return "—"; } };
async function lookup() {
  const a = $("address").value.trim(); $("results").hidden = true;
  if (!valid(a)) return $("status").textContent = "Enter a valid Sui address.";
  $("status").textContent = `Loading ${CONFIG.network} balances…`;
  try {
    const sui = await client.getBalance({ owner: a, coinType: "0x2::sui::SUI" });
    $("out-address").textContent = a; $("out-sui").textContent = `${fmt(sui.totalBalance, 9)} SUI`; $("out-network").textContent = CONFIG.network;
    if (type()) { const ten = await client.getBalance({ owner: a, coinType: type() }); $("out-tenmm").textContent = `${fmt(ten.totalBalance, 8)} 10MM`; } else $("out-tenmm").textContent = "Pending publish";
    $("results").hidden = false; $("status").textContent = "Balance lookup complete.";
  } catch (e) { $("status").textContent = e.message || String(e); }
}
$("lookup").onclick = lookup;
const q = new URLSearchParams(location.search).get("q"); if (q) { $("address").value = q; lookup(); }
