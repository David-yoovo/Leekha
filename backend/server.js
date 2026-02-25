const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const RoomManager = require('./roomManager');
const GameManager = require('./gameManager');

const app = express();
const server = http.createServer(app);

// CORS origins - add your Cloudflare Pages URL here
const ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://leekha.pages.dev", // Replace with your actual Pages domain
    /\.pages\.dev$/  // Allow all *.pages.dev subdomains
];

const io = new Server(server, {
    cors: {
        origin: ALLOWED_ORIGINS,
        methods: ["GET", "POST"],
        credentials: true
    }
});

const PORT = process.env.PORT || 3000;

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Serve static files from parent directory (for local development)
app.use(express.static(path.join(__dirname, '..')));

// Managers
const roomManager = new RoomManager();
const gameManager = new GameManager(io, roomManager);

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // Player joins with a username
    socket.on('setUsername', (username) => {
        socket.username = username || `Player_${socket.id.slice(0, 4)}`;
        socket.emit('usernameSet', { username: socket.username });
        console.log(`Player ${socket.id} set username: ${socket.username}`);
    });

    // Create a new room
    socket.on('createRoom', () => {
        const room = roomManager.createRoom(socket.id, socket.username);
        socket.join(room.id);
        socket.roomId = room.id;
        socket.emit('roomCreated', { roomId: room.id, room: room.getState() });
        console.log(`Room created: ${room.id} by ${socket.username}`);
    });

    // Join an existing room
    socket.on('joinRoom', (roomId) => {
        const result = roomManager.joinRoom(roomId, socket.id, socket.username);
        
        if (result.success) {
            socket.join(roomId);
            socket.roomId = roomId;
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

    // Leave room
    socket.on('leaveRoom', () => {
        handleLeaveRoom(socket);
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
        gameManager.handlePassCards(socket.roomId, socket.id, cardIds);
    });

    socket.on('cardsCollected', () => {
        gameManager.handleCardsCollected(socket.roomId, socket.id);
    });

    socket.on('playCard', (cardId) => {
        gameManager.handlePlayCard(socket.roomId, socket.id, cardId);
    });

    socket.on('nextRound', () => {
        if (socket.roomId) {
            gameManager.startNextRound(socket.roomId, socket.id);
        }
    });

    socket.on('nextGame', () => {
        if (socket.roomId) {
            gameManager.startNextGame(socket.roomId, socket.id);
        }
    });

    // Get room list
    socket.on('getRooms', () => {
        const rooms = roomManager.getAvailableRooms();
        socket.emit('roomList', { rooms });
    });

    // Disconnect handling
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        handleLeaveRoom(socket);
    });

    // Helper function to handle leaving room
    function handleLeaveRoom(socket) {
        if (socket.roomId) {
            const room = roomManager.getRoom(socket.roomId);
            if (room) {
                roomManager.leaveRoom(socket.roomId, socket.id);
                socket.leave(socket.roomId);
                
                // Notify remaining players
                io.to(socket.roomId).emit('playerLeft', { 
                    playerId: socket.id,
                    username: socket.username,
                    room: room.getState()
                });
                
                // If room is empty or game was in progress, clean up
                if (room.isEmpty()) {
                    roomManager.deleteRoom(socket.roomId);
                } else if (room.gameInProgress) {
                    // Handle mid-game disconnect
                    gameManager.handlePlayerDisconnect(socket.roomId, socket.id);
                }
            }
            socket.roomId = null;
        }
    }
});

server.listen(PORT, () => {
    console.log(`Leekha server running on http://localhost:${PORT}`);
});
