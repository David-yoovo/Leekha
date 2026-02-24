// Leekha Card Game
// Constants
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT_SYMBOLS = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠'
};

const PLAYERS = ['bottom', 'left', 'top', 'right']; // bottom is human
const WINNING_SCORE = 101;

// Game State
let gameState = {
    deck: [],
    hands: {
        bottom: [],
        left: [],
        top: [],
        right: []
    },
    scores: {
        bottom: 0,
        left: 0,
        top: 0,
        right: 0
    },
    roundScores: {
        bottom: 0,
        left: 0,
        top: 0,
        right: 0
    },
    currentTrick: [],
    currentPlayer: 'bottom',
    dealerIndex: 0,
    leadSuit: null,
    trickNumber: 0,
    roundNumber: 1,
    passDirection: 'right', // alternates between 'right' and 'left'
    selectedCardsToPass: [],
    gamePhase: 'passing', // 'passing', 'playing', 'trickComplete', 'roundOver', 'gameOver'
    passedCards: {
        bottom: [],
        left: [],
        top: [],
        right: []
    }
};

// =====================
// Utility Functions
// =====================

function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ suit, rank });
        }
    }
    return deck;
}

function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function getCardValue(rank) {
    const values = {
        '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
        '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
    };
    return values[rank];
}

function compareCards(card1, card2, leadSuit) {
    // Card following lead suit wins over others
    if (card1.suit === leadSuit && card2.suit !== leadSuit) return 1;
    if (card2.suit === leadSuit && card1.suit !== leadSuit) return -1;
    
    // If both follow lead suit or both don't, compare by rank
    if (card1.suit === card2.suit) {
        return getCardValue(card1.rank) - getCardValue(card2.rank);
    }
    
    // Different non-lead suits - first card wins (shouldn't happen in valid play)
    return 0;
}

function getCardId(card) {
    return `${card.rank}-${card.suit}`;
}

function parseCardId(cardId) {
    const [rank, suit] = cardId.split('-');
    return { rank, suit };
}

function isQueenOfSpades(card) {
    return card.rank === 'Q' && card.suit === 'spades';
}

function isTenOfDiamonds(card) {
    return card.rank === '10' && card.suit === 'diamonds';
}

function isHeart(card) {
    return card.suit === 'hearts';
}

function calculateTrickPoints(cards) {
    let points = 0;
    for (const { card } of cards) {
        if (isQueenOfSpades(card)) points += 13;
        if (isTenOfDiamonds(card)) points += 10;
        if (isHeart(card)) points += 1;
    }
    return points;
}

function getPassTarget(player, direction) {
    const idx = PLAYERS.indexOf(player);
    if (direction === 'right') {
        return PLAYERS[(idx + 1) % 4];
    } else {
        return PLAYERS[(idx + 3) % 4];
    }
}

function getPassSource(player, direction) {
    const idx = PLAYERS.indexOf(player);
    if (direction === 'right') {
        return PLAYERS[(idx + 3) % 4];
    } else {
        return PLAYERS[(idx + 1) % 4];
    }
}

// =====================
// Game Logic
// =====================

function initGame() {
    gameState.scores = { bottom: 0, left: 0, top: 0, right: 0 };
    gameState.roundNumber = 1;
    gameState.dealerIndex = 0;
    gameState.passDirection = 'right';
    startRound();
}

function startRound() {
    // Reset round state
    gameState.roundScores = { bottom: 0, left: 0, top: 0, right: 0 };
    gameState.trickNumber = 0;
    gameState.currentTrick = [];
    gameState.leadSuit = null;
    gameState.passedCards = { bottom: [], left: [], top: [], right: [] };
    gameState.selectedCardsToPass = [];
    
    // Create and shuffle deck
    gameState.deck = shuffleDeck(createDeck());
    
    // Deal cards
    for (let i = 0; i < 4; i++) {
        const player = PLAYERS[i];
        gameState.hands[player] = gameState.deck.slice(i * 13, (i + 1) * 13);
        sortHand(player);
    }
    
    // Start passing phase
    gameState.gamePhase = 'passing';
    updateStatus(`Round ${gameState.roundNumber}: Select 3 cards to pass ${gameState.passDirection}`);
    
    renderAllHands();
    showPassModal();
}

