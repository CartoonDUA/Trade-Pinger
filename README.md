# Trade-Pinger

Trade-Pinger is a user-owned Windows desktop app for personal-account Telegram and official X API monitoring, Discord and optional SMS alerts, neutral Solana market snapshots, and human-reviewed Phantom proposals.

It never asks for a wallet recovery phrase or private key. It never creates, submits, broadcasts, or automatically executes a trade.

## Run on Windows

Install Node.js 20 or newer, then run:

```powershell
npm install
npm start
```

Electron starts the local service at `http://localhost:3000`. Runtime files are stored under the ignored `data/` directory. API hashes, webhook URLs, and phone values use Electron's operating-system-protected local encryption; the Telegram session is a write-only local credential. None of these values is returned to the UI, committed, or sent through chat.

## Personal Telegram setup

1. Sign in at [my.telegram.org](https://my.telegram.org), open **API development tools**, and create an application to obtain an API ID and API hash.
2. In **Setup → Telegram**, enter the API ID and API hash, then save setup locally.
3. In **Setup → Sources**, add channels with `@username`, a `t.me` link, a username Telegram Web link, or a numeric Telegram Web dialog link.
4. Return to **Telegram**, select **Authorize with QR**, and scan the QR in the official Telegram mobile app under **Settings → Devices → Link Desktop Device**. If Telegram requires two-step verification, enter that password directly in the local app.

The saved session is a full account credential. Trade-Pinger keeps it in ignored local storage, never returns it through its API, and provides **Sign out locally** to terminate and remove it. You can also terminate the session from Telegram’s official Devices screen.

Username sources are resolved through Telegram. Numeric dialog IDs are matched only against dialogs accessible to the signed-in account. Trade-Pinger does not scrape Telegram Web, join channels, use invite links to bypass access, or read inaccessible dialogs. Each inaccessible source gets its own visible error while accessible sources continue.

The Sources view shows content-free listener diagnostics for each resolved source: handler registration, received-event count, and accepted-event count. Trade-Pinger uses one Telegram NewMessage subscription and routes updates by Telegram's canonical peer ID, avoiding mismatches between raw numeric Web dialog IDs and channel/group peer IDs. Diagnostics never contain message text, credentials, sessions, or webhook values.

Monitoring begins after the live handlers are registered. Existing messages are not fetched or alerted. Newly delivered messages appear in Live Feed with their Telegram timestamp, source identity, full text, link when a public username permits one, and media status.

## Official X setup

Trade-Pinger uses only documented X API v2 requests. In **Setup → X**, add handles or `x.com` profile URLs, paste your bearer token locally, enable monitoring, and save. `@jdncrtr` and `@slace98` are the initial local source list. The token is write-only and protected with Electron safe storage; it is never returned by the local API or shown again. X documents the [user Post timeline endpoint](https://docs.x.com/x-api/users/get-posts) used by this integration.

Monitoring is deliberately off until a bearer token is saved and **Start official X monitoring** is checked. Once active, Trade-Pinger resolves each username through `GET /2/users/by/username/:username` and checks up to five newest posts through `GET /2/users/:id/tweets` every five minutes. The first successful response establishes a baseline and produces no alerts, including after an app restart. Later post IDs pass through the same duplicate guard, Live Feed, Discord `@everyone` embed, optional SMS, and Windows notification/sound path as Telegram. The top-right refresh button performs a manual provider check.

The official X API currently has no free access for this use and uses [user-funded pay-per-use credits](https://docs.x.com/x-api/fundamentals/post-cap). Availability and per-endpoint cost are shown in the user's X Developer Console. Trade-Pinger never buys credits, enters payment information, enables auto-recharge, or changes billing/spend limits. If credentials or credits are unavailable, leave X monitoring stopped; Telegram and the other local features continue normally.

## Google Drive folder setup

Trade-Pinger uses only the official Google Drive API v3 and never scrapes Drive, downloads file contents, or bypasses folder access. Create a Google Cloud **Desktop app** OAuth client with the Drive API enabled. In **Setup → Drive**, enter the desktop OAuth client ID and client secret, the folder URL or ID, and a newly generated Drive-specific Discord webhook. Save locally, select **Authorize in browser**, and complete Google's official consent in your normal browser. The callback returns to `http://127.0.0.1:3000/api/drive/callback`; Trade-Pinger never asks for Google passwords, cookies, authorization codes, or tokens.

The supplied folder `1BW5jENBH6nQsbcPP7L7x31VtffTc2aJH` is prefilled locally. The signed-in Google account must already have access. After authorization, select **Start 60-second Google Drive polling** and save. The first paginated listing after every start/restart establishes a metadata-only baseline with no historical alerts. Later item IDs—files and folders of every MIME type—appear in Live Feed, use enabled Windows notification/sound settings, and send name, MIME type, timestamps, folder ID, and view link to the separate Drive Discord webhook. File contents are never downloaded. Larger folders require additional official list requests for each 100-item page.

The Drive webhook is isolated from the general Telegram/X webhook: if it is absent, Drive metadata is not sent elsewhere. Because a webhook was pasted into chat, revoke it in Discord, regenerate it, and enter the replacement only in Trade-Pinger. Values remain write-only and protected locally. **Disconnect locally** stops Drive and removes stored OAuth access/refresh tokens; revoke Trade-Pinger's account access separately from the Google Account security page if desired.

## Windows new-post alerts

**Setup → Alerts** controls native desktop notifications and the local notification sound. Both default on. Each genuinely new post can show the source and a whitespace-normalized preview limited to 140 characters; clicking the notification focuses Trade-Pinger when Windows supports the action. The existing listener-start cutoff and seen-message ID guard prevent startup history and duplicate events from producing repeated desktop alerts.

Windows Focus Assist, Do Not Disturb, per-app notification permissions, or disabled system sounds can suppress notification banners or sound even while Trade-Pinger is listening normally.

## Discord alerts

Create a webhook for a Discord channel you control and save it under **Setup → Discord**. Each new monitored Telegram or X post intentionally includes `@everyone` followed by a rich embed with the provider, source, timestamp, complete text, media context, and a validated public post link when available. Long text is continued across additional rich embeds instead of being silently truncated. Available Telegram media up to the app’s 8 MB forwarding limit is attached to the first payload. Discord availability and its own webhook limits still apply.

Webhook values are write-only. If a webhook was pasted into chat or exposed elsewhere, revoke it first and enter a regenerated replacement directly in Trade-Pinger.

## Optional SMS and market data

Twilio SMS remains optional. Save an account SID, auth token, sending number, and destination in **Setup → SMS**. Long content can use multiple paid SMS segments.

The Market setup accepts coin symbols or Solana token addresses and reads neutral snapshots from the documented public [DEX Screener API](https://docs.dexscreener.com/api/reference). The proposal view flags only observable conditions such as missing data, low liquidity, large recent price movement, or a young pair. It does not provide recommendations, personalized advice, or position sizes.

CYBERLEEK can be tracked with the Solana token address `ApZuxdpzMrbEYTGEzeY9afh5pj9d6qPRJCTgQYiipbKg`. Its snapshot displays current price; 5-minute, 1-hour, 6-hour, and 24-hour changes; 24-hour volume; liquidity; market cap and FDV; pair age; DEX; and update time when the public API provides them. Missing or rate-limited data is labeled instead of estimated. This is factual market information, not financial advice or a prediction.

## Phantom boundary

The proposal screen opens the normal system browser. The user connects Phantom there and explicitly approves a signature over the displayed human-readable proposal. No transaction is built or sent, and the signature is not an automated trade instruction.

## Local configuration

Ordinary setup is handled in the desktop UI. `.env.example` is available only for optional initial defaults. The following paths are ignored by Git:

- `.env`
- `data/config.json`
- `data/state.json`
- `data/telegram.session`

The standalone Telegram-Peresonal project is not required; Trade-Pinger contains the integrated listener.
