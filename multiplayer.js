// Multiplayer Client
let socket = null;
let isMultiplayer = false;
let myUsername = '';
let myRoomId = '';
let isReady = false;
let multiplayerNames = {}; // Store player names by position

// DOM Elements
const startModal = document.getElementById('start-modal');
const lobbyModal = document.getElementById('lobby-modal');
const nameSection = document.getElementById('name-section');
const roomSection = document.getElementById('room-section');
const waitingSection = document.getElementById('waiting-section');

// Initialize Socket.IO connection
function connectToServer() {
    if (socket) return;
    
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connected to server');
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        showConnectionError();
    });

    socket.on('usernameSet', (data) => {
        myUsername = data.username;
        document.getElementById('display-name').textContent = myUsername;
        showSection('room');
    });

    socket.on('roomCreated', (data) => {
        myRoomId = data.roomId;
        document.getElementById('current-room-code').textContent = myRoomId;
        updatePlayersUI(data.room);
        showSection('waiting');
    });

    socket.on('roomJoined', (data) => {
        myRoomId = data.roomId;
        document.getElementById('current-room-code').textContent = myRoomId;
        updatePlayersUI(data.room);
        showSection('waiting');
        hideError();
    });

    socket.on('joinError', (data) => {
        showError(data.message);
    });

    socket.on('playerJoined', (data) => {
        updatePlayersUI(data.room);
    });

    socket.on('playerLeft', (data) => {
        updatePlayersUI(data.room);
    });

    socket.on('roomUpdated', (data) => {
        updatePlayersUI(data.room);
    });

    // Game events
    socket.on('roundStarted', (data) => {
        if (data.targetPlayer === socket.id) {
            handleMultiplayerGameStart(data.state);
        }
    });

    socket.on('cardsExchanged', (data) => {
        if (data.targetPlayer === socket.id) {
            handleCardsExchanged(data.state);
        }
    });

    socket.on('cardPlayed', (data) => {
        // Only process if this is for me
        if (data.targetPlayer === socket.id) {
            handleCardPlayed(data);
        }
    });

    socket.on('turnChanged', (data) => {
        if (data.targetPlayer === socket.id) {
            handleTurnChanged(data.state);
        }
    });

    socket.on('trickComplete', (data) => {
        // Only process if this is for me
        if (data.targetPlayer === socket.id) {
            handleTrickComplete(data);
        }
    });

    socket.on('newTrick', (data) => {
        if (data.targetPlayer === socket.id) {
            handleNewTrick(data.state);
        }
    });

    socket.on('roundOver', (data) => {
        if (data.targetPlayer === socket.id) {
            handleRoundOver(data);
        }
    });

    socket.on('gameOver', (data) => {
        if (data.targetPlayer === socket.id) {
            handleGameOver(data);
        }
    });

    socket.on('playerDisconnected', (data) => {
        alert(data.message);
        backToMenu();
    });

    socket.on('error', (data) => {
        if (data.targetPlayer === socket.id) {
            console.error('Game error:', data.message);
        }
    });
}

// UI Navigation
function showSection(section) {
    nameSection.classList.add('hidden');
    roomSection.classList.add('hidden');
    waitingSection.classList.add('hidden');
    
    switch(section) {
        case 'name':
            nameSection.classList.remove('hidden');
            document.getElementById('btn-back-to-menu').style.display = 'block';
            break;
        case 'room':
            roomSection.classList.remove('hidden');
            document.getElementById('btn-back-to-menu').style.display = 'block';
            break;
        case 'waiting':
            waitingSection.classList.remove('hidden');
            document.getElementById('btn-back-to-menu').style.display = 'none';
            break;
    }
}

function showLobby() {
    startModal.classList.remove('active');
    lobbyModal.classList.add('active');
    showSection('name');
    connectToServer();
}

function hideLobby() {
    lobbyModal.classList.remove('active');
}

