import { SuiClient, getFullnodeUrl } from "https://esm.sh/@mysten/sui@1.39.0/client";
import { CONFIG } from "../config.js";
const $ = (id) => document.getElementById(id), client = new SuiClient({ url: getFullnodeUrl(CONFIG.network) });
async function lookup() {
  const digest = $("digest").value.trim(); $("results").hidden = true;
  if (!/^[A-Za-z0-9]{10,}$/.test(digest)) return $("status").textContent = "Enter a valid transaction digest.";
  $("status").textContent = `Looking up transaction on ${CONFIG.network}…`;
  try { const r = await client.getTransactionBlock({ digest, options: { showEffects: true, showInput: true } }); $("out-status").textContent = r.effects?.status?.status || "Unknown"; $("out-digest").textContent = digest; $("out-sender").textContent = r.transaction?.data?.sender || "Not available"; $("out-network").textContent = CONFIG.network; $("results").hidden = false; $("status").textContent = "Transaction lookup complete."; }
  catch (e) { $("status").textContent = e.message || String(e); }
}
$("lookup").onclick = lookup;
const q = new URLSearchParams(location.search).get("q"); if (q) { $("digest").value = q; lookup(); }
