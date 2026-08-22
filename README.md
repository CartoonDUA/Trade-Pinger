# Trade-Pinger

Trade-Pinger is a user-owned Windows desktop app for personal-account Telegram channel monitoring, Discord and optional SMS alerts, neutral Solana market snapshots, and human-reviewed Phantom proposals.

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

Monitoring begins after the live handlers are registered. Existing messages are not fetched or alerted. Newly delivered messages appear in Live Feed with their Telegram timestamp, source identity, full text, link when a public username permits one, and media status.

## Windows new-post alerts

**Setup → Alerts** controls native desktop notifications and the local notification sound. Both default on. Each genuinely new post can show the source and a whitespace-normalized preview limited to 140 characters; clicking the notification focuses Trade-Pinger when Windows supports the action. The existing listener-start cutoff and seen-message ID guard prevent startup history and duplicate events from producing repeated desktop alerts.

Windows Focus Assist, Do Not Disturb, per-app notification permissions, or disabled system sounds can suppress notification banners or sound even while Trade-Pinger is listening normally.

## Discord alerts

Create a webhook for a Discord channel you control and save it under **Setup → Discord**. Each new monitored Telegram post intentionally includes `@everyone`, complete text split across messages when necessary, source, Telegram timestamp, public post link when available, and available media up to the app’s 8 MB forwarding limit. Discord availability and its own webhook limits still apply.

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
