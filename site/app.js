import { getWallets } from 'https://esm.sh/@wallet-standard/app@1.1.0';
import { SuiClient, getFullnodeUrl } from 'https://esm.sh/@mysten/sui@1.39.0/client';
import { CONFIG } from './config.js';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
if ($('hero-connect')) $('hero-connect').onclick = () => $('connect')?.click();
const walletStore = getWallets();
const walletHelpEl = document.getElementById('wallet-help');
const openSlushEl = document.getElementById('open-slush');
let wallet = null;
let account = null;

const RPC_URLS = [
  CONFIG.rpcUrl,
  'https://sui-mainnet-endpoint.blockvision.org',
  'https://mainnet.suiet.app',
  'https://sui-mainnet.public.blastapi.io',
  getFullnodeUrl(CONFIG.network || 'mainnet'),
].filter(Boolean);

let client = new SuiClient({ url: RPC_URLS[0] });
window.tenMinMineClient = client;

async function withRpc(fn) {
  let lastErr;
  for (const url of RPC_URLS) {
    try {
      client = new SuiClient({ url });
      window.tenMinMineClient = client;
      return await fn(client);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('All Sui RPC endpoints failed.');
}

if (openSlushEl) openSlushEl.href = 'https://my.slush.app/browse/' + encodeURIComponent(window.location.href);
const showWalletHelp = (show) => { if (walletHelpEl) walletHelpEl.hidden = !show; };

const normalizeSuiAddress = (raw) => {
  let v = String(raw || '').trim();
  if (!v) return '';
  if (!v.startsWith('0x') && /^[0-9a-fA-F]+$/.test(v)) v = '0x' + v;
  if (!/^0x[0-9a-fA-F]+$/.test(v)) return '';
  const hex = v.slice(2);
  if (hex.length > 64) return '';
  return '0x' + hex.toLowerCase().padStart(64, '0');
};
const coinType = () => CONFIG.coinType || `${CONFIG.packageId}::tenmm::TENMM`;
const chain = `sui:${CONFIG.network}`;
const setStatus = (text) => { if (statusEl) statusEl.textContent = text; };

const buyLink = document.getElementById('cetus-buy-link');
const sellLink = document.getElementById('cetus-sell-link');
if (buyLink && CONFIG.cetusBuyUrl) buyLink.href = CONFIG.cetusBuyUrl;
if (sellLink && CONFIG.cetusSellUrl) sellLink.href = CONFIG.cetusSellUrl;
try {
  if (!window.CetusSwap?.init) throw new Error('Cetus Terminal unavailable — use Buy/Sell beside the chart.');
  window.CetusSwap.init({
    containerId: 'cetus-terminal',
    displayMode: 'Integrated',
    independentWallet: true,
    themeType: 'Dark',
    defaultSlippage: 1,
    defaultFromToken: '0x2::sui::SUI',
    defaultToToken: coinType(),
    poolAddress: CONFIG.poolId,
  });
} catch (e) {
  setStatus(e.message || 'Cetus Terminal failed to load.');
}


const walletBlob = (w) => `${w?.name || ''} ${w?.id || ''}`.toLowerCase();
const isBinanceWallet = (w) => /binance/.test(walletBlob(w));
const isSlushWallet = (w) => {
  if (isBinanceWallet(w)) return false;
  return /slush|mysten|\bsui wallet\b/.test(walletBlob(w));
};
const listSuiWallets = () => walletStore.get().filter((w) =>
  Array.isArray(w.chains) && w.chains.includes(chain) &&
  w.features?.['standard:connect'] &&
  (w.features?.['sui:signAndExecuteTransaction'] || w.features?.['sui:signAndExecuteTransactionBlock'])
);
const pickWallet = () => listSuiWallets().find(isSlushWallet) || null;
walletStore.on('register', () => pickWallet());
walletStore.on('unregister', () => pickWallet());

$('connect').onclick = async () => {
  try {
    if (CONFIG.network !== 'mainnet') throw new Error('10MinMine is configured for Sui mainnet only.');
    const detected = listSuiWallets().map((w) => w.name || w.id || 'unknown');
    wallet = pickWallet();
    if (!wallet) {
      showWalletHelp(true);
      const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
      const found = detected.length ? `Detected: ${detected.join(', ')}.` : 'No Wallet Standard wallets detected.';
      throw new Error(mobile
        ? `${found} Open this page inside the Slush app browser.`
        : `${found} Install/unlock Slush, then Connect.`);
    }
    showWalletHelp(false);
    const result = await wallet.features['standard:connect'].connect();
    let next = result.accounts?.find((a) => !a.chains || a.chains.includes(chain)) || result.accounts?.[0];
    if (!next?.address) throw new Error('Wallet did not return a valid account.');
    const normalized = normalizeSuiAddress(next.address);
    account = { ...next, address: normalized || next.address };
    $('connect').textContent = `${account.address.slice(0, 6)}…${account.address.slice(-4)}`;
    $("disconnect").disabled = false;
    window.dispatchEvent(new CustomEvent('tenmm-connected', { detail: { address: account.address } }));
    setStatus(`Connected via Slush on ${CONFIG.network}.`);
  } catch (e) {
    $("disconnect").disabled = true;
    wallet = null; account = null;
    $('connect').textContent = 'Connect Slush';
    setStatus(e.message || String(e));
  }
};

$('disconnect').onclick = async () => {
  try { await wallet?.features?.['standard:disconnect']?.disconnect?.(); } catch (_) {}
  $("disconnect").disabled = true;
  wallet = null; account = null;
  $('connect').textContent = 'Connect Slush';
  showWalletHelp(false);
  setStatus('Disconnected from Slush.');
};


async function refreshStats() {
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set('stat-network', CONFIG.network);
  try {
    if (CONFIG.poolUrl) set("stat-pool", "Cetus linked");
  } catch (_) {}
}
refreshStats();
setInterval(refreshStats, 60_000);

(() => {
  const setText = (id, text) => { const el = document.getElementById(id); if (el && text) el.textContent = text; };
  setText('contract-network', CONFIG.network);
  setText('contract-package', CONFIG.packageId);
  setText('contract-cointype', coinType());
  const ex = document.getElementById('contract-explorer');
  const pkgLink = document.getElementById('launch-package-link');
  const href = CONFIG.explorer?.package || (CONFIG.packageId ? `https://suiscan.xyz/${CONFIG.network}/object/${CONFIG.packageId}` : '');
  if (ex && href) ex.href = href;
  if (pkgLink && href) pkgLink.href = href;
})();