function sortHand(player) {
    gameState.hands[player].sort((a, b) => {
        const suitOrder = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };
        if (suitOrder[a.suit] !== suitOrder[b.suit]) {
            return suitOrder[a.suit] - suitOrder[b.suit];
        }
        return getCardValue(a.rank) - getCardValue(b.rank);
    });
}

function selectCardToPass(card) {
    const cardId = getCardId(card);
    const idx = gameState.selectedCardsToPass.findIndex(c => getCardId(c) === cardId);
    
    if (idx >= 0) {
        gameState.selectedCardsToPass.splice(idx, 1);
    } else if (gameState.selectedCardsToPass.length < 3) {
        gameState.selectedCardsToPass.push(card);
    }
    
    updatePassModal();
    renderPlayerHand('bottom');
}

function confirmPass() {
    if (gameState.selectedCardsToPass.length !== 3) return;
    
    // Store human's cards to pass
    gameState.passedCards.bottom = [...gameState.selectedCardsToPass];
    
    // Remove cards from human's hand
    gameState.hands.bottom = gameState.hands.bottom.filter(
        card => !gameState.selectedCardsToPass.some(c => getCardId(c) === getCardId(card))
    );
    
    // Bots select cards to pass
    for (const player of ['left', 'top', 'right']) {
        gameState.passedCards[player] = selectBotCardsToPass(player);
        gameState.hands[player] = gameState.hands[player].filter(
            card => !gameState.passedCards[player].some(c => getCardId(c) === getCardId(card))
        );
    }
    
    // Exchange cards
    for (const player of PLAYERS) {
        const target = getPassTarget(player, gameState.passDirection);
        gameState.hands[target].push(...gameState.passedCards[player]);
    }
    
    // Sort all hands
    for (const player of PLAYERS) {
        sortHand(player);
    }
    
    // Clear selection and hide modal
    gameState.selectedCardsToPass = [];
    hidePassModal();
    
    // Start playing phase
    gameState.gamePhase = 'playing';
    
    // Player to the right of dealer starts
    gameState.currentPlayer = PLAYERS[(gameState.dealerIndex + 1) % 4];
    gameState.trickNumber = 1;
    
    updateStatus(`Trick ${gameState.trickNumber}: ${getPlayerName(gameState.currentPlayer)}'s turn`);
    renderAllHands();
    updateCurrentPlayerIndicator();
    
    // If bot starts, trigger bot play
    if (gameState.currentPlayer !== 'bottom') {
        setTimeout(botPlay, 1000);
    }
}

function selectBotCardsToPass(player) {
    // Simple bot strategy: pass highest cards that aren't desirable to keep
    const hand = [...gameState.hands[player]];
    const toPass = [];
    
    // Prioritize passing Queen of Spades
    const qos = hand.find(c => isQueenOfSpades(c));
    if (qos) {
        toPass.push(qos);
    }
    
    // Prioritize passing 10 of Diamonds
    const tod = hand.find(c => isTenOfDiamonds(c));
    if (tod && toPass.length < 3) {
        toPass.push(tod);
    }
    
    // Pass high hearts
    const hearts = hand.filter(c => isHeart(c) && !toPass.includes(c))
        .sort((a, b) => getCardValue(b.rank) - getCardValue(a.rank));
    for (const h of hearts) {
        if (toPass.length >= 3) break;
        toPass.push(h);
    }
    
    // Pass remaining high cards
    const remaining = hand.filter(c => !toPass.includes(c))
        .sort((a, b) => getCardValue(b.rank) - getCardValue(a.rank));
    for (const c of remaining) {
        if (toPass.length >= 3) break;
        toPass.push(c);
    }
    
    return toPass.slice(0, 3);
}

