import bolt from "@slack/bolt";
import dotenv from "dotenv";

console.log("ENV CHECK:", {
    hasToken: Boolean(process.env.SLACK_BOT_TOKEN),
    hasSigning: Boolean(process.env.SLACK_SIGNING_SECRET),
    tokenPrefix: process.env.SLACK_BOT_TOKEN?.slice(0, 4),
});
if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_SIGNING_SECRET) {
    console.error("Missing required env vars. Exiting.");
    process.exit(1);
}

const { App, ExpressReceiver } = bolt;

dotenv.config();

interface DeletionTimer {
    timeoutId: NodeJS.Timeout;
    warnTs?: string;
}

// In-memory store for pending deletions: key = "channel:ts"
const deletionTimers = new Map<string, DeletionTimer>();
// In-memory store for processing reactions to prevent race conditions
const processingReactions = new Set<string>();
// Store bot's own ID
let myBotId: string | undefined = undefined;

/* ----------------------------
   Constants
----------------------------- */
const REACTIONS = {
    COMMENT: "speech_balloon",
    APPROVED: "white_check_mark",
    MERGED: "merged",
    UPDATED: "repeat",
} as const;

const MESSAGES = {
    COMMENT_OWN: (authorId: string, reviewerId: string) =>
        `<@${authorId}>, a comment or two was left on your PR by <@${reviewerId}>.`,
    COMMENT_OTHER: "Someone made a comment or two on this PR.",
    APPROVED_OWN: (id: string) => `<@${id}>, your PR has been approved, time to ship it! :shipit:`,
    APPROVED_OTHER: "This PR has been approved, time to ship it! :shipit:",
    MERGED_WARNING:
        "This PR entry will be deleted in 30 seconds. Remove the :merged: reaction to cancel.",
    MERGED_WARNING_OWN: (id: string) =>
        `<@${id}> heads up - this PR entry will be deleted in 30 seconds. Remove the :merged: reaction to cancel.`,
};

/* ----------------------------
   Helper: Complexity Formatting
----------------------------- */
function formatComplexity(level: string | undefined): string {
    if (!level) return "⚪ *Unknown*";

    switch (level.toLowerCase()) {
        case "ez":
            return ":ez:";
        case "medium":
            return "🟨 *Medium*";
        case "large":
            return "🟥 *Large*";
        default:
            return "⚪ *Unknown*";
    }
}

/* ----------------------------
   Helper: Parse author from message text
----------------------------- */
function getAuthorIdFromText(text: string): string | null {
    const match = text.match(/Author:\s*<@([A-Z0-9]+)>/i);
    return match ? match[1] : null;
}

/* ----------------------------
   Helper: Update Channel Topic
----------------------------- */
async function updateChannelTopic(client: any, channelId: string) {
    try {
        // Fetch recent history to count active PRs
        const result = await client.conversations.history({
            channel: channelId,
            limit: 100,
        });

        const messages = result.messages || [];
        let ezCount = 0;
        let mediumCount = 0;
        let largeCount = 0;

        for (const msg of messages) {
            // Filter for messages from this bot that contain "Complexity:"
            // We use a loose check on text to catch our PR posts
            if (msg.bot_id && msg.text && msg.text.includes("Complexity:")) {
                const text = msg.text.toLowerCase();
                if (text.includes(":ez:")) {
                    ezCount++;
                } else if (text.includes("medium")) {
                    mediumCount++;
                } else if (text.includes("large")) {
                    largeCount++;
                }
            }
        }

        const topic = `PR Stats: :ez: ${ezCount} | 🟨 Medium: ${mediumCount} | 🟥 Large: ${largeCount}`;

        await client.conversations.setTopic({
            channel: channelId,
            topic,
        });

    } catch (error) {
        console.error("Failed to update channel topic:", error);
    }
}

/* ----------------------------
   Slack Receiver (custom endpoints)
----------------------------- */
const receiver = new ExpressReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET || "",
    endpoints: {
        commands: "/slack/commands",
        events: "/slack/events",
    },
});

/* ----------------------------
   Slack App
----------------------------- */
const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    receiver,
});

