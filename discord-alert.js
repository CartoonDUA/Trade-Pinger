function discordMessages(post) {
  const header = `@everyone\n**New Telegram post from ${post.source}**\nTimestamp: ${post.createdAt}`;
  const mediaNote = post.media?.tooLarge ? '\nMedia was larger than the 8 MB local forwarding limit.' : '';
  const chunks = post.text.match(/[\s\S]{1,1750}/g) || ['[Media post]'];
  return chunks.map((chunk, index) => {
    const prefix = index === 0 ? `${header}\n\n` : '';
    const link = index === chunks.length - 1 && post.link ? `\n\n${post.link}` : '';
    return `${prefix}${chunk}${link}${index === chunks.length - 1 ? mediaNote : ''}`;
  });
}

async function sendDiscord(webhook, post, attachment, fetcher = fetch) {
  if (!webhook) return false;
  const messages = discordMessages(post);
  for (let index = 0; index < messages.length; index += 1) {
    const payload = { content: messages[index], allowed_mentions: { parse: ['everyone'] } };
    let response;
    if (index === 0 && attachment) {
      const form = new FormData();
      form.append('payload_json', JSON.stringify(payload));
      form.append('files[0]', new Blob([attachment.content]), attachment.name);
      response = await fetcher(webhook, { method: 'POST', body: form });
    } else {
      response = await fetcher(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    }
    if (!response.ok) throw new Error(`Discord webhook returned ${response.status}`);
  }
  return true;
}

module.exports = { discordMessages, sendDiscord };