function backToMenu() {
    if (myRoomId) {
        socket.emit('leaveRoom');
        myRoomId = '';
    }
    isReady = false;
    updateReadyButton();
    hideLobby();
    startModal.classList.add('active');
}

// Player list UI
function updatePlayersUI(room) {
    const playersList = document.getElementById('players-list');
    const waitingStatus = document.getElementById('waiting-status');
    const positions = ['bottom', 'left', 'top', 'right'];
    const positionLabels = { bottom: 'South', left: 'West', top: 'North', right: 'East' };
    
    playersList.innerHTML = '';
    
    for (const pos of positions) {
        const player = room.players.find(p => p.position === pos);
        const slot = document.createElement('div');
        slot.className = `player-slot ${player ? 'filled' : 'empty'}`;
        
        if (player) {
            const isMe = player.id === socket.id;
            slot.innerHTML = `
                <div class="player-info">
                    <span class="position-badge">${positionLabels[pos]}</span>
                    <span>${player.username}${isMe ? ' (you)' : ''}</span>
                    ${player.isHost ? '<span class="host-badge">HOST</span>' : ''}
                </div>
                <span class="ready-status">${player.ready ? '✅' : '⏳'}</span>
            `;
        } else {
            slot.innerHTML = `
                <div class="player-info">
                    <span class="position-badge">${positionLabels[pos]}</span>
                    <span>Waiting for player...</span>
                </div>
                <span class="ready-status">❌</span>
            `;
        }
        
        playersList.appendChild(slot);
    }
    
    const playerCount = room.playerCount;
    const readyCount = room.players.filter(p => p.ready).length;
    
    if (playerCount < 4) {
        waitingStatus.textContent = `Waiting for players... (${playerCount}/4)`;
    } else if (readyCount < 4) {
        waitingStatus.textContent = `Waiting for everyone to be ready... (${readyCount}/4)`;
    } else {
        waitingStatus.textContent = 'Starting game...';
    }
}

function showError(message) {
    const errorDiv = document.getElementById('room-error');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
}

function hideError() {
    document.getElementById('room-error').classList.add('hidden');
}

function showConnectionError() {
    alert('Connection lost. Returning to menu.');
    backToMenu();
}

function updateReadyButton() {
    const btn = document.getElementById('btn-ready');
    btn.textContent = isReady ? 'Not Ready' : 'Ready';
    btn.classList.toggle('is-ready', isReady);
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Mode selection
    document.getElementById('btn-solo').addEventListener('click', () => {
        isMultiplayer = false;
        startModal.classList.remove('active');
        startGame(); // From game.js
    });

    document.getElementById('btn-multiplayer').addEventListener('click', () => {
        isMultiplayer = true;
        showLobby();
    });

    // Name input
    document.getElementById('btn-set-name').addEventListener('click', () => {
        const name = document.getElementById('player-name').value.trim();
        if (name) {
            socket.emit('setUsername', name);
        }
    });

    document.getElementById('player-name').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('btn-set-name').click();
        }
    });

    // Room creation/joining
    document.getElementById('btn-create-room').addEventListener('click', () => {
        hideError();
        socket.emit('createRoom');
    });

    document.getElementById('btn-join-room').addEventListener('click', () => {
        const code = document.getElementById('room-code-input').value.trim().toUpperCase();
        if (code.length === 6) {
            hideError();
            socket.emit('joinRoom', code);
        } else {
            showError('Please enter a valid 6-character room code');
        }
    });

    document.getElementById('room-code-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('btn-join-room').click();
        }
    });

    // Waiting room
    document.getElementById('btn-ready').addEventListener('click', () => {
        isReady = !isReady;
        updateReadyButton();
        socket.emit('toggleReady');
    });

    document.getElementById('btn-leave-room').addEventListener('click', () => {
        socket.emit('leaveRoom');
        myRoomId = '';
        isReady = false;
        updateReadyButton();
        showSection('room');
    });

    document.getElementById('btn-copy-code').addEventListener('click', () => {
        const code = document.getElementById('current-room-code').textContent;
        navigator.clipboard.writeText(code).then(() => {
            const btn = document.getElementById('btn-copy-code');
            btn.textContent = '✓';
            setTimeout(() => btn.textContent = '📋', 2000);
        });
    });

    document.getElementById('btn-back-to-menu').addEventListener('click', backToMenu);
});

