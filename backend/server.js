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

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Authenticate / register user with persistent userId
    socket.on('authenticate', (data) => {
        const { userId, username } = data || {};
        const result = sessionManager.registerUser(socket.id, userId, username);
        
        socket.userId = result.userId;
        socket.username = result.username || username || null;
        
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
            
            if (result.midGame) {
                // Joining mid-game — takeover a vacant position
                gameManager.handlePlayerTakeover(roomId, socket.id, socket.username, result.position);
                
                const personalState = gameManager.getReconnectState(roomId, socket.id);
                socket.emit('reconnected', {
                    roomId: roomId,
                    position: 'bottom',
                    state: personalState,
                    message: 'Joined the game!'
                });
                
                console.log(`${socket.username} joined mid-game in room: ${roomId} at position ${result.position}`);
            } else {
                // Normal pre-game join
                socket.emit('roomJoined', { roomId, room: result.room.getState() });
                
                io.to(roomId).emit('playerJoined', { 
                    playerId: socket.id, 
                    username: socket.username,
                    room: result.room.getState()
                });
                
                console.log(`${socket.username} joined room: ${roomId}`);
            }
        } else {
            socket.emit('joinError', { message: result.message });
        }
    });

    // Leave room (intentional — clear session, no auto-reconnect)
    socket.on('leaveRoom', () => {
        handleLeaveRoom(socket, true);
    });

    // Player ready toggle
    socket.on('toggleReady', () => {
        if (!socket.roomId) return;
        
        const room = roomManager.getRoom(socket.roomId);
        if (room) {
            room.toggleReady(socket.id);
            io.to(socket.roomId).emit('roomUpdated', { room: room.getState() });
            
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

    // Disconnect handling — pause game, keep session for auto-reconnect
    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
        
        const sessionInfo = sessionManager.handleDisconnect(socket.id);
        if (!sessionInfo) return;
        
        const { userId, roomId, username } = sessionInfo;
        
        if (!roomId || !socket.roomId) return;
        
        const room = roomManager.getRoom(roomId);
        if (!room) return;
        
        room.updateActivity();
        
        if (room.gameInProgress) {
            // Game is active — remove player, keep slot vacant, pause game
            console.log(`Player ${username} disconnected during game in room ${roomId}. Pausing game...`);
            
            room.removePlayerKeepSlot(socket.id);
            gameManager.handlePlayerDisconnect(roomId, socket.id);
            
            // Keep session roomId so they can auto-reconnect
            // (sessionManager.handleDisconnect already preserved the session)
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
        if (!socket.roomId) return;
        
        const roomId = socket.roomId;
        const room = roomManager.getRoom(roomId);
        
        if (room) {
            room.updateActivity();
            
            if (room.gameInProgress) {
                // Leaving during a game — keep slot vacant, pause game
                room.removePlayerKeepSlot(socket.id);
                gameManager.handlePlayerDisconnect(roomId, socket.id);
            } else {
                // Normal pre-game leave
                roomManager.leaveRoom(roomId, socket.id);
                
                io.to(roomId).emit('playerLeft', { 
                    playerId: socket.id,
                    username: socket.username,
                    room: room.getState()
                });
            }
            
            socket.leave(roomId);
        }
        
        // Clear session for intentional leaves (prevents auto-reconnect)
        if (socket.userId && intentional) {
            sessionManager.clearUserRoom(socket.userId);
        }
        
        socket.roomId = null;
    }

    // Handle reconnection to an active game (via auto-reconnect on page reload)
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
        
        if (!room.hasVacantPositions()) {
            console.log(`Reconnect failed: no vacant positions in room ${roomId}`);
            sessionManager.clearUserRoom(userId);
            socket.emit('reconnectFailed', { message: 'No available spots in the game.' });
            return;
        }
        
        // Fill the vacant position
        const position = room.fillVacantPosition(socket.id, socket.username);
        if (!position) {
            sessionManager.clearUserRoom(userId);
            socket.emit('reconnectFailed', { message: 'Could not rejoin the game.' });
            return;
        }
        
        // Join the socket room
        socket.join(roomId);
        socket.roomId = roomId;
        sessionManager.setUserRoom(userId, roomId);
        
        // Update game state with the new player
        gameManager.handlePlayerTakeover(roomId, socket.id, socket.username, position);
        
        console.log(`Player ${socket.username} (${userId}) reconnected to room ${roomId} at position ${position}`);
        
        // Send full game state to reconnected player
        const personalState = gameManager.getReconnectState(roomId, socket.id);
        if (personalState) {
            socket.emit('reconnected', {
                roomId: roomId,
                position: 'bottom',
                state: personalState,
                message: 'Reconnected to your game!'
            });
        }
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Leekha server running on port ${PORT}`);
});
