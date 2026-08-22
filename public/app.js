let latestStatus;
let setupConfig = { telegramSources: [], coinWatchlist: [], configured: {} };

function dateTime(value) {
  return value ? new Date(value).toLocaleString() : 'Never';
}

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = value || '';
  return element.innerHTML;
}

function sourceLink(source) {
  return source.startsWith('@') ? `https://t.me/${source.slice(1)}` : '';
}

function render(status) {
  latestStatus = status;
  const provider = status.providers.Telegram;
  const hasError = status.errors.length > 0 || status.sourceErrors.length > 0;
  document.querySelector('#liveDot').className = `status-dot ${hasError ? 'error' : provider.connected ? '' : 'idle'}`;
  document.querySelector('#liveLabel').textContent = provider.connected ? 'Telegram live' : provider.authorizing ? 'Authorization pending' : 'Waiting for setup';
  document.querySelector('#liveMode').textContent = hasError ? 'Connection needs attention' : provider.message;
  document.querySelector('#providerCards').innerHTML = `<article class="provider-card"><span class="provider-icon"><i class="fa-brands fa-telegram"></i></span><div><strong>Telegram personal account</strong><small>${escapeHtml(provider.mode)} · Last check: ${dateTime(provider.lastSuccess)}</small></div><span class="provider-state ${provider.connected ? 'connected' : ''}">${provider.connected ? 'Listening' : provider.authorized ? 'Reconnect needed' : 'Needs authorization'}</span></article>`;
  document.querySelector('#stats').innerHTML = `<div><strong>${dateTime(status.lastPoll)}</strong><span>Last successful Telegram check</span></div><div><strong>${dateTime(status.lastAlert)}</strong><span>Last alert / ping</span></div><div><strong>${status.discordConfigured ? 'Discord ready' : status.smsConfigured ? 'SMS ready' : 'Needs setup'}</strong><span>Alert delivery</span></div>`;
  document.querySelector('#postCount').textContent = `${status.posts.length} post${status.posts.length === 1 ? '' : 's'}`;
  document.querySelector('#posts').innerHTML = status.posts.length ? status.posts.map(post => `<article class="post"><span class="post-icon"><i class="fa-brands fa-telegram"></i></span><div><div class="post-meta"><strong>${escapeHtml(post.source)}</strong><span>${dateTime(post.createdAt)}</span></div><p>${escapeHtml(post.text)}</p>${post.media ? `<small>${post.media.attached ? 'Media forwarded to Discord' : post.media.tooLarge ? 'Media exceeded local forwarding limit' : 'Media was unavailable'}</small>` : ''}</div>${post.link ? `<a href="${escapeHtml(post.link)}" target="_blank" rel="noreferrer" title="Open post"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>` : ''}</article>`).join('') : '<div class="empty"><i class="fa-solid fa-satellite-dish"></i><p>No new posts since listening started.</p></div>';
  document.querySelector('#sources').innerHTML = status.sources.length ? status.sources.map(source => {
    const link = sourceLink(source.source);
    const name = escapeHtml(source.source);
    const diagnostic = source.diagnostic;
    const status = source.error || (diagnostic ? `Handler registered · received ${diagnostic.received} · accepted ${diagnostic.accepted}` : source.configured ? 'Resolving source' : 'Needs authorization');
    return `<div class="source"><span class="source-icon"><i class="fa-brands fa-telegram"></i></span>${link ? `<a href="${link}" target="_blank" rel="noreferrer">${name}</a>` : `<span>${name}</span>`}<small class="${source.error ? 'source-error' : diagnostic?.registered ? 'ready' : ''}">${escapeHtml(status)}</small></div>`;
  }).join('') : '<div class="empty">No Telegram sources configured.</div>';
  renderMarkets(status.marketSnapshots || []);
  renderRisk(status.marketSnapshots || []);
  renderAuth(provider);
}

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.nav-item,.view').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  document.querySelector(`#${button.dataset.view}View`).classList.add('active');
  document.querySelector('#pageName').textContent = button.textContent.trim();
}));

