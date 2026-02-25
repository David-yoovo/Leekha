// Multiplayer Client
let socket = null;
let isMultiplayer = false;
let myUsername = '';
let myRoomId = '';
let isReady = false;
let multiplayerNames = {}; // Store player names by position
let hasPassed = false; // Track if we've confirmed our pass
let pendingReceivedCards = []; // Cards received before we passed
let isAnimatingTrick = false; // Prevent race between trick animation and newTrick
let hasPlayedCard = false; // Prevent playing multiple cards in one turn
let isHandlingRoundStart = false; // Prevent duplicate round handling
let currentRoundNumber = 0; // Track current round to prevent duplicate handling

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

    socket.on('cardsIncoming', (data) => {
        if (data.targetPlayer === socket.id) {
            handleCardsIncoming(data);
        }
    });

    socket.on('collectingStarted', (data) => {
        if (data.targetPlayer === socket.id) {
            handleCollectingStarted(data.state);
        }
    });

    socket.on('cardsPassedConfirmed', (data) => {
        if (data.targetPlayer === socket.id) {
            hasPassed = true;
            // Check if we have pending cards to reveal
            checkPendingReceivedCards();
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

    socket.on('nextRoundStatus', (data) => {
        if (data.targetPlayer === socket.id) {
            handleNextRoundStatus(data);
        }
    });

    socket.on('gameOver', (data) => {
        if (data.targetPlayer === socket.id) {
            handleGameOver(data);
        }
    });

    socket.on('matchOver', (data) => {
        if (data.targetPlayer === socket.id) {
            handleMatchOver(data);
        }
    });

    socket.on('nextGameStatus', (data) => {
        if (data.targetPlayer === socket.id) {
            handleNextGameStatus(data);
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
        slot.className = `player-slot ${player ? 'filled' : 'empty'} ${player?.isBot ? 'bot' : ''}`;
        
        if (player) {
            const isMe = player.id === socket.id;
            const isBot = player.isBot;
            slot.innerHTML = `
                <div class="player-info">
                    <span class="position-badge">${positionLabels[pos]}</span>
                    <span>${player.username}${isMe ? ' (you)' : ''}${isBot ? ' 🤖' : ''}</span>
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
    
    const humanCount = room.humanCount || room.players.filter(p => !p.isBot).length;
    const humanReadyCount = room.players.filter(p => !p.isBot && p.ready).length;
    const botCount = room.players.filter(p => p.isBot).length;
    
    if (humanCount < 4) {
        if (humanReadyCount === humanCount && humanCount > 0) {
            waitingStatus.textContent = `Ready to start with ${botCount} bot${botCount !== 1 ? 's' : ''}!`;
        } else {
            waitingStatus.textContent = `${humanCount} player${humanCount !== 1 ? 's' : ''}, ${botCount} bot${botCount !== 1 ? 's' : ''} - waiting for ready (${humanReadyCount}/${humanCount})`;
        }
    } else {
        const readyCount = room.players.filter(p => p.ready).length;
        if (readyCount < 4) {
            waitingStatus.textContent = `Waiting for everyone to be ready... (${readyCount}/4)`;
        } else {
            waitingStatus.textContent = 'Starting game...';
        }
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
    console.log('handleMultiplayerGameStart called, round:', state.roundNumber, 'current:', currentRoundNumber, 'handling:', isHandlingRoundStart);
    
    // Prevent duplicate handling of the same round - always skip if already processed
    if (state.roundNumber === currentRoundNumber && state.roundNumber > 0) {
        console.warn('Already processed round', state.roundNumber, '- ignoring duplicate');
        return;
    }
    
    // If we're already dealing, wait for it to finish
    if (isHandlingRoundStart) {
        console.warn('Already handling round start, ignoring overlapping call');
        return;
    }
    
    isHandlingRoundStart = true;
    currentRoundNumber = state.roundNumber;
    
    try {
        hideLobby();
        
        // Hide round over modal if it was open (new round starting)
        hideRoundOverModal();
        
        // Reset pass state for new round
        hasPassed = false;
        pendingReceivedCards = [];
        hasPlayedCard = false;
        
        // Store player names
        multiplayerNames = state.playerNames || {};
        
        // Update player labels in the UI
        updatePlayerLabels();
        
        // Reset game state - IMPORTANT: clear hands before dealing
        gameState.hands = { bottom: [], left: [], top: [], right: [] };
        gameState.takenCards = { bottom: [], left: [], top: [], right: [] };
        gameState.scores = state.scores || { bottom: 0, left: 0, top: 0, right: 0 };
        gameState.roundScores = state.roundScores || { bottom: 0, left: 0, top: 0, right: 0 };
        gameState.hmarLetters = state.hmarLetters || { bottom: '', left: '', top: '', right: '' };
        gameState.passDirection = state.passDirection;
        gameState.currentTrick = [];
        
        // Clear UI
        renderAllHands();
        clearTable();
        updateScores();
        updateCurrentPlayerInfo();
        
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
    } finally {
        isHandlingRoundStart = false;
    }
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
    
    // Clear hands first to ensure no duplicates
    gameState.hands = { bottom: [], left: [], top: [], right: [] };
    
    // Start deal sound
    if (typeof soundEnabled !== 'undefined' && soundEnabled && typeof cardDealSound !== 'undefined') {
        cardDealSound.currentTime = 0;
        cardDealSound.play().catch(() => {});
    }
    
    // Animate dealing 13 cards to each player
    for (let cardNum = 0; cardNum < 13; cardNum++) {
        for (let i = 0; i < 4; i++) {
            const player = dealOrder[i];
            
            // Add card to hand
            if (player === 'bottom' && cardNum < myHand.length) {
                gameState.hands.bottom.push(myHand[cardNum]);
            } else if (player !== 'bottom') {
                // Add dummy card for other players
                const count = cardCounts[player] || 13;
                if (gameState.hands[player].length < count) {
                    gameState.hands[player].push({ suit: 'back', rank: 'X' });
                }
            }
            
            // Animate card dealing
            const targetPos = getPlayerPosition(player);
            const showFace = player === 'bottom';
            const dummyCard = { suit: 'hearts', rank: 'A' };
            
            animateCardSlide(dummyCard, deckPos, targetPos, showFace, 250);
            
            // Render hand progressively for all players
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

// Handle cards coming from another player
function handleCardsIncoming(data) {
    // Cards are being passed to us from another player
    pendingReceivedCards = data.cards.map(card => ({
        card: card,
        revealed: false, // Show face down initially
        locked: !hasPassed // Can't interact until we've passed
    }));
    
    // Store pass direction for positioning
    gameState.passDirection = gameState.passDirection || 'right';
    
    // Render the pending received cards (locked if we haven't passed)
    renderPendingReceivedCards();
}

// Check if we can unlock pending received cards
function checkPendingReceivedCards() {
    if (hasPassed && pendingReceivedCards.length > 0) {
        // Unlock the cards so player can reveal them
        pendingReceivedCards.forEach(item => {
            item.locked = false;
        });
        renderPendingReceivedCards();
        updateStatus('Cards received! Click to reveal them.');
    }
}

// Render pending received cards (shown during passing phase)
function renderPendingReceivedCards() {
    const container = document.getElementById('received-cards-area');
    if (!container) return;
    
    container.innerHTML = '';
    container.classList.remove('from-left', 'from-right');
    
    if (pendingReceivedCards.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'flex';
    
    // Position based on pass direction (opposite of where we're passing TO)
    // If passing right, we receive from left; if passing left, we receive from right
    if (gameState.passDirection === 'right') {
        container.classList.add('from-left');
    } else {
        container.classList.add('from-right');
    }
    
    pendingReceivedCards.forEach((item, index) => {
        const cardEl = document.createElement('div');
        cardEl.className = 'received-card';
        const rotation = gameState.passDirection === 'right' 
            ? (5 + index * 5)  // Coming from left
            : -(5 + index * 5); // Coming from right
        cardEl.style.transform = `rotate(${rotation}deg)`;
        cardEl.style.zIndex = index;
        
        if (item.revealed) {
            // Show face
            const suitClass = `suit-${item.card.suit}`;
            cardEl.classList.add('card', 'revealed');
            cardEl.innerHTML = `
                <div class="card-corner card-corner-top ${suitClass}">${item.card.rank}${SUIT_SYMBOLS[item.card.suit]}</div>
                <div class="card-center ${suitClass}">${SUIT_SYMBOLS[item.card.suit]}</div>
                <div class="card-corner card-corner-bottom ${suitClass}">${item.card.rank}${SUIT_SYMBOLS[item.card.suit]}</div>
            `;
            if (!item.locked) {
                cardEl.addEventListener('click', () => collectPendingCard(index));
            }
        } else {
            // Show back
            cardEl.classList.add('card', 'card-back');
            if (item.locked) {
                cardEl.classList.add('locked');
                cardEl.title = 'Pass your cards first!';
            } else {
                cardEl.addEventListener('click', () => revealPendingCard(index));
            }
        }
        
        container.appendChild(cardEl);
    });
}

// Reveal a pending received card
function revealPendingCard(index) {
    if (pendingReceivedCards[index].locked) return;
    
    playSound('sound-card-flip');
    pendingReceivedCards[index].revealed = true;
    renderPendingReceivedCards();
}

// Collect a revealed pending card
function collectPendingCard(index) {
    const item = pendingReceivedCards[index];
    if (!item.revealed || item.locked) return;
    
    playSound('sound-card-play');
    
    // Add card to hand
    gameState.hands.bottom.push(item.card);
    
    // Remove from pending cards
    pendingReceivedCards.splice(index, 1);
    
    // Sort hand and re-render
    sortHand('bottom');
    renderPlayerHand('bottom');
    renderPendingReceivedCards();
    
    // Check if all cards collected - notify server
    if (pendingReceivedCards.length === 0) {
        socket.emit('cardsCollected');
        updateStatus('Waiting for other players to collect their cards...');
    } else {
        updateStatus(`Click to collect remaining ${pendingReceivedCards.length} card(s).`);
    }
}

// Handle when collecting phase starts
function handleCollectingStarted(state) {
    gameState.gamePhase = 'collecting';
    
    // Update player names if included
    if (state.playerNames) {
        multiplayerNames = state.playerNames;
        updatePlayerLabels();
    }
    
    // Update status message
    if (pendingReceivedCards.length > 0) {
        updateStatus('Cards received! Click to reveal and collect them.');
    } else {
        // We already collected all cards before this event came
        socket.emit('cardsCollected');
        updateStatus('Waiting for other players to collect their cards...');
    }
    
    // Update UI to reflect collecting phase
    renderPlayerHand('bottom');
}

function handleCardsExchanged(state) {
    // Clear pending received cards - server handles the final exchange
    pendingReceivedCards = [];
    hasPlayedCard = false; // Reset for playing phase
    
    // Update player names if included
    if (state.playerNames) {
        multiplayerNames = state.playerNames;
        updatePlayerLabels();
    }
    
    // Use server's definitive hand (includes received cards)
    gameState.hands.bottom = state.myHand;
    
    // Update other players' card counts from server data
    if (state.otherPlayers) {
        for (const op of state.otherPlayers) {
            // Reset their dummy hand to the correct count
            gameState.hands[op.position] = [];
            for (let i = 0; i < op.cardCount; i++) {
                gameState.hands[op.position].push({ suit: 'back', rank: 'X' });
            }
        }
    }
    
    gameState.gamePhase = state.phase;
    gameState.currentPlayer = state.currentPlayer;
    
    // Clear any previous received cards UI
    gameState.receivedCards = [];
    
    hidePassModal();
    
    // Hide pending cards area
    const receivedArea = document.getElementById('received-cards-area');
    if (receivedArea) receivedArea.style.display = 'none';
    
    // Sort and render final hand
    sortHand('bottom');
    renderAllHands();
    
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
    // Track the card in current trick
    gameState.currentTrick.push({ player: data.position, card: data.card });
    
    // Render card on table from any player
    renderCardOnTable(data.position, data.card);
    playSound('sound-card-play');
    
    // Remove card from hand (for any player)
    if (data.position === 'bottom') {
        const cardId = `${data.card.rank}-${data.card.suit}`;
        gameState.hands.bottom = gameState.hands.bottom.filter(c => 
            `${c.rank}-${c.suit}` !== cardId
        );
    } else {
        // For other players, remove one dummy card from their hand
        if (gameState.hands[data.position] && gameState.hands[data.position].length > 0) {
            gameState.hands[data.position].pop();
        }
    }
    
    // Re-render the player's hand
    renderPlayerHand(data.position);
}

function handleTurnChanged(state) {
    gameState.currentPlayer = state.currentPlayer;
    gameState.leadSuit = state.leadSuit;
    
    // Sync other players' card counts from server
    if (state.otherPlayers) {
        for (const op of state.otherPlayers) {
            const currentCount = gameState.hands[op.position]?.length || 0;
            if (currentCount !== op.cardCount) {
                // Resync dummy cards
                gameState.hands[op.position] = [];
                for (let i = 0; i < op.cardCount; i++) {
                    gameState.hands[op.position].push({ suit: 'back', rank: 'X' });
                }
                renderPlayerHand(op.position);
            }
        }
    }
    
    // Reset played card flag when turn changes (allows new play when it's our turn again)
    hasPlayedCard = false;
    
    const playerName = getMultiplayerPlayerName(state.currentPlayer);
    updateStatus(`Trick ${state.trickNumber}: ${playerName}'s turn`);
    updateCurrentPlayerIndicator();
    renderPlayerHand('bottom');
}

async function handleTrickComplete(data) {
    isAnimatingTrick = true;
    playSound('sound-trick-win');
    const winnerName = getMultiplayerPlayerName(data.winner);
    updateStatus(`${winnerName} wins the trick!`);
    
    // Store won cards for the winner
    if (data.cards && data.cards.length > 0) {
        gameState.takenCards[data.winner].push(...data.cards);
    }
    
    // Update points
    if (data.points !== undefined) {
        gameState.roundScores[data.winner] += data.points;
    }
    
    updateCurrentPlayerInfo();
    
    // Use same animation as solo mode
    await animateTrickCollection(data.winner);
    clearTable();
    
    // Clear currentTrick after animation
    gameState.currentTrick = [];
    isAnimatingTrick = false;
}

function handleNewTrick(state) {
    // Wait for trick animation to complete if still running
    if (isAnimatingTrick) {
        setTimeout(() => handleNewTrick(state), 100);
        return;
    }
    
    // Update game state for new trick
    gameState.currentPlayer = state.currentPlayer;
    gameState.trickNumber = state.trickNumber;
    gameState.leadSuit = null;
    gameState.currentTrick = [];
    gameState.gamePhase = 'playing';
    
    // Sync other players' card counts from server
    if (state.otherPlayers) {
        for (const op of state.otherPlayers) {
            gameState.hands[op.position] = [];
            for (let i = 0; i < op.cardCount; i++) {
                gameState.hands[op.position].push({ suit: 'back', rank: 'X' });
            }
        }
        renderAllHands();
    }
    
    // Reset played card flag for new trick
    hasPlayedCard = false;
    
    // Table should already be cleared by handleTrickComplete animation
    
    const playerName = getMultiplayerPlayerName(state.currentPlayer);
    updateStatus(`Trick ${state.trickNumber}: ${playerName}'s turn`);
    updateCurrentPlayerIndicator();
    updateCurrentPlayerInfo();
    renderPlayerHand('bottom');
}

function handleRoundOver(data) {
    playSound('sound-round-end');
    
    // Update scores and HMAR letters
    for (const pos of ['bottom', 'left', 'top', 'right']) {
        gameState.scores[pos] = data.totalScores[pos];
        gameState.roundScores[pos] = data.roundScores[pos];
        if (data.hmarLetters) {
            gameState.hmarLetters[pos] = data.hmarLetters[pos] || '';
        }
    }
    
    updateScores();
    
    // Show round over modal with player names and HMAR
    showRoundOverModalMultiplayer(data.loser);
}

function showRoundOverModalMultiplayer(loser) {
    const modal = document.getElementById('round-over-modal');
    const scoresDiv = document.getElementById('round-scores');
    
    const positions = ['bottom', 'left', 'top', 'right'];
    scoresDiv.innerHTML = positions.map(pos => {
        const name = getMultiplayerPlayerName(pos);
        const hmar = gameState.hmarLetters[pos] || '';
        const hmarDisplay = hmar ? ` [${hmar}]` : '';
        const isLoser = pos === loser;
        return `
            <div class="score-row ${isLoser ? 'loser' : ''}">
                <span>${name}${hmarDisplay}</span>
                <span>+${gameState.roundScores[pos]} (Total: ${gameState.scores[pos]})</span>
            </div>
        `;
    }).join('');
    
    // Setup next round button for multiplayer
    const nextRoundBtn = document.getElementById('btn-next-round');
    if (nextRoundBtn) {
        nextRoundBtn.textContent = 'Next Round';
        nextRoundBtn.disabled = false;
        nextRoundBtn.onclick = () => {
            if (isMultiplayer && socket) {
                socket.emit('nextRound');
                nextRoundBtn.textContent = 'Waiting for others... (1/4)';
                nextRoundBtn.disabled = true;
            } else {
                nextRound();
            }
        };
    }
    
    modal.classList.add('active');
}

function handleNextRoundStatus(data) {
    const nextRoundBtn = document.getElementById('btn-next-round');
    if (nextRoundBtn && data.youReady) {
        nextRoundBtn.textContent = `Waiting for others... (${data.readyCount}/${data.totalPlayers})`;
        nextRoundBtn.disabled = true;
    }
}

function handleGameOver(data) {
    // Called when someone reaches 101+ but HMAR is not complete
    playSound('sound-game-over');
    
    for (const pos of ['bottom', 'left', 'top', 'right']) {
        if (data.hmarLetters) {
            gameState.hmarLetters[pos] = data.hmarLetters[pos] || '';
        }
    }
    
    updateScores();
    
    const loserName = getMultiplayerPlayerName(data.loser);
    showGameOverModalMultiplayer(loserName, data.loser, false);
}

function handleMatchOver(data) {
    // Called when someone completes HMAR (match over)
    playSound('sound-game-over');
    
    for (const pos of ['bottom', 'left', 'top', 'right']) {
        if (data.hmarLetters) {
            gameState.hmarLetters[pos] = data.hmarLetters[pos] || '';
        }
    }
    
    updateScores();
    
    const loserName = getMultiplayerPlayerName(data.loser);
    const winnerName = getMultiplayerPlayerName(data.winner);
    showMatchOverModalMultiplayer(loserName, data.loser, data.winner);
}

function handleNextGameStatus(data) {
    // Update button text while waiting for others
    const newGameBtn = document.getElementById('new-game-btn');
    if (newGameBtn && data.youReady) {
        newGameBtn.textContent = `Waiting for others... (${data.readyCount}/${data.totalPlayers})`;
        newGameBtn.disabled = true;
    }
}

function showGameOverModalMultiplayer(loserName, loserPosition, isMatchOver) {
    const modal = document.getElementById('game-over-modal');
    const title = document.getElementById('game-over-title');
    const scoresDiv = document.getElementById('final-scores');
    const newGameBtn = document.getElementById('new-game-btn');
    
    const loserHmar = gameState.hmarLetters[loserPosition] || '';
    title.textContent = `${loserName} lost this game! [${loserHmar}]`;
    
    const positions = ['bottom', 'left', 'top', 'right'];
    scoresDiv.innerHTML = positions.map(pos => {
        const name = getMultiplayerPlayerName(pos);
        const hmar = gameState.hmarLetters[pos] || '';
        const hmarDisplay = hmar ? ` [${hmar}]` : '';
        const isLoser = pos === loserPosition;
        return `
            <div class="score-row ${isLoser ? 'loser' : ''}">
                <span>${name}${hmarDisplay}</span>
                <span>${gameState.scores[pos]} points</span>
            </div>
        `;
    }).join('');
    
    // Change button to "Next Game" for multiplayer
    if (newGameBtn) {
        newGameBtn.textContent = 'Next Game';
        newGameBtn.disabled = false;
        newGameBtn.onclick = () => {
            socket.emit('nextGame');
            newGameBtn.textContent = 'Waiting for others... (1/4)';
            newGameBtn.disabled = true;
        };
    }
    
    modal.classList.add('active');
}

function showMatchOverModalMultiplayer(loserName, loserPosition, winnerPosition) {
    const modal = document.getElementById('game-over-modal');
    const title = document.getElementById('game-over-title');
    const scoresDiv = document.getElementById('final-scores');
    const newGameBtn = document.getElementById('new-game-btn');
    
    title.textContent = `${loserName} is HMAR!`;
    
    const positions = ['bottom', 'left', 'top', 'right'];
    scoresDiv.innerHTML = positions.map(pos => {
        const name = getMultiplayerPlayerName(pos);
        const hmar = gameState.hmarLetters[pos] || '';
        const hmarDisplay = hmar ? ` [${hmar}]` : '';
        const isLoser = pos === loserPosition;
        const isWinner = pos === winnerPosition;
        return `
            <div class="score-row ${isLoser ? 'loser' : ''} ${isWinner ? 'winner' : ''}">
                <span>${name}${hmarDisplay}</span>
                <span>${isWinner ? '🏆 WINNER' : ''}</span>
            </div>
        `;
    }).join('');
    
    // Change button to "Back to Lobby" for match over
    if (newGameBtn) {
        newGameBtn.textContent = 'Back to Lobby';
        newGameBtn.disabled = false;
        newGameBtn.onclick = () => {
            hideGameOverModal();
            backToMenu();
        };
    }
    
    modal.classList.add('active');
}

// Override game.js functions for multiplayer
const originalConfirmPass = typeof confirmPass !== 'undefined' ? confirmPass : null;
const originalPlayCard = typeof playCard !== 'undefined' ? playCard : null;

// These will be called from game.js, we intercept for multiplayer
function multiplayerConfirmPass() {
    if (!isMultiplayer) return false;
    
    const cardIds = gameState.selectedCardsToPass.map(c => `${c.rank}-${c.suit}`);
    
    // Remove the passed cards from hand
    for (const card of gameState.selectedCardsToPass) {
        const cardId = `${card.rank}-${card.suit}`;
        gameState.hands.bottom = gameState.hands.bottom.filter(c => 
            `${c.rank}-${c.suit}` !== cardId
        );
    }
    
    // Send to server
    socket.emit('selectCardsToPass', cardIds);
    
    // Clear selection and hide modal
    gameState.selectedCardsToPass = [];
    
    // Change phase so cards aren't selectable anymore
    gameState.gamePhase = 'waitingForExchange';
    
    hidePassModal();
    renderPlayerHand('bottom');
    updateStatus('Waiting for other players to pass cards...');
    
    // Check if we have pending received cards to reveal now
    checkPendingReceivedCards();
    
    return true; // Handled
}

function multiplayerPlayCard(player, card) {
    if (!isMultiplayer) return false;
    if (player !== 'bottom') return false;
    if (hasPlayedCard) return true; // Already played a card this turn, block
    
    // Mark that we've played a card - prevents double plays
    hasPlayedCard = true;
    
    // Just send to server - don't remove card locally
    // Server will broadcast cardPlayed which will update UI
    const cardId = `${card.rank}-${card.suit}`;
    socket.emit('playCard', cardId);
    
    // Immediately re-render hand to disable all cards visually
    renderPlayerHand('bottom');
    
    return true; // Handled - prevent solo mode logic
}
