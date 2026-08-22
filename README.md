# Social Trade Alerts

A small local dashboard that checks configured X and Telegram sources, sends each newly detected post's full text and link by SMS, and lets you review and cryptographically approve a trade proposal with Phantom.

The Phantom flow signs human-readable proposal text only. It does not build, submit, or broadcast a transaction. This app never requests, stores, or transmits a recovery phrase or private key.

## Setup

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and fill in the services you want to use.
3. Install and start the app:

   ```powershell
   npm install
   npm start
   ```

4. Open `http://localhost:3000`.

Local runtime state is saved in `data/state.json` and ignored by Git. It contains detected public post data and polling cursors, not credentials.

## X

Create a developer project at the [X Developer Portal](https://developer.x.com/) with official API v2 recent-search access. Put its bearer token in `X_BEARER_TOKEN`. Set `X_SOURCES` to comma-separated profile links. The included defaults are `https://x.com/jdncrtr` and `https://x.com/PortalViciados`.

API access levels, rate limits, and pricing are controlled by X. The app polls no faster than every 15 seconds and records the most recent 500 post IDs to avoid duplicate alerts.

## Telegram

Create a bot with [BotFather](https://t.me/BotFather), put its token in `TELEGRAM_BOT_TOKEN`, and add the bot as an administrator to every channel you want it to monitor. Set `TELEGRAM_SOURCES` to the public and private source links.

For a private invite channel, an invite link is not enough. The channel owner must explicitly add your authenticated, user-controlled bot integration. After it is added, obtain the channel's numeric ID from a channel update and set `TELEGRAM_PRIVATE_CHAT_ID` (usually starts with `-100`). The app only accepts Telegram updates matching a configured public username or that private chat ID.

Telegram bots receive new channel posts after they are added; they do not provide arbitrary historical access.

## SMS

Create a [Twilio](https://www.twilio.com/) account and set:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- `SMS_TO_NUMBER`

Use E.164 phone-number format. Long posts may be delivered as multiple SMS segments and may incur provider charges.

## Phantom

Install [Phantom](https://phantom.com/download) in the browser that opens the dashboard. Click **Connect Phantom** and approve the connection in the extension. The app receives only the public wallet address.

When you submit a proposal, Phantom shows a signature approval. The signed content is a plain-text proposal and the signature remains in the browser. No trade transaction is constructed or sent. To carry out a trade, use a trusted trading application separately and review its transaction in Phantom before signing.

Never enter a recovery phrase or private key into this app, its `.env` file, or any site opened from it.
