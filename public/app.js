let latestStatus;
let setupConfig = { xSources: [], telegramSources: [], configured: {} };

function dateTime(value) {
  return value ? new Date(value).toLocaleString() : 'Never';
}

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = value || '';
  return element.innerHTML;
}

function render(status) {
  latestStatus = status;
  const providers = Object.entries(status.providers || {});
  const connected = providers.filter(([, provider]) => provider.connected).length;
  const hasError = status.errors.length > 0;

  document.querySelector('#liveDot').className = `status-dot ${hasError ? 'error' : connected ? '' : 'idle'}`;
  document.querySelector('#liveLabel').textContent = connected ? `${connected} provider${connected === 1 ? '' : 's'} live` : 'Waiting for setup';
  document.querySelector('#liveMode').textContent = hasError ? 'Connection needs attention' : connected ? 'Listening for new posts' : 'Credentials not configured';

  document.querySelector('#providerCards').innerHTML = providers.map(([name, provider]) => {
    const configured = status.sources.some(source => source.network === name && source.configured);
    return `
    <article class="provider-card">
      <span class="provider-icon"><i class="fa-brands ${name === 'X' ? 'fa-x-twitter' : 'fa-telegram'}"></i></span>
      <div><strong>${name}</strong><small>${escapeHtml(provider.mode)} · Last success: ${dateTime(provider.lastSuccess)}</small></div>
      <span class="provider-state ${provider.connected ? 'connected' : ''}">${provider.connected ? 'Connected' : configured ? 'Connecting' : 'Needs setup'}</span>
    </article>`;
  }).join('');

  document.querySelector('#stats').innerHTML = `
    <div><strong>${dateTime(status.lastPoll)}</strong><span>Last successful provider check</span></div>
    <div><strong>${dateTime(status.lastAlert)}</strong><span>Last SMS alert / ping</span></div>
    <div><strong>${status.smsConfigured || status.discordConfigured ? 'Ready' : 'Needs setup'}</strong><span>Alert delivery</span></div>`;

  document.querySelector('#postCount').textContent = `${status.posts.length} post${status.posts.length === 1 ? '' : 's'}`;
  document.querySelector('#posts').innerHTML = status.posts.length ? status.posts.map(post => `
    <article class="post">
      <span class="post-icon"><i class="fa-brands ${post.network === 'X' ? 'fa-x-twitter' : 'fa-telegram'}"></i></span>
      <div><div class="post-meta"><strong>${escapeHtml(post.source)}</strong><span>${escapeHtml(post.network)}</span></div><p>${escapeHtml(post.text)}</p></div>
      <a href="${escapeHtml(post.link)}" target="_blank" rel="noreferrer" title="Open post"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
    </article>`).join('') : '<div class="empty"><i class="fa-solid fa-satellite-dish"></i><p>No posts detected yet. Live updates will appear here.</p></div>';

  document.querySelector('#sources').innerHTML = status.sources.map(source => `
    <div class="source"><span class="source-icon"><i class="fa-brands ${source.network === 'X' ? 'fa-x-twitter' : 'fa-telegram'}"></i></span><a href="${escapeHtml(source.link)}" target="_blank" rel="noreferrer">${escapeHtml(source.link)}</a><small class="${source.configured ? 'ready' : ''}">${source.configured ? 'API ready' : 'Needs credentials'}</small></div>`).join('');
  renderMarkets(status.marketSnapshots || []);
  renderRisk(status.marketSnapshots || []);
}

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.nav-item,.view').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  document.querySelector(`#${button.dataset.view}View`).classList.add('active');
  document.querySelector('#pageName').textContent = button.textContent.trim();
}));

function sourceName(source) {
  return source.replace(/\/$/, '').split('/').pop();
}

function renderSetup() {
  document.querySelector('#xStreamEnabled').checked = setupConfig.xStreamEnabled;
  document.querySelector('#telegramPrivateChatId').value = setupConfig.telegramPrivateChatId || '';
  document.querySelector('#xConfigured').textContent = setupConfig.configured.x ? 'Configured' : 'Not configured';
  document.querySelector('#telegramConfigured').textContent = setupConfig.configured.telegram ? 'Configured' : 'Not configured';
  document.querySelector('#twilioConfigured').textContent = setupConfig.configured.twilio ? 'Configured' : 'Not configured';
  document.querySelector('#discordConfigured').textContent = setupConfig.configured.discord ? 'Configured' : 'Not configured';

  const secretFields = ['xBearerToken', 'telegramBotToken', 'twilioAccountSid', 'twilioAuthToken', 'twilioFromNumber', 'smsToNumber', 'discordWebhookUrl'];
  secretFields.forEach(id => {
    const input = document.querySelector(`#${id}`);
    input.value = '';
    input.placeholder = setupConfig.configured[id] ? 'Saved locally — enter a new value to replace' : id.includes('Number') ? '+15551234567' : 'Paste to save locally';
  });

  document.querySelector('#xSourceEditor').innerHTML = setupConfig.xSources.map((source, index) => `<span class="source-chip"><i class="fa-brands fa-x-twitter"></i>${escapeHtml(sourceName(source))}<button type="button" data-remove-source="x" data-index="${index}" title="Remove"><i class="fa-solid fa-xmark"></i></button></span>`).join('');
  document.querySelector('#telegramSourceEditor').innerHTML = setupConfig.telegramSources.map((source, index) => `<span class="source-chip"><i class="fa-brands fa-telegram"></i>${escapeHtml(sourceName(source))}<button type="button" data-remove-source="telegram" data-index="${index}" title="Remove"><i class="fa-solid fa-xmark"></i></button></span>`).join('');
  document.querySelector('#coinEditor').innerHTML = (setupConfig.coinWatchlist || []).map((coin, index) => `<span class="source-chip"><i class="fa-solid fa-coins"></i>${escapeHtml(coin)}<button type="button" data-remove-coin data-index="${index}" title="Remove"><i class="fa-solid fa-xmark"></i></button></span>`).join('');
}

