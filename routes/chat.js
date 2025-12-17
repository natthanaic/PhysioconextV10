// routes/chat.js - Chat API Routes
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

// GET /api/chat/conversations - Get all conversations for current user
router.get('/conversations', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;

        const [conversations] = await db.execute(
            `SELECT
                c.id,
                c.last_message_at,
                c.created_at,
                IF(c.user1_id = ?, c.user2_id, c.user1_id) as other_user_id,
                CONCAT_WS(' ', u.first_name, u.last_name) as other_user_name,
                u.email as other_user_email,
                u.role as other_user_role,
                (SELECT message FROM chat_messages
                 WHERE conversation_id = c.id
                 ORDER BY created_at DESC LIMIT 1) as last_message,
                (SELECT COUNT(*) FROM chat_messages
                 WHERE conversation_id = c.id
                 AND recipient_id = ?
                 AND read_at IS NULL) as unread_count
            FROM chat_conversations c
            JOIN users u ON u.id = IF(c.user1_id = ?, c.user2_id, c.user1_id)
            WHERE c.user1_id = ? OR c.user2_id = ?
            ORDER BY c.last_message_at DESC`,
            [userId, userId, userId, userId, userId]
        );

        res.json({ conversations });
    } catch (error) {
        console.error('Get conversations error:', error);
        res.status(500).json({ error: 'Failed to load conversations' });
    }
});

// GET /api/chat/messages/:conversationId - Get messages for a conversation
router.get('/messages/:conversationId', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const { conversationId } = req.params;
        const { limit = 50, offset = 0 } = req.query;

        // Verify user is part of this conversation
        const [conversations] = await db.execute(
            `SELECT * FROM chat_conversations
            WHERE id = ? AND (user1_id = ? OR user2_id = ?)`,
            [conversationId, userId, userId]
        );

        if (conversations.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Get messages
        const [messages] = await db.execute(
            `SELECT
                m.id,
                m.sender_id,
                m.recipient_id,
                m.message,
                m.created_at,
                m.read_at,
                CONCAT_WS(' ', u.first_name, u.last_name) as sender_name,
                u.email as sender_email
            FROM chat_messages m
            JOIN users u ON u.id = m.sender_id
            WHERE m.conversation_id = ?
            ORDER BY m.created_at DESC
            LIMIT ? OFFSET ?`,
            [conversationId, parseInt(limit), parseInt(offset)]
        );

        // Mark messages as read
        await db.execute(
            `UPDATE chat_messages
            SET read_at = NOW()
            WHERE conversation_id = ?
            AND recipient_id = ?
            AND read_at IS NULL`,
            [conversationId, userId]
        );

        res.json({ messages: messages.reverse() }); // Reverse to show oldest first
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ error: 'Failed to load messages' });
    }
});

