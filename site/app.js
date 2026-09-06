import { getWallets } from 'https://esm.sh/@wallet-standard/app@1.1.0';
import { SuiClient, getFullnodeUrl } from 'https://esm.sh/@mysten/sui@1.39.0/client';
import { Transaction } from 'https://esm.sh/@mysten/sui@1.39.0/transactions';
import { CONFIG } from './config.js';

const ALLOWED_ACTIONS = new Set(['claim', 'transfer']);
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

const isHexId = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v);
const normalizeSuiAddress = (raw) => {
  let v = String(raw || '').trim();
  if (!v) return '';
  if (!v.startsWith('0x') && /^[0-9a-fA-F]+$/.test(v)) v = '0x' + v;
  if (!/^0x[0-9a-fA-F]+$/.test(v)) return '';
  const hex = v.slice(2);
  if (hex.length > 64) return '';
  return '0x' + hex.toLowerCase().padStart(64, '0');
};
const configured = Boolean(
  isHexId(CONFIG.packageId) &&
  isHexId(CONFIG.rewardPoolId) &&
  isHexId(CONFIG.holderRegistryId) &&
  isHexId(CONFIG.feePotId) &&
  isHexId(CONFIG.clockId)
);
const coinType = () => CONFIG.coinType || `${CONFIG.packageId}::tenmm::TENMM`;
const chain = `sui:${CONFIG.network}`;
const setStatus = (text) => { if (statusEl) statusEl.textContent = text; };
const setSendStatus = (text) => {
  const el = document.getElementById('send-status');
  if (el) el.textContent = text;
};

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

const decimalToBaseUnits = (input, decimals, label) => {
  const value = String(input || '').trim();
  if (!new RegExp(`^[0-9]+([.][0-9]{1,${decimals}})?$`).test(value)) {
    throw new Error(`Enter a ${label} amount with up to ${decimals} decimal places.`);
  }
  const parts = value.split('.');
  return BigInt(parts[0]) * (10n ** BigInt(decimals)) + BigInt(((parts[1] || '') + '0'.repeat(decimals)).slice(0, decimals));
};
const fmt10mm = (raw) => {
  try {
    const n = BigInt(raw || 0);
    const whole = n / 100000000n;
    const frac = (n % 100000000n).toString().padStart(8, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole.toString();
  } catch {
    return String(raw);
  }
};

const setActionsEnabled = (on) => {
  document.querySelectorAll('[data-action]').forEach((b) => { b.disabled = !on; });
  if ($('disconnect')) $('disconnect').disabled = !account;
};

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

async function loadHolderPrincipal(address) {
  const registry = await withRpc((c) => c.getObject({ id: CONFIG.holderRegistryId, options: { showContent: true } }));
  const fields = registry.data?.content?.fields || {};
  const totalPrincipal = fields.total_principal;
  const addresses = fields.addresses || [];
  const tableId = fields.holders?.fields?.id?.id || fields.holders?.fields?.id || fields.holders?.id;
  let principal = null;
  let owed = null;
  if (tableId) {
    try {
      const dyn = await withRpc((c) => c.getDynamicFieldObject({
        parentId: typeof tableId === 'string' ? tableId : tableId.id || tableId,
        name: { type: 'address', value: address },
      }));
      const hf = dyn.data?.content?.fields?.value?.fields || dyn.data?.content?.fields || {};
      if (hf.principal != null) principal = hf.principal;
      if (hf.owed != null) owed = hf.owed;
    } catch (_) {}
  }
  return { principal, owed, totalPrincipal, addresses, inRegistry: principal != null };
}

async function refreshSendHints() {
  const hint = document.getElementById('send-hint');
  const list = document.getElementById('holders-list');
  try {
    const addr = account?.address;
    let reg;
    if (addr) {
      const bal = await withRpc((c) => c.getBalance({ owner: addr, coinType: coinType() }));
      reg = await loadHolderPrincipal(addr);
      if (hint) {
        const tracked = reg.inRegistry ? fmt10mm(reg.principal) : '0';
        hint.innerHTML = `Wallet: <strong>${fmt10mm(bal.totalBalance || 0)} 10MM</strong> · Registry tracked: <strong>${tracked} 10MM</strong>. Official Send moves tracked principal only. DEX/Turbos buys are not auto-registered.`;
      }
    } else if (hint) {
      hint.textContent = 'Connect Slush to see wallet balance vs registry-tracked principal.';
      reg = await loadHolderPrincipal('0x0000000000000000000000000000000000000000000000000000000000000000');
    }
    if (!reg) reg = await loadHolderPrincipal(addr || '0x0000000000000000000000000000000000000000000000000000000000000000');
    if (list) {
      list.replaceChildren();
      const addrs = Array.isArray(reg.addresses) ? reg.addresses : [];
      if (!addrs.length) {
        list.textContent = 'No registered holders yet.';
      } else {
        const ul = document.createElement('ul');
        ul.style.cssText = 'margin:8px 0 0;padding-left:1.1rem;color:#9aa4b2;font-size:0.84rem';
        for (const a of addrs) {
          const li = document.createElement('li');
          let line = `${a.slice(0, 10)}…${a.slice(-6)}`;
          try {
            const row = await loadHolderPrincipal(a);
            if (row.inRegistry) line += ` · ${fmt10mm(row.principal)} 10MM`;
          } catch (_) {}
          li.textContent = line;
          ul.append(li);
        }
        list.append(ul);
        const tot = document.createElement('p');
        tot.style.cssText = 'margin:8px 0 0;color:#fdba74;font-size:0.82rem';
        tot.textContent = `Total tracked: ${fmt10mm(reg.totalPrincipal)} 10MM · ${addrs.length} holder(s)`;
        list.append(tot);
      }
    }
  } catch (e) {
    if (hint) hint.textContent = e.message || String(e);
    if (list) list.textContent = e.message || String(e);
  }
}

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
    setActionsEnabled(configured);
    window.dispatchEvent(new CustomEvent('tenmm-connected', { detail: { address: account.address } }));
    setStatus(`Connected via Slush on ${CONFIG.network}.`);
    setSendStatus('Connected. Enter recipient + amount, then Send.');
    await refreshSendHints();
  } catch (e) {
    wallet = null; account = null; setActionsEnabled(false);
    $('connect').textContent = 'Connect Slush';
    setStatus(e.message || String(e));
  }
};