function canPlayCard(player, card) {
    if (gameState.gamePhase !== 'playing') return false;
    if (gameState.currentPlayer !== player) return false;
    
    const hand = gameState.hands[player];
    
    // If no lead suit, any card is valid
    if (!gameState.leadSuit) return true;
    
    // Check if player has cards of lead suit
    const hasLeadSuit = hand.some(c => c.suit === gameState.leadSuit);
    
    if (hasLeadSuit) {
        // Must play lead suit
        return card.suit === gameState.leadSuit;
    } else {
        // Leekha principle: if you can't follow suit and have QoS or 10oD, must play one
        const hasQoS = hand.some(c => isQueenOfSpades(c));
        const has10oD = hand.some(c => isTenOfDiamonds(c));
        
        if (hasQoS || has10oD) {
            // Must play QoS or 10oD
            return isQueenOfSpades(card) || isTenOfDiamonds(card);
        }
        
        // Can play any card
        return true;
    }
}

function getPlayableCards(player) {
    return gameState.hands[player].filter(card => canPlayCard(player, card));
}

function playCard(player, card) {
    if (!canPlayCard(player, card)) return false;
    
    // Remove card from hand
    const cardIdx = gameState.hands[player].findIndex(c => getCardId(c) === getCardId(card));
    if (cardIdx === -1) return false;
    gameState.hands[player].splice(cardIdx, 1);
    
    // Set lead suit if first card
    if (gameState.currentTrick.length === 0) {
        gameState.leadSuit = card.suit;
    }
    
    // Add to trick
    gameState.currentTrick.push({ player, card });
    
    // Render the played card on table
    renderCardOnTable(player, card);
    renderPlayerHand(player);
    
    // Check if trick is complete
    if (gameState.currentTrick.length === 4) {
        gameState.gamePhase = 'trickComplete';
        setTimeout(completeTrick, 1500);
    } else {
        // Next player
        const nextIdx = (PLAYERS.indexOf(player) + 1) % 4;
        gameState.currentPlayer = PLAYERS[nextIdx];
        updateStatus(`Trick ${gameState.trickNumber}: ${getPlayerName(gameState.currentPlayer)}'s turn`);
        updateCurrentPlayerIndicator();
        renderPlayerHand('bottom'); // Update playable indicators
        
        // If bot's turn, trigger bot play
        if (gameState.currentPlayer !== 'bottom') {
            setTimeout(botPlay, 800);
        }
    }
    
    return true;
}

function completeTrick() {
    // Find winner
    const leadCard = gameState.currentTrick[0];
    let winner = leadCard;
    
    for (let i = 1; i < gameState.currentTrick.length; i++) {
        const current = gameState.currentTrick[i];
        if (compareCards(current.card, winner.card, gameState.leadSuit) > 0) {
            winner = current;
        }
    }
    
    // Calculate points for this trick
    const points = calculateTrickPoints(gameState.currentTrick);
    gameState.roundScores[winner.player] += points;
    
    updateScores();
    
    // Clear table
    clearTable();
    
    // Check if round is over
    if (gameState.hands.bottom.length === 0) {
        endRound();
    } else {
        // Start next trick
        gameState.currentTrick = [];
        gameState.leadSuit = null;
        gameState.trickNumber++;
        gameState.currentPlayer = winner.player;
        gameState.gamePhase = 'playing';
        
        updateStatus(`Trick ${gameState.trickNumber}: ${getPlayerName(gameState.currentPlayer)}'s turn`);
        updateCurrentPlayerIndicator();
        renderPlayerHand('bottom');
        
        // If bot's turn, trigger bot play
        if (gameState.currentPlayer !== 'bottom') {
            setTimeout(botPlay, 800);
        }
    }
}

