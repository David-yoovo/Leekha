const { v4: uuidv4 } = require('uuid');

class Room {
    constructor(id, hostId, hostUsername) {
        this.id = id;
        this.hostId = hostId;
        this.players = new Map(); // playerId -> { username, ready, position }
        this.maxPlayers = 4;
        this.gameInProgress = false;
        this.createdAt = Date.now();
        
        // Add host as first player
        this.addPlayer(hostId, hostUsername);
    }

    addPlayer(playerId, username) {
        if (this.players.size >= this.maxPlayers) {
            return false;
        }
        
        // Assign position: bottom, left, top, right
        const positions = ['bottom', 'left', 'top', 'right'];
        const takenPositions = Array.from(this.players.values()).map(p => p.position);
        const availablePosition = positions.find(p => !takenPositions.includes(p));
        
        this.players.set(playerId, {
            username: username,
            ready: false,
            position: availablePosition
        });
        
        return true;
    }

    removePlayer(playerId) {
        this.players.delete(playerId);
        
        // If host left, assign new host
        if (playerId === this.hostId && this.players.size > 0) {
            this.hostId = this.players.keys().next().value;
        }
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
        
        // All players must be ready
        for (const player of this.players.values()) {
            if (!player.ready) return false;
        }
        
        return true;
    }

    isFull() {
        return this.players.size >= this.maxPlayers;
    }

    isEmpty() {
        return this.players.size === 0;
    }

    getState() {
        const players = [];
        for (const [id, data] of this.players) {
            players.push({
                id,
                username: data.username,
                ready: data.ready,
                position: data.position,
                isHost: id === this.hostId
            });
        }
        
        return {
            id: this.id,
            hostId: this.hostId,
            players,
            playerCount: this.players.size,
            maxPlayers: this.maxPlayers,
            gameInProgress: this.gameInProgress,
            canStart: this.canStart()
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
}

class RoomManager {
    constructor() {
        this.rooms = new Map(); // roomId -> Room
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
        
        if (room.isFull()) {
            return { success: false, message: 'Room is full' };
        }
        
        if (room.gameInProgress) {
            return { success: false, message: 'Game already in progress' };
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
                    playerCount: room.players.size,
                    maxPlayers: room.maxPlayers
                });
            }
        }
        return available;
    }
}

module.exports = RoomManager;
