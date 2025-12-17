/**
 * CONEXT CHAT CLIENT - Socket.IO Implementation
 * Supports cross-domain chat between subdomains
 * - rehabplus.lantavafix.com
 * - famcare.lantavafix.com
 */

let socket = null;
let currentConversationId = null;
let currentRecipientId = null;

document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const messagesContainer = document.getElementById('messagesContainer');
    const messageInput = document.getElementById('messageInput');
    const sidebar = document.getElementById('conversationSidebar');
    const sendBtn = document.getElementById('sendBtn');
    const conversationsList = document.getElementById('conversationsList');

    // Get current domain
    const currentDomain = window.location.hostname;

    // Check if chat backend is available
    checkChatAvailability().then(isAvailable => {
        if (isAvailable) {
            // Initialize Socket.IO
            initializeSocket();

            // Initialize UI
            scrollToBottom();

            // Load conversations
            loadConversations();
        } else {
            // Show message that chat is not configured yet
            if (conversationsList) {
                conversationsList.innerHTML = `
                    <div class="text-center text-muted p-4">
                        <i class="bi bi-chat-dots-fill fs-1 d-block mb-3 opacity-50"></i>
                        <h6 class="fw-bold">Chat Feature Not Configured</h6>
                        <p class="small mb-0">The chat backend needs to be set up in Plesk.</p>
                        <p class="small text-muted">Contact your administrator for assistance.</p>
                    </div>
                `;
            }
            console.log('[CHAT] Backend not available - chat disabled');
        }
    });

    // Event Listeners
    if (messageInput) {
        // Auto-resize textarea
        messageInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
            if (this.value === '') this.style.height = 'auto';
        });

        // Handle Enter Key
        messageInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // Typing indicator
        let typingTimer;
        messageInput.addEventListener('input', function() {
            if (currentRecipientId && socket) {
                clearTimeout(typingTimer);
                socket.emit('typing', { recipientId: currentRecipientId, isTyping: true });
                typingTimer = setTimeout(() => {
                    socket.emit('typing', { recipientId: currentRecipientId, isTyping: false });
                }, 1000);
            }
        });
    }

    if (sendBtn) {
        sendBtn.addEventListener('click', sendMessage);
    }

    // New Message Button - Show all users
    const newMessageBtn = document.querySelector('.btn-light.rounded-circle');
    if (newMessageBtn) {
        newMessageBtn.addEventListener('click', showAllUsers);
    }

    // --- Check if chat backend is available ---

    async function checkChatAvailability() {
        try {
            const token = getCookie('token');
            const response = await fetch('/api/test', {
                headers: {
                }
            });

            // If test endpoint returns JSON, backend is working
            if (response.ok) {
                const data = await response.json();
                return data.success === true;
            }
            return false;
        } catch (error) {
            console.log('[CHAT] Backend check failed:', error);
            return false;
        }
    }

    // --- Socket.IO Functions ---

    function initializeSocket() {
        // Connect to Socket.IO server
        const socketUrl = window.location.origin;

        socket = io(socketUrl, {
            path: '/socket.io/',
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: 5
        });

        socket.on('connect', () => {
            console.log('[CHAT] Connected to Socket.IO server');

            // Authenticate user
            if (window.userInfo) {
                socket.emit('authenticate', {
                    userId: window.userInfo.id,
                    userRole: window.userInfo.role,
                    userEmail: window.userInfo.email,
                    domain: currentDomain
                });
            }
        });

        socket.on('authenticated', (data) => {
            console.log('[CHAT] Authenticated successfully', data);
            showNotification('Connected to chat', 'success');
        });

        socket.on('auth_error', (data) => {
            console.error('[CHAT] Authentication error:', data.message);
            showNotification('Authentication failed', 'error');
        });

        socket.on('conversations_loaded', (data) => {
            renderConversations(data.conversations);
        });

        socket.on('message_sent', (data) => {
            console.log('[CHAT] Message sent:', data);
            appendMessage(data, true);
        });

        socket.on('new_message', (data) => {
            console.log('[CHAT] New message received:', data);

            // If the message is for the current conversation, display it
            if (data.conversationId === currentConversationId) {
                appendMessage(data, false);
                // Mark as read
                socket.emit('mark_read', { conversationId: currentConversationId });
            } else {
                // Show notification
                showNotification(`New message from ${data.senderDomain}`, 'info');
                // Reload conversations to update unread count
                loadConversations();
            }
        });

        socket.on('user_typing', (data) => {
            if (data.userId === currentRecipientId) {
                showTypingIndicator(data.isTyping);
            }
        });

        socket.on('user_online', (data) => {
            console.log('[CHAT] User online:', data.userId, 'from', data.domain);
            updateUserStatus(data.userId, true, data.domain);
        });

        socket.on('user_offline', (data) => {
            console.log('[CHAT] User offline:', data.userId);
            updateUserStatus(data.userId, false);
        });

        socket.on('disconnect', () => {
            console.log('[CHAT] Disconnected from Socket.IO server');
            showNotification('Disconnected from chat', 'warning');
        });

        socket.on('error', (data) => {
            console.error('[CHAT] Error:', data.message);
            showNotification(data.message, 'error');
        });
    }

    // --- API Functions ---

    async function loadConversations() {
        try {
            const token = getCookie('token');
            const response = await fetch('/api/chat/conversations', {
                headers: {
                }
            });

            if (!response.ok) throw new Error('Failed to load conversations');

            const data = await response.json();
            renderConversations(data.conversations);
        } catch (error) {
            console.error('Load conversations error:', error);
            showNotification('Failed to load conversations', 'error');
        }
    }

    async function loadMessages(conversationId) {
        try {
            const token = getCookie('token');
            const response = await fetch(`/api/chat/messages/${conversationId}`, {
                headers: {
                }
            });

            if (!response.ok) throw new Error('Failed to load messages');

            const data = await response.json();
            displayMessages(data.messages);
        } catch (error) {
            console.error('Load messages error:', error);
            showNotification('Failed to load messages', 'error');
        }
    }

    async function createConversation(otherUserId) {
        try {
            const token = getCookie('token');
            const response = await fetch('/api/chat/conversation', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ otherUserId })
            });

            if (!response.ok) throw new Error('Failed to create conversation');

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Create conversation error:', error);
            showNotification('Failed to create conversation', 'error');
            return null;
        }
    }

    // --- UI Functions ---

    function sendMessage() {
        const text = messageInput.value.trim();
        if (!text || !socket || !currentRecipientId) return;

        // Send via Socket.IO
        socket.emit('send_message', {
            recipientId: currentRecipientId,
            message: text,
            conversationId: currentConversationId
        });

        // Clear Input
        messageInput.value = '';
        messageInput.style.height = 'auto';
        messageInput.focus();
    }

    function appendMessage(messageData, isSent) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message-bubble ${isSent ? 'message-sent' : 'message-received'}`;

        const time = new Date(messageData.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });

        const domainBadge = messageData.senderDomain && messageData.senderDomain !== currentDomain
            ? `<span class="badge bg-info text-white ms-2">${messageData.senderDomain}</span>`
            : '';

        msgDiv.innerHTML = `
            ${escapeHtml(messageData.message)} ${domainBadge}
            <div class="message-meta">
                ${time} <i class="bi bi-check2 ${isSent ? 'text-white-50' : ''} ms-1"></i>
            </div>
        `;

        messagesContainer.appendChild(msgDiv);
        scrollToBottom();
    }

    function displayMessages(messages) {
        messagesContainer.innerHTML = '';
        messages.forEach(msg => {
            const isSent = msg.sender_id === window.userInfo.id;
            appendMessage({
                message: msg.message,
                timestamp: msg.created_at,
                senderDomain: null
            }, isSent);
        });
    }

    function renderConversations(conversations) {
        if (!conversationsList) return;

        if (conversations.length === 0) {
            conversationsList.innerHTML = `
                <div class="text-center text-muted p-4">
                    <i class="bi bi-chat-dots fs-1 d-block mb-2"></i>
                    <p class="small mb-0">No conversations yet</p>
                    <button class="btn btn-primary btn-sm mt-3" onclick="showAllUsers()">
                        <i class="bi bi-plus-circle me-1"></i>Start Chatting
                    </button>
                </div>
            `;
            return;
        }

        conversationsList.innerHTML = conversations.map(conv => `
            <div class="conversation-item ${conv.id === currentConversationId ? 'active' : ''}"
                 data-conversation-id="${conv.id}"
                 data-other-user-id="${conv.other_user_id}"
                 onclick="selectConversation(${conv.id}, ${conv.other_user_id})">
                <div class="conversation-avatar">
                    <i class="bi bi-person-circle fs-3"></i>
                </div>
                <div class="conversation-info">
                    <div class="conversation-name">${escapeHtml(conv.other_user_name)}</div>
                    <div class="conversation-preview">${escapeHtml(conv.last_message || 'No messages')}</div>
                </div>
                ${conv.unread_count > 0 ? `<span class="badge bg-primary rounded-pill">${conv.unread_count}</span>` : ''}
            </div>
        `).join('');
    }

    // Show all available users for starting new conversations
    window.showAllUsers = async function() {
        try {
            const token = getCookie('token');
            const response = await fetch('/api/chat/users', {
                headers: {
                }
            });

            if (!response.ok) throw new Error('Failed to load users');

            const data = await response.json();
            renderUsersList(data.users);
        } catch (error) {
            console.error('Load users error:', error);
            showNotification('Failed to load users', 'error');
        }
    };

    function renderUsersList(users) {
        if (!conversationsList) return;

        if (users.length === 0) {
            conversationsList.innerHTML = `
                <div class="text-center text-muted p-4">
                    <i class="bi bi-people fs-1 d-block mb-2"></i>
                    <p class="small mb-0">No users available</p>
                    <button class="btn btn-secondary btn-sm mt-2" onclick="loadConversations()">
                        <i class="bi bi-arrow-left me-1"></i>Back to Chats
                    </button>
                </div>
            `;
            return;
        }

        // Add back button and render users
        conversationsList.innerHTML = `
            <div class="p-3 border-bottom">
                <button class="btn btn-sm btn-light" onclick="location.reload()">
                    <i class="bi bi-arrow-left me-2"></i>Back to Conversations
                </button>
            </div>
            <div class="p-2">
                <small class="text-muted fw-bold px-2">ALL USERS (${users.length})</small>
            </div>
        ` + users.map(user => `
            <div class="conversation-item" onclick="startConversationWith(${user.id}, '${escapeHtml(user.name)}')">
                <div class="conversation-avatar" style="background: ${getRoleColor(user.role)}">
                    ${getInitials(user.name)}
                </div>
                <div class="conversation-info">
                    <div class="conversation-name">
                        ${escapeHtml(user.name)}
                        <span class="badge badge-sm ms-2" style="font-size: 0.65rem; padding: 2px 6px; background: ${getRoleBadgeColor(user.role)}">
                            ${user.role}
                        </span>
                    </div>
                    <div class="conversation-preview">${escapeHtml(user.email)}</div>
                </div>
                <i class="bi bi-chat-left-dots text-primary"></i>
            </div>
        `).join('');
    }

    // Start a conversation with a specific user
    window.startConversationWith = async function(userId, userName) {
        try {
            const token = getCookie('token');
            const response = await fetch('/api/chat/conversation', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ otherUserId: userId })
            });

            if (!response.ok) throw new Error('Failed to create conversation');

            const data = await response.json();

            // Reload conversations and select the new one
            await loadConversations();
            await selectConversation(data.conversationId, userId);

            showNotification(`Started chat with ${userName}`, 'success');
        } catch (error) {
            console.error('Start conversation error:', error);
            showNotification('Failed to start conversation', 'error');
        }
    };

    // Helper functions for user list
    function getInitials(name) {
        if (!name) return '?';
        const parts = name.split(' ');
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    }

    function getRoleColor(role) {
        const colors = {
            'ADMIN': '#ef4444',
            'CLINIC': '#3b82f6',
            'PT': '#10b981',
            'default': '#6b7280'
        };
        return colors[role] || colors.default;
    }

    function getRoleBadgeColor(role) {
        const colors = {
            'ADMIN': '#dc2626',
            'CLINIC': '#2563eb',
            'PT': '#059669',
            'default': '#4b5563'
        };
        return colors[role] || colors.default;
    }

    // Global function for clicking conversations
    window.selectConversation = async function(conversationId, otherUserId) {
        currentConversationId = conversationId;
        currentRecipientId = otherUserId;

        // Update UI
        document.querySelectorAll('.conversation-item').forEach(item => {
            item.classList.remove('active');
        });
        event.currentTarget.classList.add('active');

        // Load messages
        await loadMessages(conversationId);

        // Mark as read
        if (socket) {
            socket.emit('mark_read', { conversationId });
        }
    };

    function showTypingIndicator(isTyping) {
        let indicator = document.getElementById('typingIndicator');

        if (isTyping) {
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.id = 'typingIndicator';
                indicator.className = 'text-muted small mb-2';
                indicator.innerHTML = '<i class="bi bi-three-dots"></i> typing...';
                messagesContainer.appendChild(indicator);
                scrollToBottom();
            }
        } else {
            if (indicator) {
                indicator.remove();
            }
        }
    }

    function updateUserStatus(userId, isOnline, domain) {
        // Update conversation items with online status
        const conversationItems = document.querySelectorAll(`[data-other-user-id="${userId}"]`);
        conversationItems.forEach(item => {
            if (isOnline) {
                item.classList.add('user-online');
                if (domain) {
                    item.dataset.domain = domain;
                }
            } else {
                item.classList.remove('user-online');
            }
        });
    }

    function showNotification(message, type = 'info') {
        // Simple notification (you can enhance this)
        console.log(`[${type.toUpperCase()}]`, message);

        // You can add a toast notification here
        const alert = document.createElement('div');
        alert.className = `alert alert-${type === 'error' ? 'danger' : type} position-fixed top-0 end-0 m-3`;
        alert.style.zIndex = '9999';
        alert.innerHTML = message;
        document.body.appendChild(alert);

        setTimeout(() => alert.remove(), 3000);
    }

    function scrollToBottom() {
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    // Escaping HTML for security
    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Get cookie helper
    );