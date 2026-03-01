const { v4: uuidv4 } = require('uuid');

const BOT_NAMES = ['Bot Ali', 'Bot Sara', 'Bot Omar'];

class Room {
    constructor(id, hostId, hostUsername) {
        this.id = id;
        this.hostId = hostId;
        this.players = new Map(); // playerId -> { username, ready, position, isBot }
        this.maxPlayers = 4;
        this.gameInProgress = false;
        this.createdAt = Date.now();
        this.lastActivity = Date.now(); // Track last activity for session cleanup
        
        // Vacant positions during a game (positions where a player left)
        this.vacantPositions = new Set();
        
        // Add host as first player (bottom position)
        this.addPlayer(hostId, hostUsername, false);
        
        // Fill remaining slots with bots
        this.fillWithBots();
    }

    updateActivity() {
        this.lastActivity = Date.now();
    }
    
    fillWithBots() {
        const positions = ['bottom', 'left', 'top', 'right'];
        const takenPositions = Array.from(this.players.values()).map(p => p.position);
        let botIndex = 0;
        
        for (const pos of positions) {
            if (!takenPositions.includes(pos)) {
                const botId = `bot-${pos}`;
                const botName = BOT_NAMES[botIndex % BOT_NAMES.length];
                this.players.set(botId, {
                    username: botName,
                    ready: true, // Bots are always ready
                    position: pos,
                    isBot: true
                });
                botIndex++;
            }
        }
    }

    addPlayer(playerId, username, isBot = false) {
        if (this.getHumanCount() >= this.maxPlayers) {
            return false;
        }
        
        // If not a bot, find a bot to replace
        if (!isBot) {
            const positions = ['left', 'top', 'right']; // Don't replace bottom (host)
            for (const pos of positions) {
                const botId = `bot-${pos}`;
                if (this.players.has(botId)) {
                    // Replace this bot with the human
                    this.players.delete(botId);
                    this.players.set(playerId, {
                        username: username,
                        ready: false,
                        position: pos,
                        isBot: false
                    });
                    return true;
                }
            }
            
            // No bot to replace, check for empty slot (shouldn't happen normally)
            const takenPositions = Array.from(this.players.values()).map(p => p.position);
            const availablePosition = ['bottom', 'left', 'top', 'right'].find(p => !takenPositions.includes(p));
            
            if (availablePosition) {
                this.players.set(playerId, {
                    username: username,
                    ready: false,
                    position: availablePosition,
                    isBot: false
                });
                return true;
            }
            return false;
        }
        
        // Adding a bot (used during room creation)
        const positions = ['bottom', 'left', 'top', 'right'];
        const takenPositions = Array.from(this.players.values()).map(p => p.position);
        const availablePosition = positions.find(p => !takenPositions.includes(p));
        
        if (availablePosition) {
            this.players.set(playerId, {
                username: username,
                ready: true,
                position: availablePosition,
                isBot: true
            });
            return true;
        }
        return false;
    }

    removePlayer(playerId) {
        const player = this.players.get(playerId);
        if (!player || player.isBot) return; // Don't remove bots
        
        const position = player.position;
        this.players.delete(playerId);
        
        // If host left, assign new host (prefer human)
        if (playerId === this.hostId) {
            const humans = Array.from(this.players.entries()).filter(([id, p]) => !p.isBot);
            if (humans.length > 0) {
                this.hostId = humans[0][0];
            }
        }
        
        // Add a bot to replace the leaving human (unless it was bottom/host position)
        if (position !== 'bottom' || this.players.size > 0) {
            const botId = `bot-${position}`;
            const botIndex = ['left', 'top', 'right'].indexOf(position);
            const botName = BOT_NAMES[botIndex >= 0 ? botIndex : 0];
            this.players.set(botId, {
                username: botName,
                ready: true,
                position: position,
                isBot: true
            });
        }
    }
    
    getHumanCount() {
        return Array.from(this.players.values()).filter(p => !p.isBot).length;
    }
    
    getBotCount() {
        return Array.from(this.players.values()).filter(p => p.isBot).length;
    }

    toggleReady(playerId) {
        const player = this.players.get(playerId);
        if (player) {
            player.ready = !player.ready;
        }
    }

    canStart() {
        if (this.players.size !== this.maxPlayers) return false;
        if (this.gameInProgress) return false;
        
        // All human players must be ready (bots are always ready)
        for (const player of this.players.values()) {
            if (!player.isBot && !player.ready) return false;
        }
        
        return true;
    }

    isFull() {
        // Room is "full" only when all 4 slots are humans (no bots to replace)
        return this.getHumanCount() >= this.maxPlayers;
    }
    
    isFullWithBots() {
        return this.players.size >= this.maxPlayers;
    }

    isEmpty() {
        return this.getHumanCount() === 0;
    }

