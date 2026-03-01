const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const RoomManager = require('./roomManager');
const GameManager = require('./gameManager');
const SessionManager = require('./sessionManager');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Serve static files from parent directory
app.use(express.static(path.join(__dirname, '..')));

// Managers
const roomManager = new RoomManager();
const gameManager = new GameManager(io, roomManager);
const sessionManager = new SessionManager();

// Disconnect timers: userId -> timeout handle
const disconnectTimers = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Authenticate / register user with persistent userId
    socket.on('authenticate', (data) => {
        const { userId, username } = data || {};
        const result = sessionManager.registerUser(socket.id, userId, username);
        
        socket.userId = result.userId;
        socket.username = result.username || username || null;
        
        // Cancel any pending disconnect timer for this user
        if (disconnectTimers.has(result.userId)) {
            clearTimeout(disconnectTimers.get(result.userId));
            disconnectTimers.delete(result.userId);
            console.log(`Cancelled disconnect timer for ${result.userId}`);
        }
        
        // Send back the persistent userId
        socket.emit('authenticated', {
            userId: result.userId,
            isReconnect: result.isReconnect,
            previousRoomId: result.previousRoomId,
            username: result.username
        });
        
        // If reconnecting to an active game, handle it
        if (result.isReconnect && result.previousRoomId) {
            handleReconnect(socket, result.userId, result.previousRoomId);
        }
    });

    // Player joins with a username
    socket.on('setUsername', (username) => {
        socket.username = username || `Player_${socket.id.slice(0, 4)}`;
        if (socket.userId) {
            sessionManager.setUsername(socket.userId, socket.username);
        }
        socket.emit('usernameSet', { username: socket.username });
        console.log(`Player ${socket.id} set username: ${socket.username}`);
    });

    // Create a new room
    socket.on('createRoom', () => {
        const room = roomManager.createRoom(socket.id, socket.username);
        socket.join(room.id);
        socket.roomId = room.id;
        if (socket.userId) {
            sessionManager.setUserRoom(socket.userId, room.id);
        }
        socket.emit('roomCreated', { roomId: room.id, room: room.getState() });
        console.log(`Room created: ${room.id} by ${socket.username}`);
    });

    // Join an existing room
    socket.on('joinRoom', (roomId) => {
        const result = roomManager.joinRoom(roomId, socket.id, socket.username);
        
        if (result.success) {
            socket.join(roomId);
            socket.roomId = roomId;
            if (socket.userId) {
                sessionManager.setUserRoom(socket.userId, roomId);
            }
            socket.emit('roomJoined', { roomId, room: result.room.getState() });
            
            // Notify all players in room
            io.to(roomId).emit('playerJoined', { 
                playerId: socket.id, 
                username: socket.username,
                room: result.room.getState()
            });
            
            console.log(`${socket.username} joined room: ${roomId}`);
        } else {
            socket.emit('joinError', { message: result.message });
        }
    });

    // Leave room (intentional - no reconnection)
    socket.on('leaveRoom', () => {
        handleLeaveRoom(socket, true); // true = intentional leave
    });

    // Player ready toggle
    socket.on('toggleReady', () => {
        if (!socket.roomId) return;
        
        const room = roomManager.getRoom(socket.roomId);
        if (room) {
            room.toggleReady(socket.id);
            io.to(socket.roomId).emit('roomUpdated', { room: room.getState() });
            
            // Check if all players ready and room is full
            if (room.canStart()) {
                gameManager.startGame(socket.roomId);
            }
        }
    });

    // Game actions
    socket.on('selectCardsToPass', (cardIds) => {
        const room = roomManager.getRoom(socket.roomId);
        if (room) room.updateActivity();
        gameManager.handlePassCards(socket.roomId, socket.id, cardIds);
    });

    socket.on('cardsCollected', () => {
        const room = roomManager.getRoom(socket.roomId);
        if (room) room.updateActivity();
        gameManager.handleCardsCollected(socket.roomId, socket.id);
    });

    socket.on('playCard', (cardId) => {
        const room = roomManager.getRoom(socket.roomId);
        if (room) room.updateActivity();
        gameManager.handlePlayCard(socket.roomId, socket.id, cardId);
    });

    socket.on('nextRound', () => {
        if (socket.roomId) {
            const room = roomManager.getRoom(socket.roomId);
            if (room) room.updateActivity();
            gameManager.startNextRound(socket.roomId, socket.id);
        }
    });

    socket.on('nextGame', () => {
        if (socket.roomId) {
            const room = roomManager.getRoom(socket.roomId);
            if (room) room.updateActivity();
            gameManager.startNextGame(socket.roomId, socket.id);
        }
    });

    // Get room list
    socket.on('getRooms', () => {
        const rooms = roomManager.getAvailableRooms();
        socket.emit('roomList', { rooms });
    });

    // Disconnect handling - start grace period instead of immediate removal
    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
        
        const sessionInfo = sessionManager.handleDisconnect(socket.id);
        if (!sessionInfo) {
            // No session found, nothing to do
            return;
        }
        
        const { userId, roomId, username } = sessionInfo;
        
        if (!roomId || !socket.roomId) {
            // Not in a room, nothing to preserve
            return;
        }
        
        const room = roomManager.getRoom(roomId);
        if (!room) return;
        
        room.updateActivity();
        
        if (room.gameInProgress) {
            // Game is active — start grace period for reconnection
            console.log(`Player ${username} (${userId}) disconnected during game in room ${roomId}. Starting ${sessionManager.RECONNECT_GRACE_PERIOD / 1000}s grace period...`);
            
            // Mark player as disconnected in room (but don't remove)
            room.markPlayerDisconnected(socket.id, userId);
            
            // Notify remaining players about pending reconnection
            io.to(roomId).emit('playerDisconnectedTemporary', {
                playerId: socket.id,
                username: username,
                message: `${username} disconnected. Waiting for reconnection...`,
                gracePeriod: sessionManager.RECONNECT_GRACE_PERIOD
            });
            
            // Start grace period timer
            const timer = setTimeout(() => {
                disconnectTimers.delete(userId);
                console.log(`Grace period expired for ${username} (${userId}) in room ${roomId}`);
                
                // Player didn't reconnect in time — replace with bot
                const currentRoom = roomManager.getRoom(roomId);
                if (currentRoom && currentRoom.gameInProgress) {
                    // Find the player's current socketId in room (it was stored before disconnect)
                    const disconnectedPlayerId = currentRoom.getDisconnectedPlayerId(userId);
                    if (disconnectedPlayerId) {
                        currentRoom.finalizePlayerRemoval(disconnectedPlayerId);
                        gameManager.handlePlayerDisconnect(roomId, disconnectedPlayerId);
                        
                        io.to(roomId).emit('playerReconnectExpired', {
                            username: username,
                            message: `${username} didn't reconnect in time. Replaced by bot.`,
                            room: currentRoom.getState()
                        });
                    }
                }
                
                sessionManager.clearUserRoom(userId);
            }, sessionManager.RECONNECT_GRACE_PERIOD);
            
            disconnectTimers.set(userId, timer);
        } else {
            // Not in a game — leave normally
            roomManager.leaveRoom(roomId, socket.id);
            
            io.to(roomId).emit('playerLeft', {
                playerId: socket.id,
                username: username,
                room: room.getState()
            });
            
            sessionManager.clearUserRoom(userId);
        }
    });

    // Handle intentional room leave
    function handleLeaveRoom(socket, intentional = false) {
        if (socket.roomId) {
            const room = roomManager.getRoom(socket.roomId);
            if (room) {
                room.updateActivity();
                
                // Clear any disconnected state for this player
                room.clearDisconnectedState(socket.id);
                
                roomManager.leaveRoom(socket.roomId, socket.id);
                socket.leave(socket.roomId);
                
                // Notify remaining players
                io.to(socket.roomId).emit('playerLeft', { 
                    playerId: socket.id,
                    username: socket.username,
                    room: room.getState()
                });
                
                // Handle mid-game disconnect - replace with bot immediately for intentional leave
                if (room.gameInProgress) {
                    gameManager.handlePlayerDisconnect(socket.roomId, socket.id);
                }
            }
            
            // Clear session room assignment
            if (socket.userId) {
                // Cancel any pending disconnect timer
                if (disconnectTimers.has(socket.userId)) {
                    clearTimeout(disconnectTimers.get(socket.userId));
                    disconnectTimers.delete(socket.userId);
                }
                sessionManager.clearUserRoom(socket.userId);
            }
            
            socket.roomId = null;
        }
    }

    // Handle reconnection to an active game
    function handleReconnect(socket, userId, roomId) {
        const room = roomManager.getRoom(roomId);
        if (!room) {
            console.log(`Reconnect failed: room ${roomId} no longer exists`);
            sessionManager.clearUserRoom(userId);
            socket.emit('reconnectFailed', { message: 'Room no longer exists.' });
            return;
        }
        
        if (!room.gameInProgress) {
            console.log(`Reconnect: game not in progress in room ${roomId}`);
            sessionManager.clearUserRoom(userId);
            socket.emit('reconnectFailed', { message: 'Game is no longer in progress.' });
            return;
        }
        
        // Find the disconnected player's position
        const reconnectInfo = room.reconnectPlayer(userId, socket.id, socket.username);
        if (!reconnectInfo) {
            console.log(`Reconnect failed: could not find player slot in room ${roomId}`);
            sessionManager.clearUserRoom(userId);
            socket.emit('reconnectFailed', { message: 'Your spot has been taken.' });
            return;
        }
        
        const { oldPlayerId, position } = reconnectInfo;
        
        // Join the socket room
        socket.join(roomId);
        socket.roomId = roomId;
        socket.username = reconnectInfo.username || socket.username;
        
        // Update game state: swap old player ID for new socket ID
        gameManager.handlePlayerReconnect(roomId, oldPlayerId, socket.id, socket.username);
        
        console.log(`Player ${socket.username} (${userId}) reconnected to room ${roomId} at position ${position}`);
        
        // Send full game state to reconnected player
        const personalState = gameManager.getReconnectState(roomId, socket.id);
        if (personalState) {
            socket.emit('reconnected', {
                roomId: roomId,
                position: position,
                state: personalState,
                message: 'Reconnected to your game!'
            });
        }
        
        // Notify other players about reconnection
        io.to(roomId).emit('playerReconnected', {
            playerId: socket.id,
            username: socket.username,
            position: position,
            message: `${socket.username} has reconnected!`,
            room: room.getState()
        });
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Leekha server running on port ${PORT}`);
});