$('disconnect').onclick = async () => {
  try { await wallet?.features?.['standard:disconnect']?.disconnect?.(); } catch (_) {}
  wallet = null; account = null;
  $('connect').textContent = 'Connect Slush';
  showWalletHelp(false);
  setActionsEnabled(false);
  setStatus('Disconnected from Slush.');
  setSendStatus('');
};

async function splitTenmmPayment(tx, amount) {
  const coinsResp = await withRpc((c) => c.getCoins({ owner: account.address, coinType: coinType() }));
  const spendable = (coinsResp.data || []).filter((coin) => BigInt(coin.balance) > 0n);
  if (!spendable.length) throw new Error('No 10MM coin objects found in this wallet.');
  const amountStr = amount.toString();
  const direct = spendable.find((coin) => BigInt(coin.balance) >= amount);
  let parts;
  if (direct) {
    parts = tx.splitCoins(tx.object(direct.coinObjectId), [amountStr]);
  } else {
    const total = spendable.reduce((sum, coin) => sum + BigInt(coin.balance), 0n);
    if (total < amount) throw new Error(`Insufficient wallet 10MM (have ${fmt10mm(total)}, need ${fmt10mm(amount)}).`);
    const [primary, ...others] = spendable;
    if (others.length) tx.mergeCoins(tx.object(primary.coinObjectId), others.map((c) => tx.object(c.coinObjectId)));
    parts = tx.splitCoins(tx.object(primary.coinObjectId), [amountStr]);
  }
  return Array.isArray(parts) ? parts[0] : parts;
}

function friendlyMoveError(err) {
  const msg = err?.message || String(err);
  if (/E_NOT_HOLDER|abort.*?3\b|code:?\s*3\b/i.test(msg)) {
    return 'Not in holder registry (abort 3). Only mined / official-Send balances are tracked — DEX buys are not.';
  }
  if (/E_BAD_AMOUNT|abort.*?2\b|code:?\s*2\b/i.test(msg)) {
    return 'Amount exceeds registry-tracked principal (abort 2). Lower the amount.';
  }
  if (/E_BAD_RECIPIENT|abort.*?1\b|code:?\s*1\b/i.test(msg)) return 'Invalid recipient (abort 1).';
  if (/JSON-RPC|Method not found|deprecated/i.test(msg)) return 'Sui RPC rejected the request. Try again — we rotate endpoints.';
  return msg;
}