    getState() {
        const players = [];
        for (const [id, data] of this.players) {
            players.push({
                id,
                username: data.username,
                ready: data.ready,
                position: data.position,
                isHost: id === this.hostId,
                isBot: data.isBot || false
            });
        }
        
        // Include vacant positions info
        const vacantPositionsList = Array.from(this.vacantPositions);
        
        return {
            id: this.id,
            hostId: this.hostId,
            players,
            playerCount: this.players.size,
            humanCount: this.getHumanCount(),
            maxPlayers: this.maxPlayers,
            gameInProgress: this.gameInProgress,
            canStart: this.canStart(),
            vacantPositions: vacantPositionsList,
            isPaused: vacantPositionsList.length > 0 && this.gameInProgress
        };
    }

    getPlayerByPosition(position) {
        for (const [id, data] of this.players) {
            if (data.position === position) {
                return { id, ...data };
            }
        }
        return null;
    }

    getPlayerPosition(playerId) {
        const player = this.players.get(playerId);
        return player ? player.position : null;
    }

    /**
     * Remove a player and keep their slot vacant (for mid-game leaves).
     * Returns the vacated position, or null.
     */
    removePlayerKeepSlot(playerId) {
        const player = this.players.get(playerId);
        if (!player || player.isBot) return null;
        
        const position = player.position;
        this.players.delete(playerId);
        this.vacantPositions.add(position);
        
        // Update host if needed
        if (playerId === this.hostId) {
            const humans = Array.from(this.players.entries()).filter(([id, p]) => !p.isBot);
            if (humans.length > 0) {
                this.hostId = humans[0][0];
            }
        }
        
        return position;
    }

    /**
     * Fill a vacant position with a new player (mid-game join).
     * Returns the position filled, or null if no vacancy.
     */
    fillVacantPosition(playerId, username) {
        if (this.vacantPositions.size === 0) return null;
        
        const position = this.vacantPositions.values().next().value;
        this.vacantPositions.delete(position);
        
        this.players.set(playerId, {
            username: username,
            ready: true,
            position: position,
            isBot: false
        });
        
        return position;
    }

    /**
     * Check if the room has vacant positions (mid-game).
     */
    hasVacantPositions() {
        return this.vacantPositions.size > 0;
    }
}

class RoomManager {
    constructor() {
        this.rooms = new Map(); // roomId -> Room
        this.SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes inactivity timeout
        
        // Cleanup inactive rooms every 5 minutes
        setInterval(() => this.cleanupInactiveRooms(), 5 * 60 * 1000);
    }

    cleanupInactiveRooms() {
        const now = Date.now();
        for (const [roomId, room] of this.rooms) {
            // Only delete if no humans AND inactive for 30 minutes
            if (room.isEmpty() && (now - room.lastActivity) > this.SESSION_TIMEOUT) {
                console.log(`Cleaning up inactive room: ${roomId}`);
                this.rooms.delete(roomId);
            }
        }
    }

    generateRoomCode() {
        // Generate a 6-character alphanumeric code
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    createRoom(hostId, hostUsername) {
        let roomId;
        do {
            roomId = this.generateRoomCode();
        } while (this.rooms.has(roomId));
        
        const room = new Room(roomId, hostId, hostUsername);
        this.rooms.set(roomId, room);
        
        return room;
    }

    getRoom(roomId) {
        return this.rooms.get(roomId.toUpperCase());
    }

    joinRoom(roomId, playerId, username) {
        const room = this.getRoom(roomId);
        
        if (!room) {
            return { success: false, message: 'Room not found' };
        }
        
        // Allow joining mid-game if there are vacant positions
        if (room.gameInProgress) {
            if (room.hasVacantPositions()) {
                const position = room.fillVacantPosition(playerId, username);
                if (position) {
                    return { success: true, room, midGame: true, position };
                }
            }
            return { success: false, message: 'Game already in progress' };
        }
        
        if (room.isFull()) {
            return { success: false, message: 'Room is full' };
        }
        
        room.addPlayer(playerId, username);
        return { success: true, room };
    }

    leaveRoom(roomId, playerId) {
        const room = this.getRoom(roomId);
        if (room) {
            room.removePlayer(playerId);
        }
    }

    deleteRoom(roomId) {
        this.rooms.delete(roomId);
    }

    getAvailableRooms() {
        const available = [];
        for (const [id, room] of this.rooms) {
            if (!room.isFull() && !room.gameInProgress) {
                available.push({
                    id: room.id,
                    hostUsername: room.players.get(room.hostId)?.username || 'Unknown',
                    playerCount: room.getHumanCount(),
                    maxPlayers: room.maxPlayers,
                    hasBots: room.getBotCount() > 0
                });
            }
        }
        return available;
    }
}

module.exports = RoomManager;
