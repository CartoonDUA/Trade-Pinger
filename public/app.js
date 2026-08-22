let phantom;
let publicKey = '';

function shortDate(value) {
  return value ? new Date(value).toLocaleString() : 'Not yet';
}

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = value || '';
  return element.innerHTML;
}

async function loadStatus() {
  const response = await fetch('/api/status');
  const status = await response.json();

  const errorText = status.errors.length ? status.errors.map(error => `${error.service}: ${error.message}`).join(' · ') : 'No current errors';
  document.querySelector('#statusCards').innerHTML = `
    <div class="status-card"><i class="fa-solid fa-satellite-dish"></i><span>LAST SOURCE CHECK</span><strong>${shortDate(status.lastPoll)}</strong></div>
    <div class="status-card"><i class="fa-solid fa-message"></i><span>LAST SMS ALERT</span><strong>${status.smsConfigured ? shortDate(status.lastAlert) : 'Not configured'}</strong></div>
    <div class="status-card"><i class="fa-solid fa-circle-check"></i><span>SYSTEM STATUS</span><strong class="${status.errors.length ? 'error' : ''}">${escapeHtml(errorText)}</strong></div>`;

  document.querySelector('#sources').innerHTML = status.sources.length ? status.sources.map(source => `
    <div class="source">
      <i class="fa-brands ${source.network === 'X' ? 'fa-x-twitter' : 'fa-telegram'}"></i>
      <div><a href="${escapeHtml(source.link)}" target="_blank" rel="noreferrer">${escapeHtml(source.link)}</a><small>${source.configured ? 'API configured' : 'Needs credentials'}</small></div>
    </div>`).join('') : '<p class="empty">Add source links to your .env file.</p>';

  document.querySelector('#posts').innerHTML = status.posts.length ? status.posts.map(post => `
    <article class="post">
      <div class="post-meta"><strong>${escapeHtml(post.source)}</strong><span>${shortDate(post.createdAt)}</span></div>
      <p>${escapeHtml(post.text)}</p>
      <a href="${escapeHtml(post.link)}" target="_blank" rel="noreferrer">Open post <i class="fa-solid fa-arrow-up-right-from-square"></i></a>
    </article>`).join('') : '<p class="empty">No new posts detected yet.</p>';
}

document.querySelector('#pollButton').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  await fetch('/api/poll', { method: 'POST' });
  await loadStatus();
  event.currentTarget.disabled = false;
});

document.querySelector('#connectButton').addEventListener('click', async () => {
  phantom = window.phantom?.solana;
  if (!phantom?.isPhantom) {
    window.open('https://phantom.com/download', '_blank', 'noopener');
    return;
  }

  const connection = await phantom.connect();
  publicKey = connection.publicKey.toString();
  document.querySelector('#walletStatus').textContent = `Connected: ${publicKey}`;
});

document.querySelector('#proposalForm').addEventListener('submit', async event => {
  event.preventDefault();
  const proposal = [
    'TRADE PROPOSAL — NO TRANSACTION WILL BE SENT',
    `Wallet: ${publicKey || 'Connect Phantom first'}`,
    `Sell: ${document.querySelector('#amount').value} ${document.querySelector('#sellAsset').value.trim().toUpperCase()}`,
    `Buy: ${document.querySelector('#buyAsset').value.trim().toUpperCase()}`,
    `Maximum slippage: ${document.querySelector('#slippage').value}%`,
    `Created: ${new Date().toISOString()}`
  ].join('\n');

  document.querySelector('#proposalPreview').textContent = proposal;
  if (!publicKey) return;

  const encoded = new TextEncoder().encode(proposal);
  const result = await phantom.signMessage(encoded, 'utf8');
  const signature = Array.from(result.signature, byte => byte.toString(16).padStart(2, '0')).join('');
  document.querySelector('#proposalPreview').textContent = `${proposal}\n\nApproved signature: ${signature}\n\nNo transaction was created or submitted.`;
});

loadStatus();
setInterval(loadStatus, 30000);
