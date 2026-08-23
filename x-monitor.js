function normalizeXSource(value) {
  const input = String(value || '').trim();
  const match = input.match(/^(?:@|https?:\/\/(?:www\.)?x\.com\/)?([A-Za-z0-9_]{1,15})\/?$/i);
  if (!match) throw new Error(`Unsupported X handle or profile URL: ${value}`);
  return `@${match[1]}`;
}

class XMonitor {
  constructor({ onPost, onState, fetcher = fetch }) {
    this.onPost = onPost;
    this.onState = onState;
    this.fetcher = fetcher;
    this.timer = null;
    this.users = new Map();
    this.baselines = new Map();
    this.running = false;
  }

  async request(url) {
    const response = await this.fetcher(url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!response.ok) throw new Error(`X API returned ${response.status}`);
    return response.json();
  }

  async userId(handle) {
    if (this.users.has(handle)) return this.users.get(handle);
    const result = await this.request(`https://api.x.com/2/users/by/username/${handle.slice(1)}`);
    if (!result.data?.id) throw new Error(`X account ${handle} was not found or is inaccessible.`);
    this.users.set(handle, result.data.id);
    return result.data.id;
  }

  async poll() {
    if (!this.running) return false;
    this.onState({ checking: true, message: 'Checking official X API.' });
    try {
      for (const handle of this.handles) {
        const id = await this.userId(handle);
        const since = this.baselines.get(handle);
        const params = new URLSearchParams({ max_results: '5', 'tweet.fields': 'created_at' });
        if (since) params.set('since_id', since);
        const result = await this.request(`https://api.x.com/2/users/${id}/tweets?${params}`);
        const posts = result.data || [];
        if (!since) {
          if (posts[0]) this.baselines.set(handle, posts[0].id);
          continue;
        }
        for (const post of posts.slice().reverse()) {
          await this.onPost({
            id: `X:${post.id}`,
            network: 'X',
            source: `X ${handle}`,
            text: post.text || '',
            createdAt: post.created_at || new Date().toISOString(),
            link: `https://x.com/${handle.slice(1)}/status/${post.id}`
          });
        }
        if (posts[0]) this.baselines.set(handle, posts[0].id);
      }
      this.onState({ connected: true, checking: false, lastSuccess: new Date().toISOString(), error: null, message: 'Official X polling active.' });
      return true;
    } catch (error) {
      this.onState({ connected: false, checking: false, error: error.message, message: 'Official X API needs attention.' });
      return false;
    }
  }

  start(token, handles, enabled, intervalMs = 300000) {
    this.stop();
    this.token = token;
    this.handles = handles;
    this.users.clear();
    this.baselines.clear();
    this.running = Boolean(token && enabled && handles.length);
    if (!this.running) {
      this.onState({ connected: false, checking: false, lastSuccess: null, error: null, message: enabled ? 'Save an X bearer token and at least one handle.' : 'Official X monitoring is stopped.' });
      return;
    }
    this.onState({ connected: false, checking: false, lastSuccess: null, error: null, message: 'Establishing startup baseline.' });
    this.poll();
    this.timer = setInterval(() => this.poll(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }
}

module.exports = { XMonitor, normalizeXSource };