// Multiplayer game handlers
async function handleMultiplayerGameStart(state) {
    hideLobby();
    
    // Store player names
    multiplayerNames = state.playerNames || {};
    
    // Update player labels in the UI
    updatePlayerLabels();
    
    // Reset game state
    gameState.hands = { bottom: [], left: [], top: [], right: [] };
    gameState.scores = state.scores || { bottom: 0, left: 0, top: 0, right: 0 };
    gameState.roundScores = state.roundScores || { bottom: 0, left: 0, top: 0, right: 0 };
    gameState.passDirection = state.passDirection;
    
    // Clear UI
    renderAllHands();
    clearTable();
    updateScores();
    
    // Show dealing animation
    gameState.gamePhase = 'dealing';
    updateStatus(`Round ${state.roundNumber}: Dealing cards...`);
    
    // Animate dealing cards
    await dealCardsMultiplayer(state.myHand, state.otherPlayers);
    
    // Now show pass modal
    gameState.gamePhase = 'passing';
    gameState.hands.bottom = state.myHand;
    sortHand('bottom');
    renderAllHands();
    updateStatus(`Round ${state.roundNumber}: Select 3 cards to pass ${state.passDirection}`);
    showPassModal();
}

// Deal cards with animation for multiplayer
async function dealCardsMultiplayer(myHand, otherPlayers) {
    const deckPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const dealOrder = ['bottom', 'left', 'top', 'right'];
    
    // Build card counts for each position
    const cardCounts = { bottom: myHand.length };
    for (const op of otherPlayers) {
        cardCounts[op.position] = op.cardCount;
    }
    
    // Start deal sound
    if (typeof soundEnabled !== 'undefined' && soundEnabled && typeof cardDealSound !== 'undefined') {
        cardDealSound.currentTime = 0;
        cardDealSound.play().catch(() => {});
    }
    
    // Simulate dealing 13 cards to each player
    for (let cardNum = 0; cardNum < 13; cardNum++) {
        for (let i = 0; i < 4; i++) {
            const player = dealOrder[i];
            
            // For bottom player, use actual cards; for others, use dummy cards
            if (player === 'bottom' && cardNum < myHand.length) {
                gameState.hands.bottom.push(myHand[cardNum]);
            } else if (player !== 'bottom') {
                // Add a placeholder for other players' cards (they show backs)
                if (!gameState.hands[player]) gameState.hands[player] = [];
                if (gameState.hands[player].length < cardCounts[player]) {
                    gameState.hands[player].push({ suit: 'back', rank: 'X' });
                }
            }
            
            // Animate card dealing
            const targetPos = getPlayerPosition(player);
            const showFace = player === 'bottom';
            const dummyCard = { suit: 'hearts', rank: 'A' }; // Doesn't matter, shown as back
            
            animateCardSlide(dummyCard, deckPos, targetPos, showFace, 250);
            renderPlayerHand(player);
            
            await new Promise(r => setTimeout(r, 60));
        }
    }
    
    // Stop deal sound
    if (typeof cardDealSound !== 'undefined') {
        cardDealSound.pause();
        cardDealSound.currentTime = 0;
    }
    
    await new Promise(r => setTimeout(r, 400));
}

