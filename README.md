# Trade-Pinger

A user-owned Windows desktop monitor for configured X and Telegram sources. New posts appear in the live feed and can be sent with their full text and link through Twilio SMS. The desktop app also prepares human-readable trade proposals for explicit approval in Phantom.

Trade-Pinger never requests, stores, or transmits a recovery phrase or private key. It never constructs, submits, broadcasts, or automatically executes a trade transaction.

## Run on Windows

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and fill in the services you use.
3. Install dependencies and launch the desktop app:

   ```powershell
   npm install
   npm start
   ```

The Electron desktop window starts its own local service at `http://localhost:3000`. Use `npm run web` only when you specifically want the browser version.

Runtime state is saved in the ignored `data/state.json`. Credentials stay in the ignored `.env` file.

## Live delivery modes

- **X polling (default):** official API v2 recent search every 15 seconds. The app labels this as polling and does not claim instant delivery.
- **X filtered stream:** set `X_STREAM_ENABLED=true` only when the configured X API access tier supports filtered streams. Trade-Pinger installs rules tagged `trade-pinger:*` for the configured profiles, connects to the official filtered-stream endpoint, and reconnects after interruptions.
- **Telegram long polling:** the user-controlled bot keeps an official Bot API `getUpdates` request open for up to 25 seconds at a time. New matching channel posts are added as soon as Telegram returns them.
- **Desktop updates:** the local service pushes status and new posts to the desktop window with server-sent events, without a UI refresh interval.

The dashboard shows each provider's configured delivery mode, current connection state, exact last successful provider check, and exact last SMS alert time.

## X setup

Create a developer project at the [X Developer Portal](https://developer.x.com/) with official API v2 access. Set:

- `X_BEARER_TOKEN`
- `X_SOURCES` as comma-separated profile links
- `X_STREAM_ENABLED=false` for recent-search polling, or `true` when the API tier supports filtered streams

The included sources are `https://x.com/jdncrtr` and `https://x.com/PortalViciados`. API availability, rate limits, and pricing are controlled by X.

## Telegram setup

Create a bot with [BotFather](https://t.me/BotFather), set `TELEGRAM_BOT_TOKEN`, and add that bot as an administrator to every monitored channel. `TELEGRAM_SOURCES` contains the public and private source links.

For a private invite channel, the invite link alone is not access. The owner must add the user-controlled bot, then set the channel's numeric ID in `TELEGRAM_PRIVATE_CHAT_ID` (usually starts with `-100`). Bots receive new channel posts after being added; they do not provide arbitrary historical access.

## SMS setup

Create a [Twilio](https://www.twilio.com/) account and set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and `SMS_TO_NUMBER`. Phone numbers use E.164 format. Long posts can use multiple paid SMS segments.

## Phantom approval

The desktop proposal screen opens a local review page in the normal system browser, where the user's installed Phantom extension connects directly and shows the signature approval. The app asks Phantom to sign only the displayed human-readable proposal text. The signature stays in the browser and no transaction is created or sent.

Never enter a recovery phrase or private key into Trade-Pinger, `.env`, or any linked page.
