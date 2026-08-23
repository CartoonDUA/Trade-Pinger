function driveDiscordPayload(post) {
  const item = post.drive || {};
  const fields = [
    { name: 'Name', value: String(item.name || 'Unnamed item').slice(0, 1024), inline: false },
    { name: 'Type', value: String(item.mimeType || 'Unknown').slice(0, 1024), inline: true },
    { name: 'Folder ID', value: String(item.folderId || 'Unknown').slice(0, 1024), inline: true },
    { name: 'Created', value: new Date(post.createdAt).toISOString(), inline: false }
  ];
  if (item.modifiedTime) fields.push({ name: 'Modified', value: new Date(item.modifiedTime).toISOString(), inline: false });
  const embed = { title: 'New Google Drive file', color: 0x4ba0e8, fields, timestamp: new Date(post.createdAt).toISOString(), footer: { text: 'Trade-Pinger · Google Drive metadata' } };
  if (/^https:\/\/drive\.google\.com\/(?:file\/d\/|drive\/folders\/)[A-Za-z0-9_-]+/.test(post.link || '')) embed.url = post.link;
  return { content: '@everyone', allowed_mentions: { parse: ['everyone'] }, embeds: [embed] };
}

async function sendDriveDiscord(webhook, post, fetcher = fetch) {
  if (!webhook) return false;
  const response = await fetcher(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(driveDiscordPayload(post)) });
  if (!response.ok) throw new Error(`Drive Discord webhook returned ${response.status}`);
  return true;
}

module.exports = { driveDiscordPayload, sendDriveDiscord };