// POST /api/chat/messages - Send a message (fallback for when Socket.IO is not available)
router.post('/messages', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const { conversationId, recipientId, message } = req.body;

        if (!conversationId || !recipientId || !message) {
            return res.status(400).json({ error: 'conversationId, recipientId, and message are required' });
        }

        // Verify user is part of this conversation
        const [conversations] = await db.execute(
            `SELECT * FROM chat_conversations
            WHERE id = ? AND (user1_id = ? OR user2_id = ?)`,
            [conversationId, userId, userId]
        );

        if (conversations.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Insert message
        const [result] = await db.execute(
            `INSERT INTO chat_messages (conversation_id, sender_id, recipient_id, message, created_at)
            VALUES (?, ?, ?, ?, NOW())`,
            [conversationId, userId, recipientId, message]
        );

        // Update conversation last_message_at
        await db.execute(
            `UPDATE chat_conversations SET last_message_at = NOW() WHERE id = ?`,
            [conversationId]
        );

        const messageId = result.insertId;

        // Get the created message
        const [messages] = await db.execute(
            `SELECT
                m.id,
                m.sender_id,
                m.recipient_id,
                m.message,
                m.created_at,
                m.read_at,
                CONCAT_WS(' ', u.first_name, u.last_name) as sender_name
            FROM chat_messages m
            JOIN users u ON u.id = m.sender_id
            WHERE m.id = ?`,
            [messageId]
        );

        res.json({
            success: true,
            message: messages[0]
        });
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// POST /api/chat/conversation - Create or get conversation with another user
router.post('/conversation', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const { otherUserId } = req.body;

        if (!otherUserId) {
            return res.status(400).json({ error: 'otherUserId is required' });
        }

        // Check if other user exists
        const [otherUser] = await db.execute(
            'SELECT id, first_name, last_name, email, role FROM users WHERE id = ?',
            [otherUserId]
        );

        if (otherUser.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Create or get existing conversation
        const user1 = Math.min(userId, otherUserId);
        const user2 = Math.max(userId, otherUserId);

        const [result] = await db.execute(
            `INSERT INTO chat_conversations (user1_id, user2_id, created_at, last_message_at)
            VALUES (?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
            [user1, user2]
        );

        const conversationId = result.insertId;

        res.json({
            conversationId,
            otherUser: {
                id: otherUser[0].id,
                name: `${otherUser[0].first_name} ${otherUser[0].last_name}`,
                email: otherUser[0].email,
                role: otherUser[0].role
            }
        });
    } catch (error) {
        console.error('Create conversation error:', error);
        res.status(500).json({ error: 'Failed to create conversation' });
    }
});

// GET /api/chat/users - Get all users available for chat
router.get('/users', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const { search = '' } = req.query;

        let query = `
            SELECT
                id,
                CONCAT_WS(' ', first_name, last_name) as name,
                email,
                role
            FROM users
            WHERE id != ?
        `;
        const params = [userId];

        if (search) {
            query += ` AND (
                CONCAT_WS(' ', first_name, last_name) LIKE ?
                OR email LIKE ?
            )`;
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern);
        }

        query += ` ORDER BY first_name, last_name LIMIT 50`;

        const [users] = await db.execute(query, params);

        res.json({ users });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Failed to load users' });
    }
});

// DELETE /api/chat/conversation/:id - Delete a conversation
router.delete('/conversation/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const { id } = req.params;

        // Verify user owns this conversation
        const [conversations] = await db.execute(
            `SELECT * FROM chat_conversations
            WHERE id = ? AND (user1_id = ? OR user2_id = ?)`,
            [id, userId, userId]
        );

        if (conversations.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Delete messages first (foreign key constraint)
        await db.execute('DELETE FROM chat_messages WHERE conversation_id = ?', [id]);

        // Delete conversation
        await db.execute('DELETE FROM chat_conversations WHERE id = ?', [id]);

        res.json({ message: 'Conversation deleted successfully' });
    } catch (error) {
        console.error('Delete conversation error:', error);
        res.status(500).json({ error: 'Failed to delete conversation' });
    }
});

// POST /api/chat/typing - Update typing status
router.post('/typing', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const { conversationId, isTyping } = req.body;

        if (!conversationId) {
            return res.status(400).json({ error: 'conversationId is required' });
        }

        // Store typing status in memory (or use Redis for production)
        // For simplicity, we'll use a temporary table
        if (isTyping) {
            await db.execute(
                `INSERT INTO chat_typing_status (conversation_id, user_id, last_typing_at)
                VALUES (?, ?, NOW())
                ON DUPLICATE KEY UPDATE last_typing_at = NOW()`,
                [conversationId, userId]
            );
        } else {
            await db.execute(
                `DELETE FROM chat_typing_status WHERE conversation_id = ? AND user_id = ?`,
                [conversationId, userId]
            );
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Update typing status error:', error);
        res.status(500).json({ error: 'Failed to update typing status' });
    }
});

// GET /api/chat/typing/:conversationId - Get typing status
router.get('/typing/:conversationId', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const { conversationId } = req.params;

        // Get users currently typing (within last 5 seconds)
        const [typingUsers] = await db.execute(
            `SELECT
                u.id,
                CONCAT_WS(' ', u.first_name, u.last_name) as name
            FROM chat_typing_status t
            JOIN users u ON u.id = t.user_id
            WHERE t.conversation_id = ?
            AND t.user_id != ?
            AND t.last_typing_at > DATE_SUB(NOW(), INTERVAL 5 SECOND)`,
            [conversationId, userId]
        );

        res.json({
            isTyping: typingUsers.length > 0,
            users: typingUsers
        });
    } catch (error) {
        console.error('Get typing status error:', error);
        res.status(500).json({ error: 'Failed to get typing status' });
    }
});

module.exports = router;