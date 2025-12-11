# PR Bot

A Slack bot for managing Pull Requests with team notifications and automated cleanup.

## Features

- **Slash Command**: `/pr <url> [complexity]` to post a PR.
- **Complexity Levels**: Visual indicators for PR size.
    - `ez` -> :ez:
    - `medium` -> 🟨 *Medium*
    - `large` -> 🟥 *Large*
- **Notifications**:
    - React with `:speech_balloon:` to notify the author of comments.
    - React with `:white_check_mark:` to notify the author of approval.
    - React with `:repeat:` to notify reviewers that updates have been made (based on who commented in the thread).
- **Automated Cleanup**:
    - React with `:merged:` to schedule deletion of the PR entry (30s timer).
    - **Safe Deletion**: Deletes the bot's own messages in the thread and the parent post to keep channels clean.
    - **Race Condition Handling**: Prevents duplicate processing of reactions.

## Required Reactions

To ensure the bot works as expected, add these custom emojis to your Slack workspace (or use existing ones):

- `:merged:` (Used for triggering cleanup)
- `:ez:` (Used for 'ez' complexity level)
- `:shipit:` (Used in approval messages)

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
    - `chat:write`, `channels:history`, `groups:history` (for private channels), `reactions:read`, `commands`, `users:read`.
2.  **Events**:
    - Subscribe to `reaction_added` and `reaction_removed`.
    - Request URL: `https://your-domain.com/slack/events`
3.  **Slash Command**:
    - Command: `/pr`
    - Request URL: `https://your-domain.com/slack/commands`

## License

ISC