/* ----------------------------
   Slash Command: /pr <url> [complexity]
----------------------------- */
app.command("/pr", async ({ command, ack, respond, client, logger }) => {
    await ack();

    const parts = command.text.split(/\s+/);
    const prUrl = parts[0];
    const complexityRaw = parts[1]; // may be undefined
    const complexity = formatComplexity(complexityRaw);

    if (!prUrl) {
        await respond({
            response_type: "ephemeral",
            text: "Usage: /pr <url> [complexity]\nExample: `/pr https://github.com/... ez`",
        });
        return;
    }

    try {
        await client.chat.postMessage({
            channel: command.channel_id,
            text:
                `Link: <${prUrl}|Link to PR on GitHub>
Author: <@${command.user_id}>
Complexity: ${complexity}`,
        });

        // Update the channel topic with new stats
        await updateChannelTopic(client, command.channel_id);

    } catch (err) {
        logger.error(err);
        await respond({
            response_type: "ephemeral",
            text: "Error: Failed to post PR.",
        });
    }
});

/* ----------------------------
   Reaction Added
----------------------------- */
app.event("reaction_added", async ({ event, client, logger }) => {
    try {
        if (event.item.type !== "message") return;

        const channel = event.item.channel;
        const ts = event.item.ts;
        const key = `${channel}:${ts}`;

        // Mark as processing to handle race conditions
        processingReactions.add(key);

        try {
            // Fetch the message reacted to
            const history = await client.conversations.history({
                channel,
                latest: ts,
                inclusive: true,
                limit: 1,
            });

            const message = history.messages?.[0];

            // Security Check: Only react to our OWN messages
            // We check myBotId (B-ID) against message.bot_id
            if (!message || message.bot_id !== myBotId) {
                return;
            }

            const authorId = getAuthorIdFromText(message.text || "");

            /* -------------------------------------------
               :speech_balloon: -> Comment notification
            ------------------------------------------- */
            if (event.reaction === REACTIONS.COMMENT) {
                const reviewerId = event.user;

                const text = authorId
                    ? MESSAGES.COMMENT_OWN(authorId, reviewerId)
                    : MESSAGES.COMMENT_OTHER;

                await client.chat.postMessage({
                    channel,
                    thread_ts: ts,
                    text,
                });

                return;
            }

            /* -------------------------------------------
               :white_check_mark: -> Approval notification
            ------------------------------------------- */
            if (event.reaction === REACTIONS.APPROVED) {
                const text = authorId ? MESSAGES.APPROVED_OWN(authorId) : MESSAGES.APPROVED_OTHER;

                await client.chat.postMessage({
                    channel,
                    thread_ts: ts,
                    text,
                });
                return;
            }

            /* -------------------------------------------
                :repeat: -> Author says “comments fixed”
            ------------------------------------------- */
            if (event.reaction === REACTIONS.UPDATED) {
                const replies = await client.conversations.replies({
                    channel,
                    ts,
                    limit: 100,
                });

                const reviewers = new Set<string>();

                const reviewerRegex = /left on your PR by <@([A-Z0-9]+)>/;

                for (const msg of replies.messages || []) {
                    const match = msg.text?.match(reviewerRegex);
                    if (match) reviewers.add(match[1]);
                }


                if (reviewers.size === 0) {
                    await client.chat.postMessage({
                        channel,
                        thread_ts: ts,
                        text: "Updates were made, but no reviewers were detected.",
                    });
                    return;
                }

                const mentions = [...reviewers].map(id => `<@${id}>`).join(" ");

                await client.chat.postMessage({
                    channel,
                    thread_ts: ts,
                    text: `${mentions} - The PR author has updated the PR - please review again`,
                });

                return;
            }


            /* -------------------------------------------
                :merged: -> Start deletion timer
            ------------------------------------------- */
            if (event.reaction === REACTIONS.MERGED) {
                // Check if deletion was cancelled while we were fetching history
                if (!processingReactions.has(key)) {
                    logger.info(`Processing cancelled for ${key}`);
                    return;
                }

                // Already scheduled?
                if (deletionTimers.has(key)) return;

                // Warning message
                let warnText = MESSAGES.MERGED_WARNING;
                if (authorId) {
                    warnText = MESSAGES.MERGED_WARNING_OWN(authorId);
                }

                const warnMsg = await client.chat.postMessage({
                    channel,
                    thread_ts: ts,
                    text: warnText,
                });

                // Schedule deletion
                const timeoutId = setTimeout(async () => {
                    try {
                        // Re-verify reaction presence
                        const reactionsInfo = await client.reactions.get({
                            channel,
                            timestamp: ts,
                        });

                        const reactions = reactionsInfo.message?.reactions || [];
                        const stillHasMerged = reactions.some((r) => r.name === REACTIONS.MERGED);

                        if (!stillHasMerged) {
                            // Was removed, but maybe race condition handled it?
                            // Just cleanup warning if exists
                            try {
                                if (warnMsg.ts) await client.chat.delete({ channel, ts: warnMsg.ts });
                            } catch (_e) {
                                // Ignore
                            }
                            return;
                        }

                        // --- Safe Thread Cleanup ---
                        try {
                            // 1. Fetch replies
                            const replies = await client.conversations.replies({
                                channel,
                                ts,
                                limit: 100, // Reasonable limit for a PR thread
                            });

                            const messages = replies.messages || [];

                            // 2. Iterate and delete bot's own messages
                            // We skip the parent message (index 0 usually) because we delete it last
                            for (const msg of messages) {
                                if (msg.ts === ts) continue; // Skip parent for now

                                // Check if message is from THIS bot
                                // Uses myBotId we fetched on startup
                                if (msg.bot_id === myBotId || msg.user === myBotId) {
                                    try {
                                        await client.chat.delete({ channel, ts: msg.ts! });
                                    } catch (delErr) {
                                        logger.error(`Failed to delete reply ${msg.ts}`, delErr);
                                    }
                                }
                            }
                        } catch (threadErr) {
                            logger.error("Error fetching/cleaning thread:", threadErr);
                        }

                        // 3. Delete Parent PR message
                        await client.chat.delete({ channel, ts });

                        // Warning message is likely already deleted if it was in the thread,
                        // but we can try just in case it wasn't caught
                        if (warnMsg.ts) {
                            try {
                                await client.chat.delete({ channel, ts: warnMsg.ts });
                            } catch (_e) {
                                // Ignore
                            }
                        }
                    } catch (err) {
                        logger.error("Error in delayed deletion:", err);
                    } finally {
                        deletionTimers.delete(key);
                    }
                }, 30_000);

                deletionTimers.set(key, { timeoutId, warnTs: warnMsg.ts });
            }
        } finally {
            // Done processing this event
            processingReactions.delete(key);
        }
    } catch (err) {
        logger.error(err);
        if (event.item.type === "message") {
            processingReactions.delete(`${event.item.channel}:${event.item.ts}`);
        }
    }
});

