/**
 * backend/services/messaging.js — Generic messaging inbox (threads + entries).
 */

const logger = require("./logger").child({ component: "messaging-service" });

/**
 * Find or create a message thread by channel + identifier.
 */
async function findOrCreateThread(db, { channel, channelIdentifier, customerId }) {
  // Try to find existing thread
  const { rows: [existing] } = await db.query(
    "SELECT * FROM message_threads WHERE channel = $1 AND channel_identifier = $2",
    [channel, channelIdentifier]
  );
  if (existing) return existing;

  // Auto-resolve customer from mobile if not provided
  let resolvedCustomerId = customerId || null;
  if (!resolvedCustomerId && channel === "whatsapp") {
    const { rows: [cust] } = await db.query(
      "SELECT id FROM customers WHERE mobile = $1 AND deleted_at IS NULL LIMIT 1",
      [channelIdentifier]
    );
    if (cust) resolvedCustomerId = cust.id;
  }

  const { rows: [thread] } = await db.query(
    `INSERT INTO message_threads (channel, channel_identifier, customer_id, status, unread_count, last_message_at)
     VALUES ($1, $2, $3, 'open', 0, NOW()) RETURNING *`,
    [channel, channelIdentifier, resolvedCustomerId]
  );

  logger.info({ threadId: thread.id, channel, channelIdentifier }, "New message thread created");
  return thread;
}

/**
 * Add a message to a thread. Updates unread count and last_message_at.
 */
async function addMessage(db, { threadId, direction, content, messageType, externalId, senderType, senderId }) {
  const { rows: [entry] } = await db.query(
    `INSERT INTO message_entries (thread_id, direction, content, message_type, external_id, sender_type, sender_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'delivered') RETURNING *`,
    [threadId, direction, content, messageType || "text", externalId || null, senderType || "customer", senderId || null]
  );

  if (direction === "inbound") {
    await db.query(
      "UPDATE message_threads SET unread_count = unread_count + 1, last_message_at = NOW(), updated_at = NOW() WHERE id = $1",
      [threadId]
    );
  } else {
    // Staff reply resets unread count
    await db.query(
      "UPDATE message_threads SET unread_count = 0, last_message_at = NOW(), updated_at = NOW() WHERE id = $1",
      [threadId]
    );
  }

  return entry;
}

module.exports = { findOrCreateThread, addMessage };