function money(value) {
  if (value === null || value === undefined) return 'Unavailable';
  if (Math.abs(value) < 0.01) return `$${Number(value).toPrecision(4)}`;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', notation: Math.abs(value) >= 1000000 ? 'compact' : 'standard', maximumFractionDigits: 2 }).format(value);
}

function pairAge(value) {
  if (!value) return 'Unavailable';
  const days = Math.max(0, Math.floor((Date.now() - value) / 86400000));
  return days === 0 ? 'Less than 1 day' : `${days} day${days === 1 ? '' : 's'}`;
}

function renderMarkets(markets) {
  const target = document.querySelector('#marketSnapshots');
  if (!target) return;
  target.innerHTML = markets.length ? markets.map(market => market.error ? `
    <article class="market-card"><strong>${escapeHtml(market.coin)}</strong><span class="market-error">${escapeHtml(market.error)}</span><small>Updated ${dateTime(market.updatedAt)}</small></article>` : `
    <article class="market-card"><div><strong>${escapeHtml(market.symbol)}</strong><span>${escapeHtml(market.name)} · ${escapeHtml(market.dex || 'DEX')}</span></div><dl><div><dt>Price</dt><dd>${money(market.priceUsd)}</dd></div><div><dt>24h change</dt><dd>${market.change24h === null ? 'Unavailable' : `${market.change24h}%`}</dd></div><div><dt>24h volume</dt><dd>${money(market.volume24h)}</dd></div><div><dt>Liquidity</dt><dd>${money(market.liquidityUsd)}</dd></div><div><dt>Market cap / FDV</dt><dd>${money(market.marketCap)} / ${money(market.fdv)}</dd></div><div><dt>Pair age</dt><dd>${pairAge(market.pairCreatedAt)}</dd></div></dl><small>Updated ${dateTime(market.updatedAt)}</small></article>`).join('') : '<p class="market-empty">Add a coin to load a public market snapshot.</p>';
}

function renderRisk(markets) {
  const asset = document.querySelector('#buyAsset').value.trim().toUpperCase();
  const market = markets.find(item => item.coin.toUpperCase() === asset || item.symbol?.toUpperCase() === asset);
  const summary = document.querySelector('#riskSummary');
  if (!market || market.error) {
    summary.innerHTML = '<strong>Market-risk context</strong><span>Informational only. Insufficient observable data for this asset; no trade conclusion is provided.</span>';
    return;
  }
  const flags = [];
  if (market.liquidityUsd === null || market.liquidityUsd === undefined) flags.push('Liquidity data is unavailable.');
  else if (market.liquidityUsd < 100000) flags.push('Liquidity is below $100,000, so price impact may be higher.');
  if (market.change24h === null || market.change24h === undefined) flags.push('Recent price-change data is unavailable.');
  else if (Math.abs(market.change24h) >= 20) flags.push('The absolute 24-hour price change is at least 20%, indicating high recent volatility.');
  if (!market.pairCreatedAt) flags.push('Pair age is unavailable.');
  else if (Date.now() - market.pairCreatedAt < 7 * 86400000) flags.push('The selected pair is less than 7 days old.');
  if (!flags.length) flags.push('None of the displayed low-liquidity, high-volatility, new-pair, or missing-data flags were triggered.');
  summary.innerHTML = `<strong>Market-risk context</strong><span>Informational only—not a recommendation or personalized advice. ${escapeHtml(flags.join(' '))}</span>`;
}

async function loadConfig() {
  const response = await fetch('/api/config');
  setupConfig = await response.json();
  renderSetup();
}

function addSource(network) {
  const input = document.querySelector(network === 'x' ? '#newXSource' : '#newTelegramSource');
  const value = input.value.trim();
  if (!value) return;
  const list = network === 'x' ? setupConfig.xSources : setupConfig.telegramSources;
  list.push(value);
  input.value = '';
  renderSetup();
}