// Update player labels with actual names
function updatePlayerLabels() {
    const labels = {
        bottom: document.querySelector('#player-bottom .player-label'),
        left: document.querySelector('#player-left .player-label'),
        top: document.querySelector('#player-top .player-label'),
        right: document.querySelector('#player-right .player-label')
    };
    
    for (const pos of ['bottom', 'left', 'top', 'right']) {
        if (labels[pos] && multiplayerNames[pos]) {
            labels[pos].textContent = multiplayerNames[pos];
        }
    }
    
    // Also update scoreboard
    const scoreLabels = document.querySelectorAll('.score-item .player-name');
    const positions = ['bottom', 'left', 'top', 'right'];
    scoreLabels.forEach((label, idx) => {
        if (multiplayerNames[positions[idx]]) {
            label.textContent = multiplayerNames[positions[idx]];
        }
    });
}

// Override getPlayerName for multiplayer
const originalGetPlayerName = typeof getPlayerName !== 'undefined' ? getPlayerName : null;
function getMultiplayerPlayerName(player) {
    if (isMultiplayer && multiplayerNames[player]) {
        return multiplayerNames[player];
    }
    if (originalGetPlayerName) {
        return originalGetPlayerName(player);
    }
    const names = { bottom: 'You', left: 'Bot 1', top: 'Bot 2', right: 'Bot 3' };
    return names[player] || player;
}

function handleCardsExchanged(state) {
    // Update player names if included
    if (state.playerNames) {
        multiplayerNames = state.playerNames;
        updatePlayerLabels();
    }
    
    // Update hand with received cards
    gameState.hands.bottom = state.myHand;
    gameState.receivedCards = state.myReceivedCards.map(card => ({
        card: card,
        revealed: true
    }));
    gameState.gamePhase = state.phase;
    gameState.currentPlayer = state.currentPlayer;
    
    hidePassModal();
    renderAllHands();
    renderReceivedCards();
    
    // Collect received cards immediately for multiplayer
    for (const card of state.myReceivedCards) {
        gameState.hands.bottom.push(card);
    }
    gameState.receivedCards = [];
    sortHand('bottom');
    renderPlayerHand('bottom');
    renderReceivedCards();
    
    // Start playing phase with correct player name
    gameState.gamePhase = 'playing';
    gameState.trickNumber = state.trickNumber || 1;
    
    const currentPlayerName = getMultiplayerPlayerName(state.currentPlayer);
    updateStatus(`Trick ${gameState.trickNumber}: ${currentPlayerName}'s turn`);
    renderAllHands();
    updateCurrentPlayerIndicator();
    updateCurrentPlayerInfo();
}

function handleCardPlayed(data) {
    // Render card on table from any player
    renderCardOnTable(data.position, data.card);
    playSound('sound-card-play');
    
    // If it's our card being played (bottom), remove from hand
    if (data.position === 'bottom') {
        const cardId = `${data.card.rank}-${data.card.suit}`;
        gameState.hands.bottom = gameState.hands.bottom.filter(c => 
            `${c.rank}-${c.suit}` !== cardId
        );
        renderPlayerHand('bottom');
    }
}

function handleTurnChanged(state) {
    gameState.currentPlayer = state.currentPlayer;
    gameState.leadSuit = state.leadSuit;
    const playerName = getMultiplayerPlayerName(state.currentPlayer);
    updateStatus(`Trick ${state.trickNumber}: ${playerName}'s turn`);
    updateCurrentPlayerIndicator();
    renderPlayerHand('bottom');
}

function handleTrickComplete(data) {
    playSound('sound-trick-win');
    const winnerName = getMultiplayerPlayerName(data.winner);
    updateStatus(`${winnerName} wins the trick!`);
    
    setTimeout(() => {
        clearTable();
    }, 1500);
}

function handleNewTrick(state) {
    // Update game state for new trick
    gameState.currentPlayer = state.currentPlayer;
    gameState.trickNumber = state.trickNumber;
    gameState.leadSuit = null;
    gameState.currentTrick = [];
    gameState.gamePhase = 'playing';
    
    clearTable();
    
    const playerName = getMultiplayerPlayerName(state.currentPlayer);
    updateStatus(`Trick ${state.trickNumber}: ${playerName}'s turn`);
    updateCurrentPlayerIndicator();
    updateCurrentPlayerInfo();
    renderPlayerHand('bottom');
}