/* ----------------------------
   Reaction Removed: cancel deletion
----------------------------- */
app.event("reaction_removed", async ({ event, client, logger }) => {
    try {
        if (event.reaction !== REACTIONS.MERGED) return;
        if (event.item.type !== "message") return;

        const key = `${event.item.channel}:${event.item.ts}`;

        // 1. Check if we are currently setting it up (race condition)
        if (processingReactions.has(key)) {
            // Signal validation to abort
            processingReactions.delete(key);
            return;
        }

        // 2. Check if timer exists
        const timerData = deletionTimers.get(key);
        if (!timerData) return;

        const { timeoutId, warnTs } = timerData;

        clearTimeout(timeoutId);
        deletionTimers.delete(key);

        // UX: Delete the warning message instead of posting "Cancelled"
        if (warnTs) {
            try {
                await client.chat.delete({
                    channel: event.item.channel,
                    ts: warnTs,
                });
            } catch (e) {
                logger.error("Failed to delete warning message", e);
            }
        }
    } catch (err) {
        logger.error(err);
    }
});

/* ----------------------------
   Start Server
----------------------------- */
const port = Number(process.env.PORT) || 3000;

(async () => {
    await app.start(port);

    // Fetch own bot ID for security checks
    try {
        const auth = await app.client.auth.test();
        myBotId = auth.bot_id;
        console.log(`Verified Bot ID: ${myBotId}`);
    } catch (e) {
        console.error("Failed to fetch Bot ID:", e);
    }

    console.log(`⚡ PR Cleanup Bot running on port ${port}`);
})();