function endRound() {
    gameState.gamePhase = 'roundOver';
    
    // Add round scores to total
    for (const player of PLAYERS) {
        gameState.scores[player] += gameState.roundScores[player];
    }
    
    updateScores();
    
    // Check if game is over
    const maxScore = Math.max(...Object.values(gameState.scores));
    if (maxScore >= WINNING_SCORE) {
        endGame();
    } else {
        showRoundOverModal();
    }
}

function endGame() {
    gameState.gamePhase = 'gameOver';
    
    // Find winner (lowest score)
    let minScore = Infinity;
    let winner = null;
    for (const player of PLAYERS) {
        if (gameState.scores[player] < minScore) {
            minScore = gameState.scores[player];
            winner = player;
        }
    }
    
    showGameOverModal(winner);
}

function nextRound() {
    hideRoundOverModal();
    gameState.roundNumber++;
    gameState.dealerIndex = (gameState.dealerIndex + 1) % 4;
    gameState.passDirection = gameState.passDirection === 'right' ? 'left' : 'right';
    startRound();
}

function newGame() {
    hideGameOverModal();
    initGame();
}

// =====================
// Bot AI
// =====================

function botPlay() {
    if (gameState.currentPlayer === 'bottom') return;
    if (gameState.gamePhase !== 'playing') return;
    
    const player = gameState.currentPlayer;
    const playableCards = getPlayableCards(player);
    
    if (playableCards.length === 0) return;
    
    // Simple bot strategy
    let cardToPlay;
    
    if (gameState.currentTrick.length === 0) {
        // Bot is leading - play lowest non-penalty card
        cardToPlay = selectLeadCard(player, playableCards);
    } else {
        // Bot is following
        cardToPlay = selectFollowCard(player, playableCards);
    }
    
    playCard(player, cardToPlay);
}

function selectLeadCard(player, playableCards) {
    // Avoid leading with penalty cards if possible
    const nonPenalty = playableCards.filter(c => 
        !isQueenOfSpades(c) && !isTenOfDiamonds(c) && !isHeart(c)
    );
    
    if (nonPenalty.length > 0) {
        // Play lowest non-penalty card
        return nonPenalty.sort((a, b) => getCardValue(a.rank) - getCardValue(b.rank))[0];
    }
    
    // Have to lead with penalty - play lowest
    return playableCards.sort((a, b) => getCardValue(a.rank) - getCardValue(b.rank))[0];
}

function selectFollowCard(player, playableCards) {
    const leadSuit = gameState.leadSuit;
    const followingSuit = playableCards.filter(c => c.suit === leadSuit);
    
    if (followingSuit.length > 0) {
        // Following suit
        // Check if we can safely lose (play high) or need to play low
        const currentWinner = getCurrentTrickWinner();
        const canWin = followingSuit.some(c => 
            compareCards(c, currentWinner.card, leadSuit) > 0
        );
        
        // If trick has penalty points and we're last player, try not to win
        const trickPoints = calculateTrickPoints(gameState.currentTrick);
        const isLastPlayer = gameState.currentTrick.length === 3;
        
        if (isLastPlayer && trickPoints > 0) {
            // Try to play low to let someone else take it
            const losers = followingSuit.filter(c => 
                compareCards(c, currentWinner.card, leadSuit) < 0
            );
            if (losers.length > 0) {
                return losers.sort((a, b) => getCardValue(b.rank) - getCardValue(a.rank))[0];
            }
        }
        
        // Play lowest card
        return followingSuit.sort((a, b) => getCardValue(a.rank) - getCardValue(b.rank))[0];
    } else {
        // Can't follow suit - play penalty cards (Leekha)
        // This is enforced by canPlayCard, so playableCards should only have penalty cards if applicable
        const qos = playableCards.find(c => isQueenOfSpades(c));
        const tod = playableCards.find(c => isTenOfDiamonds(c));
        
        if (qos && tod) {
            // Choose which to dump - prefer QoS as it's more points
            return qos;
        }
        if (qos) return qos;
        if (tod) return tod;
        
        // Dump highest hearts first
        const hearts = playableCards.filter(c => isHeart(c));
        if (hearts.length > 0) {
            return hearts.sort((a, b) => getCardValue(b.rank) - getCardValue(a.rank))[0];
        }
        
        // Play highest card to dump
        return playableCards.sort((a, b) => getCardValue(b.rank) - getCardValue(a.rank))[0];
    }
}

