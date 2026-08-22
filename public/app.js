let latestStatus;

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
  const configured = status.sources.filter(source => source.configured).length;
  const hasError = status.errors.length > 0;

  document.querySelector('#liveDot').className = `status-dot ${hasError ? 'error' : connected ? '' : 'idle'}`;
  document.querySelector('#liveLabel').textContent = connected ? `${connected} provider${connected === 1 ? '' : 's'} live` : 'Waiting for setup';
  document.querySelector('#liveMode').textContent = hasError ? 'Connection needs attention' : connected ? 'Listening for new posts' : 'Credentials not configured';

  document.querySelector('#providerCards').innerHTML = providers.map(([name, provider]) => `
    <article class="provider-card">
      <span class="provider-icon"><i class="fa-brands ${name === 'X' ? 'fa-x-twitter' : 'fa-telegram'}"></i></span>
      <div><strong>${name}</strong><small>${escapeHtml(provider.mode)} · Last success: ${dateTime(provider.lastSuccess)}</small></div>
      <span class="provider-state ${provider.connected ? 'connected' : ''}">${provider.connected ? 'Connected' : configured ? 'Connecting' : 'Needs setup'}</span>
    </article>`).join('');

  document.querySelector('#stats').innerHTML = `
    <div><strong>${dateTime(status.lastPoll)}</strong><span>Last successful provider check</span></div>
    <div><strong>${dateTime(status.lastAlert)}</strong><span>Last SMS alert / ping</span></div>
    <div><strong>${status.smsConfigured ? 'Ready' : 'Needs setup'}</strong><span>SMS delivery</span></div>`;

  document.querySelector('#postCount').textContent = `${status.posts.length} post${status.posts.length === 1 ? '' : 's'}`;
  document.querySelector('#posts').innerHTML = status.posts.length ? status.posts.map(post => `
    <article class="post">
      <span class="post-icon"><i class="fa-brands ${post.network === 'X' ? 'fa-x-twitter' : 'fa-telegram'}"></i></span>
      <div><div class="post-meta"><strong>${escapeHtml(post.source)}</strong><span>${escapeHtml(post.network)}</span></div><p>${escapeHtml(post.text)}</p></div>
      <a href="${escapeHtml(post.link)}" target="_blank" rel="noreferrer" title="Open post"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
    </article>`).join('') : '<div class="empty"><i class="fa-solid fa-satellite-dish"></i><p>No posts detected yet. Live updates will appear here.</p></div>';

  document.querySelector('#sources').innerHTML = status.sources.map(source => `
    <div class="source"><span class="source-icon"><i class="fa-brands ${source.network === 'X' ? 'fa-x-twitter' : 'fa-telegram'}"></i></span><a href="${escapeHtml(source.link)}" target="_blank" rel="noreferrer">${escapeHtml(source.link)}</a><small class="${source.configured ? 'ready' : ''}">${source.configured ? 'API ready' : 'Needs credentials'}</small></div>`).join('');
}

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.nav-item,.view').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  document.querySelector(`#${button.dataset.view}View`).classList.add('active');
  document.querySelector('#pageName').textContent = button.textContent.trim();
}));

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
const events = new EventSource('/api/events');
events.onmessage = event => render(JSON.parse(event.data));
events.onerror = () => {
  document.querySelector('#liveDot').className = 'status-dot error';
  document.querySelector('#liveLabel').textContent = 'Local service disconnected';
};
