  import { getWallets } from 'https://esm.sh/@wallet-standard/app@1.1.0';
  import { SuiClient, getFullnodeUrl } from 'https://esm.sh/@mysten/sui@1.39.0/client';
  import { Transaction } from 'https://esm.sh/@mysten/sui@1.39.0/transactions';
  import { CONFIG } from './config.js';

  const ALLOWED_ACTIONS = new Set(['claim', 'transfer']);
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  $("hero-connect").onclick = () => $("connect").click();
  const walletStore = getWallets();
  const walletHelpEl = document.getElementById('wallet-help');
  const openSlushEl = document.getElementById('open-slush');
  let wallet = null;
  let account = null;
  let availableWallet = null;

  const slushBrowseUrl = () => 'https://my.slush.app/browse/' + encodeURIComponent(window.location.href);
  if (openSlushEl) openSlushEl.href = slushBrowseUrl();
  const showWalletHelp = (show) => { if (walletHelpEl) walletHelpEl.hidden = !show; };

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
  // Initialize the embedded terminal with the live SUI/10MM pair. The fallback
  // links stay available if a browser blocks the CDN or the terminal cannot lock tokens.
  const buyLink = document.getElementById('cetus-buy-link');
  const sellLink = document.getElementById('cetus-sell-link');
  if (buyLink) buyLink.href = cetusBuyUrl || '#';
  if (sellLink) sellLink.href = cetusSellUrl || '#';
  try {
    if (!window.CetusSwap?.init) throw new Error('Cetus Terminal is unavailable. Use a fallback link below.');
    window.CetusSwap.init({
      containerId: 'cetus-terminal',
      displayMode: 'Integrated',
      independentWallet: true,
      themeType: 'Light',
      defaultSlippage: 1,
      defaultFromToken: '0x2::sui::SUI',
      defaultToToken: CONFIG.coinType || `${CONFIG.packageId}::tenmm::TENMM`,
      poolAddress: CONFIG.poolId,
    });
  } catch (e) {
    setStatus(e.message || 'Cetus Terminal failed to load. Use a fallback link below.');
  }
  const decimalToMist = (input) => { const value = String(input || '').trim(); if (!/^[0-9]+([.][0-9]{1,9})?$/.test(value)) throw new Error('Enter a SUI amount with up to 9 decimal places.'); const parts = value.split('.'); return BigInt(parts[0]) * 1000000000n + BigInt(((parts[1] || '') + '000000000').slice(0, 9)); };
  const decimalToBaseUnits = (input, decimals, label) => { const value = String(input || "").trim(); const pattern = new RegExp("^[0-9]+([.][0-9]{1," + decimals + "})?" + String.fromCharCode(36)); if (!pattern.test(value)) throw new Error("Enter a " + label + " amount with up to " + decimals + " decimal places."); const parts = value.split("."); return BigInt(parts[0]) * (10n ** BigInt(decimals)) + BigInt(((parts[1] || "") + "0".repeat(decimals)).slice(0, decimals)); };
  const setActionsEnabled = (on) => {
    document.querySelectorAll('[data-action]').forEach((b) => {
      b.disabled = !on;
    });
    $('disconnect').disabled = !account;
  };

  function walletBlob(w) {
    return `${w?.name || ''} ${w?.id || ''}`.toLowerCase();
  }

  function isBinanceWallet(w) {
    return /binance/.test(walletBlob(w));
  }

  function isSlushWallet(w) {
    const blob = walletBlob(w);
    if (isBinanceWallet(w)) return false;
    // Slush (formerly Mysten / Sui Wallet)
    return /slush|mysten|\bsui wallet\b/.test(blob);
  }

  function listSuiWallets() {
    return walletStore.get().filter((w) =>
      Array.isArray(w.chains) && w.chains.includes(chain) &&
      w.features?.['standard:connect'] &&
      (w.features?.['sui:signAndExecuteTransaction'] || w.features?.['sui:signAndExecuteTransactionBlock'])
    );
  }

  function pickWallet() {
    // Only Slush — never auto-pick Binance or other Wallet Standard wallets.
    const slush = listSuiWallets().find(isSlushWallet) || null;
    availableWallet = slush;
    return slush;
  }

  // Wallets can register after page load, especially in a mobile wallet browser.
  const refreshWallets = () => {
    const next = pickWallet();
    if (next && !wallet && walletHelpEl && !walletHelpEl.hidden) {
      showWalletHelp(false);
      setStatus('Slush detected. Tap Connect Slush to continue.');
    }
    return next;
  };
  walletStore.on('register', refreshWallets);
  walletStore.on('unregister', refreshWallets);
  refreshWallets();

  $('connect').onclick = async () => {
    try {
      if (CONFIG.network !== 'mainnet') {
        throw new Error('10MinMine is configured for Sui mainnet only.');
      }
      const detected = listSuiWallets().map((w) => w.name || w.id || 'unknown');
      wallet = pickWallet();
      if (!wallet) {
        showWalletHelp(true);
        const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
        const found = detected.length
          ? `Detected: ${detected.join(', ')}.`
          : 'No Wallet Standard wallets detected.';
        throw new Error(
          mobile
            ? `${found} This site only connects to Slush (not Binance). Open the page inside the Slush app browser, then tap Connect Slush.`
            : `${found} This site only connects to Slush (not Binance). Install/unlock the Slush extension, then click Connect Slush.`
        );
      }
      showWalletHelp(false);
      const result = await wallet.features['standard:connect'].connect();
      account = result.accounts?.find((a) => !a.chains || a.chains.includes(chain)) || result.accounts?.[0];
      if (!account?.address || !/^0x[0-9a-fA-F]+$/.test(account.address)) throw new Error('Wallet did not return a valid account.');
      $('connect').textContent = `${account.address.slice(0, 6)}…${account.address.slice(-4)}`;
      setActionsEnabled(configured); window.dispatchEvent(new CustomEvent('tenmm-connected', { detail: { address: account.address } }));
      setStatus(configured
        ? `Connected via Slush on ${CONFIG.network}. Approve each action in the Slush popup.`
        : `Connected via Slush on ${CONFIG.network}. Package IDs still blank — trading disabled until configured.`);
    } catch (e) {
      wallet = null; account = null; setActionsEnabled(false);
      $('connect').textContent = 'Connect Slush';
      setStatus(e.message || String(e));
    }
  };

  $('disconnect').onclick = async () => {
    try {
      const disc = wallet?.features?.['standard:disconnect'];
      if (disc) await disc.disconnect();
    } catch (_) { /* ignore */ }
    wallet = null; account = null;
    $('connect').textContent = 'Connect Slush';
    showWalletHelp(false);
    setActionsEnabled(false);
    setStatus('Disconnected from Slush. Keys never left your wallet.');
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
      if (!wallet || !account) return setStatus('Connect Slush first.');
      if (!configured) return setStatus('Configure verified package/object IDs in site/config.js first.');
      const signFeat = wallet.features['sui:signAndExecuteTransaction'] || wallet.features['sui:signAndExecuteTransactionBlock'];
      if (!signFeat) return setStatus('Slush cannot sign Sui transactions.');

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

  // Claim and Send remain gated by the existing Slush connection.
  setActionsEnabled(false);

  // Launch confetti (once per session)
  async function celebrateLaunch() {
    try {
      if (sessionStorage.getItem('tenmm-launch-confetti')) return;
      const mod = await import('https://esm.sh/canvas-confetti@1.9.3');
      const confetti = mod.default;
      const canvas = document.getElementById('confetti-canvas');
      if (canvas) confetti.create(canvas, { resize: true, useWorker: true })({
        particleCount: 160,
        spread: 70,
        origin: { y: 0.25 },
        colors: ['#ea580c', '#fb923c', '#fdba74', '#ffffff', '#111111'],
      });
      else confetti({ particleCount: 160, spread: 70, origin: { y: 0.25 }, colors: ['#ea580c', '#fb923c', '#fdba74', '#ffffff', '#111111'] });
      setTimeout(() => confetti({ particleCount: 80, angle: 60, spread: 55, origin: { x: 0 } }), 250);
      setTimeout(() => confetti({ particleCount: 80, angle: 120, spread: 55, origin: { x: 1 } }), 400);
      sessionStorage.setItem('tenmm-launch-confetti', '1');
    } catch (_) { /* ignore */ }
  }
  celebrateLaunch();

  // Fill contract panel from CONFIG when present
  (() => {
    const setText = (id, text) => { const el = document.getElementById(id); if (el && text) el.textContent = text; };
    setText('contract-network', CONFIG.network);
    setText('contract-package', CONFIG.packageId);
    setText('contract-cointype', CONFIG.coinType || (CONFIG.packageId ? `${CONFIG.packageId}::tenmm::TENMM` : ''));
    const ex = document.getElementById('contract-explorer');
    const pkgLink = document.getElementById('launch-package-link');
    const href = CONFIG.explorer?.package || (CONFIG.packageId ? `https://suiscan.xyz/${CONFIG.network}/object/${CONFIG.packageId}` : '');
    if (ex && href) { ex.href = href; }
    if (pkgLink && href) { pkgLink.href = href; }
  })();