async function call(action) {
  try {
    if (!ALLOWED_ACTIONS.has(action)) return setStatus('Blocked: unknown action.');
    if (!wallet || !account) return setSendStatus('Connect Slush first.');
    if (!configured) return setStatus('Package IDs missing in config.');

    const tx = new Transaction();
    tx.setSender(account.address);
    const target = `${CONFIG.packageId}::tenmm::${action === 'transfer' ? 'protocol_transfer' : action}`;

    if (action === 'claim') {
      tx.moveCall({
        target,
        arguments: [tx.object(CONFIG.rewardPoolId), tx.object(CONFIG.holderRegistryId), tx.object(CONFIG.clockId)],
      });
      setStatus('Approve claim in Slush…');
    } else if (action === 'transfer') {
      const recipient = normalizeSuiAddress(document.getElementById('sendRecipient')?.value);
      if (!recipient) return setSendStatus('Enter a valid recipient Sui address (0x…).');
      let amount;
      try { amount = decimalToBaseUnits(document.getElementById('sendAmount')?.value, 8, '10MM'); }
      catch (e) { return setSendStatus(e.message || String(e)); }
      if (amount <= 0n) return setSendStatus('Enter a 10MM amount greater than zero.');

      setSendStatus('Checking registry + building transfer…');
      const reg = await loadHolderPrincipal(account.address);
      if (!reg.inRegistry) {
        return setSendStatus('Wallet not in holder registry. Mine with this wallet or receive via official Send first. DEX buys do not register.');
      }
      if (BigInt(reg.principal || 0) < amount) {
        return setSendStatus(`Exceeds tracked principal (${fmt10mm(reg.principal)} 10MM). Wallet may hold more untracked coins.`);
      }

      const payment = await splitTenmmPayment(tx, amount);
      tx.moveCall({
        target,
        arguments: [
          tx.object(CONFIG.rewardPoolId),
          tx.object(CONFIG.holderRegistryId),
          payment,
          tx.pure.address(recipient),
          tx.object(CONFIG.clockId),
        ],
      });
      setSendStatus('Approve transfer in your Slush popup…');
    }

    let result;
    if (wallet.features['sui:signAndExecuteTransaction']?.signAndExecuteTransaction) {
      result = await wallet.features['sui:signAndExecuteTransaction'].signAndExecuteTransaction({
        transaction: tx,
        account,
        chain,
        options: { showEffects: true },
      });
    } else if (wallet.features['sui:signAndExecuteTransactionBlock']?.signAndExecuteTransactionBlock) {
      result = await wallet.features['sui:signAndExecuteTransactionBlock'].signAndExecuteTransactionBlock({
        transactionBlock: tx,
        account,
        chain,
      });
    } else {
      throw new Error('Slush cannot sign Sui transactions.');
    }

    const digest = result.digest || 'see wallet activity';
    const status = result.effects?.status?.status || result.effects?.status;
    if (status && status !== 'success') {
      throw new Error(result.effects?.status?.error || 'Transaction failed on-chain');
    }
    if (action === 'transfer') {
      setSendStatus(`Sent. Digest: ${digest}`);
      await refreshSendHints();
      window.dispatchEvent(new CustomEvent('tenmm-connected', { detail: { address: account.address } }));
    } else {
      setStatus(`Submitted. Digest: ${digest}`);
    }
  } catch (e) {
    const msg = friendlyMoveError(e);
    if (action === 'transfer') setSendStatus(msg);
    else setStatus(msg);
  }
}

document.querySelectorAll('[data-action]').forEach((b) => {
  b.onclick = (ev) => {
    ev.preventDefault();
    if (b.disabled) {
      setSendStatus('Connect Slush first, then try again.');
      return;
    }
    call(b.dataset.action);
  };
});

setActionsEnabled(false);

async function refreshStats() {
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set('stat-network', CONFIG.network);
  try {
    if (isHexId(CONFIG.holderRegistryId)) {
      const obj = await withRpc((c) => c.getObject({ id: CONFIG.holderRegistryId, options: { showContent: true } }));
      const f = obj.data?.content?.fields || {};
      const n = Array.isArray(f.addresses) ? f.addresses.length : (f.holders?.fields?.size ?? f.holders?.size);
      set('stat-holders', n != null ? `${n} registered` : 'Registry live');
      await refreshSendHints();
    }
    if (CONFIG.turbosTradeUrl || CONFIG.turbosPoolId) {
      set('stat-pool', 'Cetus + Turbos');
    } else if (CONFIG.poolUrl) {
      set('stat-pool', 'Cetus linked');
    }
  } catch (_) {
    set('stat-holders', 'Registry lookup pending');
  }
}
refreshStats();
setInterval(refreshStats, 60_000);
document.getElementById('refresh-holders')?.addEventListener('click', () => refreshSendHints());

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