function getCurrentTrickWinner() {
    if (gameState.currentTrick.length === 0) return null;
    
    let winner = gameState.currentTrick[0];
    for (let i = 1; i < gameState.currentTrick.length; i++) {
        if (compareCards(gameState.currentTrick[i].card, winner.card, gameState.leadSuit) > 0) {
            winner = gameState.currentTrick[i];
        }
    }
    return winner;
}

// =====================
// UI Rendering
// =====================

function createCardElement(card, showFace = true) {
    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.cardId = getCardId(card);
    
    if (showFace) {
        const suitClass = `suit-${card.suit}`;
        div.innerHTML = `
            <div class="card-corner card-corner-top ${suitClass}">${card.rank}${SUIT_SYMBOLS[card.suit]}</div>
            <div class="card-center ${suitClass}">${SUIT_SYMBOLS[card.suit]}</div>
            <div class="card-corner card-corner-bottom ${suitClass}">${card.rank}${SUIT_SYMBOLS[card.suit]}</div>
        `;
    } else {
        div.classList.add('card-back');
    }
    
    return div;
}

function renderPlayerHand(player) {
    const container = document.getElementById(`hand-${player}`);
    container.innerHTML = '';
    
    const hand = gameState.hands[player];
    const isHuman = player === 'bottom';
    
    hand.forEach(card => {
        const cardEl = createCardElement(card, isHuman);
        
        if (isHuman) {
            if (gameState.gamePhase === 'passing') {
                // Passing phase
                const isSelected = gameState.selectedCardsToPass.some(
                    c => getCardId(c) === getCardId(card)
                );
                if (isSelected) {
                    cardEl.classList.add('selected');
                }
                cardEl.addEventListener('click', () => selectCardToPass(card));
            } else if (gameState.gamePhase === 'playing') {
                // Playing phase
                const canPlay = canPlayCard(player, card);
                if (canPlay) {
                    cardEl.classList.add('playable');
                    cardEl.draggable = true;
                    setupDragAndDrop(cardEl, card);
                    cardEl.addEventListener('click', () => playCard(player, card));
                } else {
                    cardEl.classList.add('disabled');
                }
            }
        }
        
        container.appendChild(cardEl);
    });
}

function renderAllHands() {
    PLAYERS.forEach(player => renderPlayerHand(player));
}

function renderCardOnTable(player, card) {
    const surface = document.getElementById('table-surface');
    
    const wrapper = document.createElement('div');
    wrapper.className = 'table-card';
    wrapper.dataset.player = player;
    
    const cardEl = createCardElement(card, true);
    cardEl.style.cursor = 'default';
    wrapper.appendChild(cardEl);
    
    // Position based on player with slight random rotation
    const rotation = (Math.random() - 0.5) * 20;
    const positions = {
        bottom: { x: 0, y: 40 },
        top: { x: 0, y: -40 },
        left: { x: -50, y: 0 },
        right: { x: 50, y: 0 }
    };
    
    const pos = positions[player];
    wrapper.style.transform = `translate(${pos.x}px, ${pos.y}px) rotate(${rotation}deg)`;
    
    surface.appendChild(wrapper);
}

function clearTable() {
    const surface = document.getElementById('table-surface');
    surface.innerHTML = '';
}

function setupDragAndDrop(cardEl, card) {
    cardEl.addEventListener('dragstart', (e) => {
        cardEl.classList.add('dragging');
        e.dataTransfer.setData('text/plain', getCardId(card));
    });
    
    cardEl.addEventListener('dragend', () => {
        cardEl.classList.remove('dragging');
    });
}

