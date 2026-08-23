function safePostLink(value) {
  if (/^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}\/\d+$/.test(value || '')) return value;
  if (/^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+$/.test(value || '')) return value;
  return null;
}

function mediaContext(post) {
  if (!post.media) return 'No attachment';
  if (post.media.tooLarge) return 'Telegram media exceeded the 8 MB local forwarding limit';
  if (post.media.attached) return 'Telegram media attached to this alert';
  return 'Telegram media was present but unavailable for forwarding';
}

function discordPayloads(post) {
  const text = post.text || '[Media post]';
  const chunks = text.match(/[\s\S]{1,4000}/g) || ['[Media post]'];
  const timestamp = Number.isNaN(Date.parse(post.createdAt)) ? undefined : new Date(post.createdAt).toISOString();
  const link = safePostLink(post.link);
  return chunks.map((description, index) => {
    const embed = {
      title: `New ${post.network || 'Telegram'} post · ${post.source}`.slice(0, 256),
      description,
      color: 0x4ba0e8,
      fields: index === 0 ? [
        { name: 'Source', value: String(post.source || 'Monitored source').slice(0, 1024), inline: true },
        { name: 'Provider', value: String(post.network || 'Telegram').slice(0, 1024), inline: true },
        { name: 'Media', value: mediaContext(post), inline: false }
      ] : [],
      footer: { text: chunks.length === 1 ? 'Trade-Pinger · New post' : `Trade-Pinger · Part ${index + 1} of ${chunks.length}` }
    };
    if (timestamp) embed.timestamp = timestamp;
    if (index === 0 && link) embed.url = link;
    return { content: index === 0 ? '@everyone' : undefined, allowed_mentions: { parse: ['everyone'] }, embeds: [embed] };
  });
}

async function sendDiscord(webhook, post, attachment, fetcher = fetch) {
  if (!webhook) return false;
  const payloads = discordPayloads(post);
  for (let index = 0; index < payloads.length; index += 1) {
    let response;
    if (index === 0 && attachment) {
      const form = new FormData();
      form.append('payload_json', JSON.stringify(payloads[index]));
      form.append('files[0]', new Blob([attachment.content]), attachment.name);
      response = await fetcher(webhook, { method: 'POST', body: form });
    } else {
      response = await fetcher(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payloads[index]) });
    }
    if (!response.ok) throw new Error(`Discord webhook returned ${response.status}`);
  }
  return true;
}

module.exports = { discordPayloads, safePostLink, sendDiscord };