document.querySelectorAll('[data-add-source]').forEach(button => button.addEventListener('click', () => addSource(button.dataset.addSource)));
document.querySelector('#addCoin').addEventListener('click', () => {
  const input = document.querySelector('#newCoin');
  if (!input.value.trim()) return;
  setupConfig.coinWatchlist ||= [];
  setupConfig.coinWatchlist.push(input.value.trim());
  input.value = '';
  renderSetup();
});
document.querySelectorAll('[data-setup-panel]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-setup-panel],.setup-section').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  document.querySelector(`#${button.dataset.setupPanel}`).classList.add('active');
}));
document.querySelector('#setupForm').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-source]');
  const coinButton = event.target.closest('[data-remove-coin]');
  if (coinButton) {
    setupConfig.coinWatchlist.splice(Number(coinButton.dataset.index), 1);
    renderSetup();
    return;
  }
  if (!button) return;
  const list = button.dataset.removeSource === 'x' ? setupConfig.xSources : setupConfig.telegramSources;
  list.splice(Number(button.dataset.index), 1);
  renderSetup();
});

document.querySelector('#setupForm').addEventListener('submit', async event => {
  event.preventDefault();
  const errorBox = document.querySelector('#setupError');
  errorBox.hidden = true;
  const body = {
    xSources: setupConfig.xSources,
    telegramSources: setupConfig.telegramSources,
    xStreamEnabled: document.querySelector('#xStreamEnabled').checked,
    telegramPrivateChatId: document.querySelector('#telegramPrivateChatId').value,
    coinWatchlist: setupConfig.coinWatchlist || [],
    xBearerToken: document.querySelector('#xBearerToken').value,
    telegramBotToken: document.querySelector('#telegramBotToken').value,
    twilioAccountSid: document.querySelector('#twilioAccountSid').value,
    twilioAuthToken: document.querySelector('#twilioAuthToken').value,
    twilioFromNumber: document.querySelector('#twilioFromNumber').value,
    smsToNumber: document.querySelector('#smsToNumber').value,
    discordWebhookUrl: document.querySelector('#discordWebhookUrl').value,
    clearDiscordWebhook: document.querySelector('#clearDiscordWebhook').checked
  };
  const response = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) {
    errorBox.textContent = result.message;
    errorBox.hidden = false;
    return;
  }
  setupConfig = result.config;
  document.querySelector('#clearDiscordWebhook').checked = false;
  renderSetup();
  document.querySelector('#saveState').textContent = `Saved locally at ${new Date().toLocaleTimeString()}`;
});

document.querySelector('#pollButton').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  await fetch('/api/poll', { method: 'POST' });
  event.currentTarget.disabled = false;
});

document.querySelector('#proposalForm').addEventListener('submit', async event => {
  event.preventDefault();
  const proposal = [
    'TRADE PROPOSAL — NO TRANSACTION WILL BE SENT',
    `Sell: ${document.querySelector('#amount').value} ${document.querySelector('#sellAsset').value.trim().toUpperCase()}`,
    `Buy: ${document.querySelector('#buyAsset').value.trim().toUpperCase()}`,
    `Maximum slippage: ${document.querySelector('#slippage').value}%`,
    `Created: ${new Date().toISOString()}`
  ].join('\n');
  document.querySelector('#proposalPreview').textContent = proposal;

  const reviewUrl = `${location.origin}/?walletReview=1&proposal=${encodeURIComponent(proposal)}#trade`;
  if (window.desktop) await window.desktop.openExternal(reviewUrl);
  else await signProposal(proposal);
});

async function signProposal(proposal) {
  const phantom = window.phantom?.solana;
  if (!phantom?.isPhantom) {
    window.open('https://phantom.com/download', '_blank', 'noopener');
    return;
  }
  const connection = await phantom.connect();
  const message = `${proposal}\nWallet: ${connection.publicKey}`;
  const result = await phantom.signMessage(new TextEncoder().encode(message), 'utf8');
  document.querySelector('#proposalPreview').textContent = `${message}\n\nProposal text approved in Phantom (${result.signature.length} signature bytes).\nNo transaction was created or submitted.`;
}

const params = new URLSearchParams(location.search);
if (params.get('walletReview') === '1') {
  document.querySelector('[data-view="trade"]').click();
  const proposal = params.get('proposal');
  if (proposal) {
    document.querySelector('#proposalPreview').textContent = proposal;
    signProposal(proposal);
  }
}

fetch('/api/status').then(response => response.json()).then(render);
loadConfig();
const events = new EventSource('/api/events');
events.onmessage = event => render(JSON.parse(event.data));
events.onerror = () => {
  document.querySelector('#liveDot').className = 'status-dot error';
  document.querySelector('#liveLabel').textContent = 'Local service disconnected';
};
document.querySelector('#buyAsset').addEventListener('input', () => renderRisk(latestStatus?.marketSnapshots || []));