function renderSetup() {
  document.querySelector('#telegramApiId').value = setupConfig.telegramApiId || '';
  document.querySelector('#telegramConfigured').textContent = setupConfig.configured.telegramSession ? 'Authorized' : setupConfig.configured.telegram ? 'Credentials saved' : 'Not configured';
  document.querySelector('#twilioConfigured').textContent = setupConfig.configured.twilio ? 'Configured' : 'Not configured';
  document.querySelector('#discordConfigured').textContent = setupConfig.configured.discord ? 'Configured' : 'Not configured';
  document.querySelector('#desktopNotifications').checked = setupConfig.desktopNotifications !== false;
  document.querySelector('#notificationSound').checked = setupConfig.notificationSound !== false;
  const secretFields = ['telegramApiHash', 'twilioAccountSid', 'twilioAuthToken', 'twilioFromNumber', 'smsToNumber', 'discordWebhookUrl'];
  secretFields.forEach(id => {
    const input = document.querySelector(`#${id}`);
    input.value = '';
    input.placeholder = setupConfig.configured[id] ? 'Saved locally — enter a new value to replace' : id.includes('Number') ? '+15551234567' : 'Paste to save locally';
  });
  document.querySelector('#telegramSourceEditor').innerHTML = setupConfig.telegramSources.map((source, index) => `<span class="source-chip"><i class="fa-brands fa-telegram"></i>${escapeHtml(source)}<button type="button" data-remove-source data-index="${index}" title="Remove"><i class="fa-solid fa-xmark"></i></button></span>`).join('');
  document.querySelector('#coinEditor').innerHTML = setupConfig.coinWatchlist.map((coin, index) => `<span class="source-chip"><i class="fa-solid fa-coins"></i>${escapeHtml(coin)}<button type="button" data-remove-coin data-index="${index}" title="Remove"><i class="fa-solid fa-xmark"></i></button></span>`).join('');
}

function renderAuth(provider) {
  document.querySelector('#telegramAuthLabel').textContent = provider.authorized ? 'Telegram account authorized' : provider.authorizing ? 'Authorization in progress' : 'Telegram account not authorized';
  document.querySelector('#telegramAuthMessage').textContent = provider.message || '';
  document.querySelector('#signOutTelegram').disabled = !provider.authorized;
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
  target.innerHTML = markets.length ? markets.map(market => market.error ? `<article class="market-card"><strong>${escapeHtml(market.coin)}</strong><span class="market-error">${escapeHtml(market.error)}</span><small>Updated ${dateTime(market.updatedAt)}</small></article>` : `<article class="market-card"><div><strong>${escapeHtml(market.symbol)}</strong><span>${escapeHtml(market.name)} · ${escapeHtml(market.dex || 'DEX')}</span></div><dl><div><dt>Price</dt><dd>${money(market.priceUsd)}</dd></div><div><dt>5m / 1h change</dt><dd>${percentage(market.change5m)} / ${percentage(market.change1h)}</dd></div><div><dt>6h / 24h change</dt><dd>${percentage(market.change6h)} / ${percentage(market.change24h)}</dd></div><div><dt>24h volume</dt><dd>${money(market.volume24h)}</dd></div><div><dt>Liquidity</dt><dd>${money(market.liquidityUsd)}</dd></div><div><dt>Market cap / FDV</dt><dd>${money(market.marketCap)} / ${money(market.fdv)}</dd></div><div><dt>Pair age</dt><dd>${pairAge(market.pairCreatedAt)}</dd></div></dl><small>Updated ${dateTime(market.updatedAt)}</small></article>`).join('') : '<p class="market-empty">Add a coin to load a public market snapshot.</p>';
}

function percentage(value) {
  return value === null || value === undefined ? 'Unavailable' : `${value}%`;
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
  if (market.liquidityUsd == null) flags.push('Liquidity data is unavailable.');
  else if (market.liquidityUsd < 100000) flags.push('Liquidity is below $100,000, so price impact may be higher.');
  if (market.change24h == null) flags.push('Recent price-change data is unavailable.');
  else if (Math.abs(market.change24h) >= 20) flags.push('The absolute 24-hour price change is at least 20%, indicating high recent volatility.');
  if (!market.pairCreatedAt) flags.push('Pair age is unavailable.');
  else if (Date.now() - market.pairCreatedAt < 7 * 86400000) flags.push('The selected pair is less than 7 days old.');
  if (!flags.length) flags.push('None of the displayed low-liquidity, high-volatility, new-pair, or missing-data flags were triggered.');
  summary.innerHTML = `<strong>Market-risk context</strong><span>Informational only—not a recommendation or personalized advice. ${escapeHtml(flags.join(' '))}</span>`;
}

async function loadConfig() {
  setupConfig = await fetch('/api/config').then(response => response.json());
  renderSetup();
}

