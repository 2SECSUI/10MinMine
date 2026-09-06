  import { getWallets } from 'https://esm.sh/@wallet-standard/app@1.1.0';
  import { SuiClient, getFullnodeUrl } from 'https://esm.sh/@mysten/sui@1.39.0/client';
  import { Transaction } from 'https://esm.sh/@mysten/sui@1.39.0/transactions';
  import { CONFIG } from './config.js';

  const ALLOWED_ACTIONS = new Set(['claim', 'buy', 'sell', 'transfer']);
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  $("hero-connect").onclick = () => $("connect").click();
  let wallet = null;
  let account = null;

  const isHexId = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v);
  const configured = Boolean(
    isHexId(CONFIG.packageId) &&
    isHexId(CONFIG.rewardPoolId) &&
    isHexId(CONFIG.holderRegistryId) &&
    isHexId(CONFIG.feePotId) &&
    isHexId(CONFIG.clockId)
  );
  const cetusBuyUrl = CONFIG.cetusBuyUrl || CONFIG.poolUrl || '';
  const cetusSellUrl = CONFIG.cetusSellUrl || CONFIG.poolUrl || '';

  const chain = `sui:${CONFIG.network}`;
  const setStatus = (text) => { statusEl.textContent = text; };
  const decimalToMist = (input) => { const value = String(input || '').trim(); if (!/^[0-9]+([.][0-9]{1,9})?$/.test(value)) throw new Error('Enter a SUI amount with up to 9 decimal places.'); const parts = value.split('.'); return BigInt(parts[0]) * 1000000000n + BigInt(((parts[1] || '') + '000000000').slice(0, 9)); };
  const decimalToBaseUnits = (input, decimals, label) => { const value = String(input || "").trim(); const pattern = new RegExp("^[0-9]+([.][0-9]{1," + decimals + "})?" + String.fromCharCode(36)); if (!pattern.test(value)) throw new Error("Enter a " + label + " amount with up to " + decimals + " decimal places."); const parts = value.split("."); return BigInt(parts[0]) * (10n ** BigInt(decimals)) + BigInt(((parts[1] || "") + "0".repeat(decimals)).slice(0, decimals)); };
  const setActionsEnabled = (on) => {
    document.querySelectorAll('[data-action]').forEach((b) => {
      const action = b.dataset.action;
      if ((action === 'buy' && cetusBuyUrl) || (action === 'sell' && cetusSellUrl)) {
        b.disabled = false;
        return;
      }
      b.disabled = !on;
    });
    $('disconnect').disabled = !account;
  };

  function pickWallet() {
    const wallets = getWallets().get().filter((w) =>
      Array.isArray(w.chains) && w.chains.includes(chain) &&
      w.features?.['standard:connect'] &&
      w.features?.['sui:signAndExecuteTransaction']
    );
    return wallets[0] || null;
  }

  $('connect').onclick = async () => {
    try {
      if (!['testnet', 'mainnet', 'devnet', 'localnet'].includes(CONFIG.network)) {
        throw new Error('Invalid network in config.js');
      }
      wallet = pickWallet();
      if (!wallet) throw new Error(`No Sui wallet found for ${chain}. Install Slush (or another Wallet Standard wallet) for that network.`);
      const result = await wallet.features['standard:connect'].connect();
      account = result.accounts?.find((a) => !a.chains || a.chains.includes(chain)) || result.accounts?.[0];
      if (!account?.address || !/^0x[0-9a-fA-F]+$/.test(account.address)) throw new Error('Wallet did not return a valid account.');
      $('connect').textContent = `${account.address.slice(0, 6)}…${account.address.slice(-4)}`;
      setActionsEnabled(configured); window.dispatchEvent(new CustomEvent('tenmm-connected', { detail: { address: account.address } }));
      setStatus(configured
        ? `Connected on ${CONFIG.network}. Approve each action in your wallet popup.`
        : `Connected on ${CONFIG.network}. Package IDs still blank — trading disabled until configured.`);
    } catch (e) {
      wallet = null; account = null; setActionsEnabled(false);
      $('connect').textContent = 'Connect Sui wallet';
      setStatus(e.message || String(e));
    }
  };

  $('disconnect').onclick = async () => {
    try {
      const disc = wallet?.features?.['standard:disconnect'];
      if (disc) await disc.disconnect();
    } catch (_) { /* ignore */ }
    wallet = null; account = null;
    $('connect').textContent = 'Connect Sui wallet';
    setActionsEnabled(false);
    setStatus('Disconnected. Keys never left your wallet extension.');
  };

  async function splitTenmmPayment(tx, amount) {
    const coins = await client.getCoins({ owner: account.address, coinType: CONFIG.packageId + "::tenmm::TENMM" });
    const spendable = (coins.data || []).filter((coin) => BigInt(coin.balance) > 0n);
    if (!spendable.length) throw new Error("No 10MM coin found in this wallet.");
    const direct = spendable.find((coin) => BigInt(coin.balance) >= amount);
    if (direct) return tx.splitCoins(tx.object(direct.coinObjectId), [amount]);
    const total = spendable.reduce((sum, coin) => sum + BigInt(coin.balance), 0n);
    if (total < amount) throw new Error("Insufficient 10MM balance.");
    const [primary, ...others] = spendable;
    if (others.length) tx.mergeCoins(tx.object(primary.coinObjectId), others.map((coin) => tx.object(coin.coinObjectId)));
    return tx.splitCoins(tx.object(primary.coinObjectId), [amount]);
  }

  async function call(action) {
    try {
      if (!ALLOWED_ACTIONS.has(action)) return setStatus('Blocked: unknown action.');
      if (action === 'buy') {
        if (!cetusBuyUrl) return setStatus('Cetus buy link not configured.');
        window.open(cetusBuyUrl, '_blank', 'noopener,noreferrer');
        return setStatus('Opened Cetus to buy 10MM with SUI. Complete the swap in the Cetus dapp.');
      }
      if (action === 'sell') {
        if (!cetusSellUrl) return setStatus('Cetus sell link not configured.');
        window.open(cetusSellUrl, '_blank', 'noopener,noreferrer');
        return setStatus('Opened Cetus to sell 10MM for SUI. Complete the swap in the Cetus dapp.');
      }
      if (!wallet || !account) return setStatus('Connect a wallet first.');
      if (!configured) return setStatus('Configure verified package/object IDs in site/config.js first.');
      if (!wallet.features['sui:signAndExecuteTransaction']) return setStatus('Wallet cannot sign Sui transactions.');

      const tx = new Transaction();
      const targetAction = action === "transfer" ? "protocol_transfer" : action;
      const target = `${CONFIG.packageId}::tenmm::${targetAction}`;
      if (action === 'claim') {
        tx.moveCall({
          target,
          arguments: [
            tx.object(CONFIG.rewardPoolId),
            tx.object(CONFIG.holderRegistryId),
            tx.object(CONFIG.clockId),
          ],
        });
      } else if (action === "transfer") {
        const recipient = document.getElementById("sendRecipient").value.trim();
        if (!isHexId(recipient)) return setStatus("Enter a valid recipient Sui address.");
        const amount = decimalToBaseUnits(document.getElementById("sendAmount").value, 8, "10MM");
        if (amount <= 0n) return setStatus("Enter a 10MM amount greater than zero.");
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
      }

      setStatus('Approve in your wallet popup if the network and contract look correct…');
      const result = await wallet.features['sui:signAndExecuteTransaction'].signAndExecuteTransaction({
        transaction: tx,
        account,
        chain,
      });
      setStatus(`Submitted on ${CONFIG.network}. Digest: ${result.digest || 'see wallet activity'}`);
    } catch (e) {
      setStatus(e.message || String(e));
    }
  }

  document.querySelectorAll('[data-action]').forEach((b) => {
    b.onclick = () => call(b.dataset.action);
  });

  const client = new SuiClient({ url: getFullnodeUrl(CONFIG.network) });
  window.tenMinMineClient = client;

  // Progressive live stats — safe no-ops until IDs exist
  async function refreshStats() {
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('stat-network', CONFIG.network);
    if (!isHexId(CONFIG.packageId)) return;
    try {
      if (isHexId(CONFIG.rewardPoolId)) {
        const obj = await client.getObject({ id: CONFIG.rewardPoolId, options: { showContent: true } });
        const fields = obj.data?.content?.fields || {};
        const subsidy = fields.current_subsidy ?? fields.subsidy ?? null;
        const height = fields.block_height ?? fields.height ?? null;
        set('stat-reward', subsidy != null ? `${subsidy} base units / block · height ${height ?? '—'}` : 'Connected · parsing fields…');
      }
      if (isHexId(CONFIG.holderRegistryId)) {
        const obj = await client.getObject({ id: CONFIG.holderRegistryId, options: { showContent: true } });
        const fields = obj.data?.content?.fields || {};
        const n = fields.holder_count ?? fields.size ?? fields.num_holders;
        set('stat-holders', n != null ? String(n) : 'Registry live · count field TBD');
      }
      if (isHexId(CONFIG.feePotId)) {
        const obj = await client.getObject({ id: CONFIG.feePotId, options: { showContent: true } });
        const fields = obj.data?.content?.fields || {};
        const bal = fields.balance ?? fields.sui_balance;
        set('stat-feepot', bal != null ? String(bal) : 'Fee pot live');
      }
      if (CONFIG.poolUrl) {
        set('stat-pool', 'Linked');
        const el = document.getElementById('stat-pool');
        if (el) el.innerHTML = `<a href="${CONFIG.poolUrl}" target="_blank" rel="noopener noreferrer">Open pool</a>`;
      } else if (CONFIG.poolId) {
        set('stat-pool', CONFIG.poolId.slice(0, 10) + '…');
      }
      set('stat-price', CONFIG.poolId || CONFIG.poolUrl ? 'Wire price feed after LP' : 'Pending LP');
    } catch (e) {
      set('stat-reward', 'Awaiting live objects');
    }
  }
  refreshStats();
  setInterval(refreshStats, 60_000);

  // Buy/Sell open Cetus without a prior site wallet connect.
  setActionsEnabled(Boolean(cetusBuyUrl || cetusSellUrl));
