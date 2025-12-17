// socket-server.js - Socket.IO Server for Cross-Domain Chat
const socketIO = require('socket.io');

/**
 * Initialize Socket.IO with cross-subdomain support
 * Supports chat between:
 * - rehabplus.lantavafix.com
 * - famcare.lantavafix.com
 */
function initializeSocketIO(server, db) {
    const io = socketIO(server, {
        cors: {
            origin: [
                'https://rehabplus.lantavafix.com',
                'https://famcare.lantavafix.com',
                'http://localhost:3000',
                'http://localhost:3001'
            ],
            methods: ['GET', 'POST'],
            credentials: true,
            allowedHeaders: ['Content-Type', 'Authorization']
        },
        path: '/socket.io/',
        transports: ['websocket', 'polling'],
        pingTimeout: 60000,
        pingInterval: 25000
    });

    // Store active connections: { userId: socketId }
    const activeUsers = new Map();

    // Store user domains: { userId: domain }
    const userDomains = new Map();

    io.on('connection', (socket) => {
        console.log(`[SOCKET] New connection: ${socket.id}`);

        // User Authentication
        socket.on('authenticate', async ({ userId, userRole, userEmail, domain }) => {
            try {
                // Verify user exists in database
                const [users] = await db.execute(
                    'SELECT id, email, role FROM users WHERE id = ?',
                    [userId]
                );

                if (users.length === 0) {
                    socket.emit('auth_error', { message: 'User not found' });
                    return;
                }

                // Store user connection
                socket.userId = userId;
                socket.userRole = userRole;
                socket.userEmail = userEmail;
                socket.domain = domain;

                activeUsers.set(userId, socket.id);
                userDomains.set(userId, domain);

                // Join user's personal room
                socket.join(`user:${userId}`);

                // Join domain room (for domain-specific broadcasts)
                socket.join(`domain:${domain}`);

                console.log(`[SOCKET] User ${userId} authenticated from ${domain}`);

                // Notify user of successful connection
                socket.emit('authenticated', {
                    userId,
                    connectedUsers: Array.from(activeUsers.keys())
                });

                // Broadcast to all users that someone is online
                io.emit('user_online', { userId, domain });

                // Load recent conversations for this user
                await loadUserConversations(socket, userId, db);
            } catch (error) {
                console.error('[SOCKET] Authentication error:', error);
                socket.emit('auth_error', { message: 'Authentication failed' });
            }
        });

        // Send Message
        socket.on('send_message', async ({ recipientId, message, conversationId }) => {
            try {
                if (!socket.userId) {
                    socket.emit('error', { message: 'Not authenticated' });
                    return;
                }

                const senderId = socket.userId;
                const timestamp = new Date();

                // Save message to database
                const [result] = await db.execute(
                    `INSERT INTO chat_messages
                    (conversation_id, sender_id, recipient_id, message, created_at)
                    VALUES (?, ?, ?, ?, ?)`,
                    [conversationId || null, senderId, recipientId, message, timestamp]
                );

                const messageId = result.insertId;

                // Get conversation ID if not provided
                let finalConversationId = conversationId;
                if (!conversationId) {
                    // Create or get conversation
                    const [conv] = await db.execute(
                        `INSERT INTO chat_conversations
                        (user1_id, user2_id, last_message_at, created_at)
                        VALUES (?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE
                        last_message_at = VALUES(last_message_at),
                        id = LAST_INSERT_ID(id)`,
                        [Math.min(senderId, recipientId), Math.max(senderId, recipientId), timestamp, timestamp]
                    );
                    finalConversationId = conv.insertId;

                    // Update the message with conversation_id
                    await db.execute(
                        'UPDATE chat_messages SET conversation_id = ? WHERE id = ?',
                        [finalConversationId, messageId]
                    );
                }

                const messageData = {
                    id: messageId,
                    conversationId: finalConversationId,
                    senderId,
                    recipientId,
                    message,
                    timestamp: timestamp.toISOString(),
                    senderDomain: socket.domain
                };

                // Send to sender (confirmation)
                socket.emit('message_sent', messageData);

                // Send to recipient (if online)
                const recipientSocketId = activeUsers.get(recipientId);
                if (recipientSocketId) {
                    io.to(recipientSocketId).emit('new_message', messageData);
                } else {
                    console.log(`[SOCKET] Recipient ${recipientId} is offline`);
                }

                // Update conversation last message time
                await db.execute(
                    'UPDATE chat_conversations SET last_message_at = ? WHERE id = ?',
                    [timestamp, finalConversationId]
                );

            } catch (error) {
                console.error('[SOCKET] Send message error:', error);
                socket.emit('error', { message: 'Failed to send message' });
            }
        });

        // Mark Messages as Read
        socket.on('mark_read', async ({ conversationId }) => {
            try {
                if (!socket.userId) return;

                await db.execute(
                    `UPDATE chat_messages
                    SET read_at = NOW()
                    WHERE conversation_id = ?
                    AND recipient_id = ?
                    AND read_at IS NULL`,
                    [conversationId, socket.userId]
                );

                socket.emit('messages_marked_read', { conversationId });
            } catch (error) {
                console.error('[SOCKET] Mark read error:', error);
            }
        });

        // Typing Indicator
        socket.on('typing', ({ recipientId, isTyping }) => {
            const recipientSocketId = activeUsers.get(recipientId);
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('user_typing', {
                    userId: socket.userId,
                    isTyping
                });
            }
        });

        // Disconnect
        socket.on('disconnect', () => {
            if (socket.userId) {
                activeUsers.delete(socket.userId);
                userDomains.delete(socket.userId);

                // Notify all users that someone went offline
                io.emit('user_offline', { userId: socket.userId });

                console.log(`[SOCKET] User ${socket.userId} disconnected`);
            }
        });
    });

    return io;
}

// Helper function to load user conversations
async function loadUserConversations(socket, userId, db) {
    try {
        const [conversations] = await db.execute(
            `SELECT
                c.id as conversation_id,
                c.last_message_at,
                IF(c.user1_id = ?, c.user2_id, c.user1_id) as other_user_id,
                u.first_name,
                u.last_name,
                u.email,
                u.role,
                (SELECT COUNT(*) FROM chat_messages
                 WHERE conversation_id = c.id
                 AND recipient_id = ?
                 AND read_at IS NULL) as unread_count
            FROM chat_conversations c
            JOIN users u ON u.id = IF(c.user1_id = ?, c.user2_id, c.user1_id)
            WHERE c.user1_id = ? OR c.user2_id = ?
            ORDER BY c.last_message_at DESC
            LIMIT 50`,
            [userId, userId, userId, userId, userId]
        );

        socket.emit('conversations_loaded', { conversations });
    } catch (error) {
        console.error('[SOCKET] Load conversations error:', error);
    }
}

module.exports = { initializeSocketIO };