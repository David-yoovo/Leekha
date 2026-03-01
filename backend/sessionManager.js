const { v4: uuidv4 } = require('uuid');

class SessionManager {
    constructor() {
        // userId -> { username, socketId, roomId, lastSeen, disconnectedAt }
        this.sessions = new Map();
        // socketId -> userId (reverse lookup)
        this.socketToUser = new Map();
        
        // Reconnection grace period (60 seconds)
        this.RECONNECT_GRACE_PERIOD = 60 * 1000;
        // Session expiry (24 hours of total inactivity)
        this.SESSION_EXPIRY = 24 * 60 * 60 * 1000;
        
        // Cleanup expired sessions every 10 minutes
        setInterval(() => this.cleanupExpiredSessions(), 10 * 60 * 1000);
    }

    /**
     * Register or re-identify a user by userId.
     * If userId exists, update socketId. If not, create new session.
     * Returns { userId, isReconnect, previousRoomId }
     */
    registerUser(socketId, userId, username) {
        // Check if this is a returning user
        if (userId && this.sessions.has(userId)) {
            const session = this.sessions.get(userId);
            const oldSocketId = session.socketId;
            
            // Update socket mapping
            if (oldSocketId) {
                this.socketToUser.delete(oldSocketId);
            }
            
            session.socketId = socketId;
            session.lastSeen = Date.now();
            session.disconnectedAt = null;
            
            // Update username if provided
            if (username) {
                session.username = username;
            }
            
            this.socketToUser.set(socketId, userId);
            
            return {
                userId,
                isReconnect: !!session.roomId,
                previousRoomId: session.roomId,
                username: session.username
            };
        }
        
        // New user - generate userId
        const newUserId = userId || uuidv4();
        const session = {
            userId: newUserId,
            username: username || null,
            socketId,
            roomId: null,
            lastSeen: Date.now(),
            disconnectedAt: null
        };
        
        this.sessions.set(newUserId, session);
        this.socketToUser.set(socketId, newUserId);
        
        return {
            userId: newUserId,
            isReconnect: false,
            previousRoomId: null,
            username: null
        };
    }

    /**
     * Handle user disconnect — mark as disconnected, don't remove yet.
     * Returns session info for grace period handling.
     */
    handleDisconnect(socketId) {
        const userId = this.socketToUser.get(socketId);
        if (!userId) return null;
        
        const session = this.sessions.get(userId);
        if (!session) return null;
        
        session.disconnectedAt = Date.now();
        session.socketId = null;
        this.socketToUser.delete(socketId);
        
        return {
            userId,
            roomId: session.roomId,
            username: session.username
        };
    }

    /**
     * Check if a user is within the reconnection grace period.
     */
    isWithinGracePeriod(userId) {
        const session = this.sessions.get(userId);
        if (!session || !session.disconnectedAt) return false;
        return (Date.now() - session.disconnectedAt) < this.RECONNECT_GRACE_PERIOD;
    }

    /**
     * Get session by userId.
     */
    getSession(userId) {
        return this.sessions.get(userId);
    }

    /**
     * Get userId by socketId.
     */
    getUserIdBySocket(socketId) {
        return this.socketToUser.get(socketId);
    }

    /**
     * Set user's room.
     */
    setUserRoom(userId, roomId) {
        const session = this.sessions.get(userId);
        if (session) {
            session.roomId = roomId;
        }
    }

    /**
     * Set user's username.
     */
    setUsername(userId, username) {
        const session = this.sessions.get(userId);
        if (session) {
            session.username = username;
        }
    }

    /**
     * Clear user's room assignment.
     */
    clearUserRoom(userId) {
        const session = this.sessions.get(userId);
        if (session) {
            session.roomId = null;
        }
    }

    /**
     * Cleanup expired sessions.
     */
    cleanupExpiredSessions() {
        const now = Date.now();
        for (const [userId, session] of this.sessions) {
            if (!session.socketId && (now - session.lastSeen) > this.SESSION_EXPIRY) {
                this.sessions.delete(userId);
                console.log(`Cleaned up expired session: ${userId}`);
            }
        }
    }
}

module.exports = SessionManager;