function handleRoundOver(data) {
    playSound('sound-round-end');
    
    // Update scores
    for (const pos of ['bottom', 'left', 'top', 'right']) {
        gameState.scores[pos] = data.totalScores[pos];
        gameState.roundScores[pos] = data.roundScores[pos];
    }
    
    updateScores();
    
    // Show round over modal with player names
    showRoundOverModalMultiplayer();
}

function showRoundOverModalMultiplayer() {
    const modal = document.getElementById('round-over-modal');
    const scoresDiv = document.getElementById('round-scores');
    
    const positions = ['bottom', 'left', 'top', 'right'];
    scoresDiv.innerHTML = positions.map(pos => {
        const name = getMultiplayerPlayerName(pos);
        return `
            <div class="score-row">
                <span>${name}</span>
                <span>+${gameState.roundScores[pos]} (Total: ${gameState.scores[pos]})</span>
            </div>
        `;
    }).join('');
    
    // Setup next round button for multiplayer
    const nextRoundBtn = document.getElementById('btn-next-round');
    if (nextRoundBtn) {
        nextRoundBtn.onclick = () => {
            if (isMultiplayer && socket) {
                socket.emit('nextRound');
                hideRoundOverModal();
            } else {
                nextRound();
            }
        };
    }
    
    modal.classList.add('active');
}

function handleGameOver(data) {
    playSound('sound-game-over');
    
    for (const pos of ['bottom', 'left', 'top', 'right']) {
        gameState.scores[pos] = data.finalScores[pos];
    }
    
    updateScores();
    
    // Use winner username if available
    const winnerName = data.winner.username || getMultiplayerPlayerName(data.winner.position);
    showGameOverModalMultiplayer(winnerName, data.winner.score);
}

function showGameOverModalMultiplayer(winnerName, winnerScore) {
    const modal = document.getElementById('game-over-modal');
    const title = document.getElementById('game-over-title');
    const scoresDiv = document.getElementById('final-scores');
    
    title.textContent = `${winnerName} Wins!`;
    
    const positions = ['bottom', 'left', 'top', 'right'];
    scoresDiv.innerHTML = positions.map(pos => {
        const name = getMultiplayerPlayerName(pos);
        const score = gameState.scores[pos];
        const isWinner = score === winnerScore;
        return `
            <div class="score-row ${isWinner ? 'winner' : ''}">
                <span>${name}</span>
                <span>${score} points</span>
            </div>
        `;
    }).join('');
    
    modal.classList.add('active');
}

// Override game.js functions for multiplayer
const originalConfirmPass = typeof confirmPass !== 'undefined' ? confirmPass : null;
const originalPlayCard = typeof playCard !== 'undefined' ? playCard : null;

// These will be called from game.js, we intercept for multiplayer
function multiplayerConfirmPass() {
    if (!isMultiplayer) return false;
    
    const cardIds = gameState.selectedCardsToPass.map(c => `${c.rank}-${c.suit}`);
    socket.emit('selectCardsToPass', cardIds);
    
    // Clear selection and hide modal
    gameState.selectedCardsToPass = [];
    hidePassModal();
    renderPlayerHand('bottom');
    updateStatus('Waiting for other players to pass cards...');
    
    return true; // Handled
}

function multiplayerPlayCard(player, card) {
    if (!isMultiplayer) return false;
    if (player !== 'bottom') return false;
    
    // Just send to server - don't remove card locally
    // Server will broadcast cardPlayed which will update UI
    const cardId = `${card.rank}-${card.suit}`;
    socket.emit('playCard', cardId);
    
    return true; // Handled - prevent solo mode logic
}