function setupTableDrop() {
    const surface = document.getElementById('table-surface');
    
    surface.addEventListener('dragover', (e) => {
        e.preventDefault();
        surface.classList.add('drag-over');
    });
    
    surface.addEventListener('dragleave', () => {
        surface.classList.remove('drag-over');
    });
    
    surface.addEventListener('drop', (e) => {
        e.preventDefault();
        surface.classList.remove('drag-over');
        
        const cardId = e.dataTransfer.getData('text/plain');
        const card = parseCardId(cardId);
        const fullCard = gameState.hands.bottom.find(c => getCardId(c) === cardId);
        
        if (fullCard && canPlayCard('bottom', fullCard)) {
            playCard('bottom', fullCard);
        }
    });
}

// =====================
// Modals
// =====================

function showPassModal() {
    const modal = document.getElementById('pass-modal');
    const direction = document.getElementById('pass-direction');
    direction.textContent = `Passing to your ${gameState.passDirection}`;
    modal.classList.add('active');
    updatePassModal();
}

function hidePassModal() {
    document.getElementById('pass-modal').classList.remove('active');
}

function updatePassModal() {
    const container = document.getElementById('selected-cards');
    const btn = document.getElementById('btn-confirm-pass');
    
    container.innerHTML = '';
    gameState.selectedCardsToPass.forEach(card => {
        const cardEl = createCardElement(card, true);
        cardEl.style.cursor = 'default';
        container.appendChild(cardEl);
    });
    
    btn.disabled = gameState.selectedCardsToPass.length !== 3;
}

function showRoundOverModal() {
    const modal = document.getElementById('round-over-modal');
    const scoresDiv = document.getElementById('round-scores');
    
    scoresDiv.innerHTML = PLAYERS.map(player => `
        <div class="score-row">
            <span>${getPlayerName(player)}</span>
            <span>+${gameState.roundScores[player]} (Total: ${gameState.scores[player]})</span>
        </div>
    `).join('');
    
    modal.classList.add('active');
}

function hideRoundOverModal() {
    document.getElementById('round-over-modal').classList.remove('active');
}

function showGameOverModal(winner) {
    const modal = document.getElementById('game-over-modal');
    const title = document.getElementById('game-over-title');
    const scoresDiv = document.getElementById('final-scores');
    
    title.textContent = `${getPlayerName(winner)} Wins!`;
    
    scoresDiv.innerHTML = PLAYERS.map(player => `
        <div class="score-row ${player === winner ? 'winner' : ''}">
            <span>${getPlayerName(player)}</span>
            <span>${gameState.scores[player]} points</span>
        </div>
    `).join('');
    
    modal.classList.add('active');
}

function hideGameOverModal() {
    document.getElementById('game-over-modal').classList.remove('active');
}

// =====================
// UI Updates
// =====================

function updateStatus(message) {
    document.getElementById('game-status').textContent = message;
}

function updateScores() {
    PLAYERS.forEach(player => {
        document.getElementById(`score-${player}`).textContent = gameState.scores[player];
    });
}

function updateCurrentPlayerIndicator() {
    PLAYERS.forEach(player => {
        const area = document.getElementById(`player-${player}`);
        if (player === gameState.currentPlayer) {
            area.classList.add('current-player');
        } else {
            area.classList.remove('current-player');
        }
    });
}

function getPlayerName(player) {
    const names = {
        bottom: 'You',
        left: 'Bot 1',
        top: 'Bot 2',
        right: 'Bot 3'
    };
    return names[player];
}

// =====================
// Event Listeners
// =====================

document.addEventListener('DOMContentLoaded', () => {
    setupTableDrop();
    
    document.getElementById('btn-confirm-pass').addEventListener('click', confirmPass);
    document.getElementById('btn-next-round').addEventListener('click', nextRound);
    document.getElementById('btn-new-game').addEventListener('click', newGame);
    
    initGame();
});
