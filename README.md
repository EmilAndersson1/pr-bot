# PR Bot

A Slack bot for managing Pull Requests with team notifications and automated cleanup.

## Features

- **Slash Command**: `/pr <url> [complexity]` to post a PR.
- **Complexity Levels**: Visual indicators for PR size (Small 🟩, Medium 🟨, Large 🟥).
- **Notifications**:
    - React with `:speech_balloon:` to notify the author of comments.
    - React with `:white_check_mark:` to notify the author of approval.
- **Automated Cleanup**:
    - React with `:merged:` to schedule deletion of the PR entry (and clean up the thread).
    - **Safe Deletion**: Deletes the bot's own messages and the parent post to keep channels clean.

## Setup

### Prerequisites

- Node.js (v18+)
- A Slack App with a Bot User

### Environment Variables

Create a `.env` file:

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
PORT=3000
```

### Installation

```bash
npm install
```

## Development

```bash
# Run in development mode (hot-reload)
npm run dev

# Linting
npm run lint
npm run format
```

## Deployment

The bot is designed to be deployed on platforms like Railway, Heroku, or Render.

1.  **Build**: `npm run build`
2.  **Start**: `npm start`

### Slack Configuration

1.  **Scopes**:
    - `chat:write`, `channels:history`, `groups:history` (for private channels), `reactions:read`, `commands`.
2.  **Events**:
    - Subscribe to `reaction_added` and `reaction_removed`.
    - Request URL: `https://your-domain.com/slack/events`
3.  **Slash Command**:
    - Command: `/pr`
    - Request URL: `https://your-domain.com/slack/commands`

## License

ISC