document.querySelector('#addTelegramSource').addEventListener('click', () => {
  const input = document.querySelector('#newTelegramSource');
  if (!input.value.trim()) return;
  setupConfig.telegramSources.push(input.value.trim());
  input.value = '';
  renderSetup();
});
document.querySelector('#addCoin').addEventListener('click', () => {
  const input = document.querySelector('#newCoin');
  if (!input.value.trim()) return;
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
  const sourceButton = event.target.closest('[data-remove-source]');
  const coinButton = event.target.closest('[data-remove-coin]');
  if (sourceButton) setupConfig.telegramSources.splice(Number(sourceButton.dataset.index), 1);
  if (coinButton) setupConfig.coinWatchlist.splice(Number(coinButton.dataset.index), 1);
  if (sourceButton || coinButton) renderSetup();
});

document.querySelector('#setupForm').addEventListener('submit', async event => {
  event.preventDefault();
  const errorBox = document.querySelector('#setupError');
  errorBox.hidden = true;
  const body = {
    telegramApiId: document.querySelector('#telegramApiId').value,
    telegramApiHash: document.querySelector('#telegramApiHash').value,
    telegramSources: setupConfig.telegramSources,
    coinWatchlist: setupConfig.coinWatchlist,
    desktopNotifications: document.querySelector('#desktopNotifications').checked,
    notificationSound: document.querySelector('#notificationSound').checked,
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

async function refreshAuth() {
  const auth = await fetch('/api/telegram/auth').then(response => response.json());
  const qr = document.querySelector('#telegramQr');
  qr.hidden = !auth.qrDataUrl;
  qr.style.display = auth.qrDataUrl ? 'block' : 'none';
  if (auth.qrDataUrl) qr.src = auth.qrDataUrl;
  const passwordArea = document.querySelector('#telegramPasswordArea');
  passwordArea.innerHTML = auth.needsPassword ? `<div id="passwordPanel" class="password-panel"><label><span>Telegram two-step verification password <em>(hint: ${escapeHtml(auth.passwordHint || 'none')})</em></span><input id="telegramPassword" type="password" autocomplete="off"></label><button class="button secondary" id="submitTelegramPassword" type="button">Continue</button></div>` : '';
  document.querySelector('#submitTelegramPassword')?.addEventListener('click', submitTelegramPassword);
  if (auth.authorized) {
    qr.hidden = true;
    await loadConfig();
  }
}

document.querySelector('#authorizeTelegram').addEventListener('click', async () => {
  const response = await fetch('/api/telegram/authorize', { method: 'POST' });
  const result = await response.json();
  if (!response.ok) {
    document.querySelector('#setupError').textContent = result.message;
    document.querySelector('#setupError').hidden = false;
  }
  refreshAuth();
});
async function submitTelegramPassword() {
  const input = document.querySelector('#telegramPassword');
  await fetch('/api/telegram/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: input.value }) });
  input.value = '';
}
document.querySelector('#signOutTelegram').addEventListener('click', async () => {
  await fetch('/api/telegram/signout', { method: 'POST' });
  await loadConfig();
});
document.querySelector('#checkButton').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  await fetch('/api/check', { method: 'POST' });
  event.currentTarget.disabled = false;
});

document.querySelector('#proposalForm').addEventListener('submit', async event => {
  event.preventDefault();
  const proposal = ['TRADE PROPOSAL — NO TRANSACTION WILL BE SENT', `Sell: ${document.querySelector('#amount').value} ${document.querySelector('#sellAsset').value.trim().toUpperCase()}`, `Buy: ${document.querySelector('#buyAsset').value.trim().toUpperCase()}`, `Maximum slippage: ${document.querySelector('#slippage').value}%`, `Created: ${new Date().toISOString()}`].join('\n');
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

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('tradePingerTheme', theme);
  document.querySelector('#themeButton i').className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
}
document.querySelector('#themeButton').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
applyTheme(localStorage.getItem('tradePingerTheme') || 'dark');

const params = new URLSearchParams(location.search);
if (params.get('walletReview') === '1') {
  document.querySelector('[data-view="trade"]').click();
  const proposal = params.get('proposal');
  if (proposal) { document.querySelector('#proposalPreview').textContent = proposal; signProposal(proposal); }
}

fetch('/api/status').then(response => response.json()).then(render);
loadConfig();
refreshAuth();
setInterval(refreshAuth, 1500);
const events = new EventSource('/api/events');
events.onmessage = event => render(JSON.parse(event.data));
events.onerror = () => {
  document.querySelector('#liveDot').className = 'status-dot error';
  document.querySelector('#liveLabel').textContent = 'Local service disconnected';
};
document.querySelector('#buyAsset').addEventListener('input', () => renderRisk(latestStatus?.marketSnapshots || []));
