  import { SuiClient, getFullnodeUrl } from 'https://esm.sh/@mysten/sui@1.39.0/client';
  import { CONFIG } from '../config.js';

  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const client = new SuiClient({ url: getFullnodeUrl(CONFIG.network) });
  const DECIMALS = 9; // SUI
  const TENMM_DECIMALS = 8;

  const isAddr = (a) => /^0x[0-9a-fA-F]+$/.test(a) && a.length >= 3;
  const fmt = (raw, decimals) => {
    try {
      const n = BigInt(raw || 0);
      const base = 10n ** BigInt(decimals);
      const whole = n / base;
      const frac = (n % base).toString().padStart(decimals, '0').replace(/0+$/, '');
      return frac ? `${whole}.${frac}` : whole.toString();
    } catch {
      return '—';
    }
  };

  function coinType() {
    if (CONFIG.coinType) return CONFIG.coinType;
    if (CONFIG.packageId) return `${CONFIG.packageId}::tenmm::TENMM`;
    return '';
  }

  async function suiBalance(address) {
    const b = await client.getBalance({ owner: address, coinType: '0x2::sui::SUI' });
    return b.totalBalance || '0';
  }

  async function tenmmBalance(address) {
    const type = coinType();
    if (!type) return { value: null, note: 'Set packageId in config.js' };
    const b = await client.getBalance({ owner: address, coinType: type });
    return { value: b.totalBalance || '0', note: '' };
  }

  $('clear').onclick = () => {
    $('addresses').value = '';
    $('tbody').innerHTML = '';
    $('results').hidden = true;
    statusEl.textContent = '';
  };

  $('lookup').onclick = async () => {
    const asset = $('asset').value;
    const lines = $('addresses').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const unique = [...new Set(lines)];
    if (!unique.length) return statusEl.textContent = 'Enter at least one address.';
    if (unique.length > 50) return statusEl.textContent = 'Max 50 addresses per lookup.';
    const bad = unique.filter((a) => !isAddr(a));
    if (bad.length) return statusEl.textContent = `Invalid address format: ${bad[0]}`;

    statusEl.textContent = `Looking up ${unique.length} address(es) on ${CONFIG.network}…`;
    $('tbody').innerHTML = '';
    $('results').hidden = false;

    let i = 0;
    for (const address of unique) {
      i += 1;
      let tenmm = '—';
      let sui = '—';
      let note = '';
      try {
        if (asset === 'sui' || asset === 'both') {
          sui = fmt(await suiBalance(address), DECIMALS);
        }
        if (asset === '10mm' || asset === 'both') {
          const r = await tenmmBalance(address);
          if (r.value == null) { tenmm = '—'; note = r.note; }
          else tenmm = fmt(r.value, TENMM_DECIMALS);
        }
      } catch (e) {
        note = e.message || String(e);
      }
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${i}</td><td class="mono">${address}</td><td>${tenmm}</td><td>${sui}</td><td>${note}</td>`;
      $('tbody').appendChild(tr);
    }
    statusEl.textContent = `Done · ${CONFIG.network}${coinType() ? '' : ' · 10MM packageId not set yet'}`;
  };
