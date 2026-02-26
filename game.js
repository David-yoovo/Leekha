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

// Audio Context for Web Audio API
let audioContext = null;
let soundEnabled = true;
let musicEnabled = true;

// Preloaded audio files
const cardDealSound = new Audio('sounds/card-deal.mp3');
cardDealSound.volume = 1;
cardDealSound.loop = true; // Loop during dealing

// Initialize audio context on first user interaction
function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}

// Sound generation using Web Audio API
function playTone(frequency, duration, type = 'sine', volume = 0.3) {
    if (!soundEnabled) return;
    try {
        const ctx = initAudioContext();
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
        
        gainNode.gain.setValueAtTime(volume, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
        
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + duration);
    } catch (e) {}
}

// Play noise burst (for paper/card sounds)
function playNoise(duration, volume = 0.2) {
    if (!soundEnabled) return;
    try {
        const ctx = initAudioContext();
        const bufferSize = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }
        
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 2000;
        
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(volume, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
        
        noise.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        noise.start();
        noise.stop(ctx.currentTime + duration);
    } catch (e) {}
}

// Sound effects
function playSound(soundId) {
    if (!soundEnabled) return;
    
    switch(soundId) {
        case 'sound-card-deal':
            cardDealSound.currentTime = 0;
            cardDealSound.play().catch(() => {});
            break;
        case 'sound-card-play':
            playTone(600, 0.08, 'sine', 0.2);
            setTimeout(() => playTone(900, 0.05, 'sine', 0.15), 30);
            break;
        case 'sound-card-flip':
            playTone(400, 0.1, 'triangle', 0.2);
            break;
        case 'sound-trick-win':
            playTone(523, 0.15, 'sine', 0.3);
            setTimeout(() => playTone(659, 0.15, 'sine', 0.3), 100);
            setTimeout(() => playTone(784, 0.2, 'sine', 0.3), 200);
            break;
        case 'sound-round-end':
            playTone(440, 0.2, 'sine', 0.3);
            setTimeout(() => playTone(554, 0.2, 'sine', 0.3), 150);
            setTimeout(() => playTone(659, 0.3, 'sine', 0.3), 300);
            break;
        case 'sound-game-over':
            playTone(784, 0.2, 'sine', 0.3);
            setTimeout(() => playTone(659, 0.2, 'sine', 0.3), 200);
            setTimeout(() => playTone(523, 0.3, 'sine', 0.3), 400);
            setTimeout(() => playTone(392, 0.4, 'sine', 0.3), 600);
            break;
        case 'sound-button':
            playTone(1000, 0.05, 'sine', 0.15);
            break;
    }
}

function toggleSound() {
    soundEnabled = !soundEnabled;
    const btn = document.getElementById('btn-sound');
    btn.classList.toggle('muted', !soundEnabled);
    btn.textContent = soundEnabled ? '🔊' : '🔇';
}

function toggleMusic() {
    musicEnabled = !musicEnabled;
    const btn = document.getElementById('btn-music');
    const bgm = document.getElementById('bgm');
    btn.classList.toggle('muted', !musicEnabled);
    btn.textContent = musicEnabled ? '🎵' : '🎵';
    
    if (musicEnabled && bgm) {
        bgm.volume = 0.3;
        bgm.play().catch(() => {});
    } else if (bgm) {
        bgm.pause();
    }
}

function startBackgroundMusic() {
    if (musicEnabled) {
        const bgm = document.getElementById('bgm');
        if (bgm) {
            bgm.volume = 0.3;
            bgm.play().catch(() => {});
        }
    }
}

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
    hmarLetters: {
        bottom: '',
        left: '',
        top: '',
        right: ''
    },
    currentTrick: [],
    currentPlayer: 'bottom',
    dealerIndex: 0,
    leadSuit: null,
    trickNumber: 0,
    roundNumber: 1,
    passDirection: 'left', // always counterclockwise
    selectedCardsToPass: [],
    receivedCards: [], // cards received from other player, not yet added to hand
    gamePhase: 'passing', // 'passing', 'receiving', 'playing', 'trickComplete', 'roundOver', 'gameOver'
    passedCards: {
        bottom: [],
        left: [],
        top: [],
        right: []
    },
    takenCards: {
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
    gameState.passDirection = 'left'; // always counterclockwise (pass to right player)
    gameState.hands = { bottom: [], left: [], top: [], right: [] };
    
    // Clear all hands display
    renderAllHands();
    updateScores();
    updateStatus('Welcome to Leekha!');
    
    // Show start modal
    showStartModal();
}

function showStartModal() {
    document.getElementById('start-modal').classList.add('active');
}

function hideStartModal() {
    document.getElementById('start-modal').classList.remove('active');
}

async function startGame() {
    hideStartModal();
    playSound('sound-button');
    startBackgroundMusic();
    await startRound();
}

async function startRound() {
    // Reset round state
    gameState.roundScores = { bottom: 0, left: 0, top: 0, right: 0 };
    gameState.trickNumber = 0;
    gameState.currentTrick = [];
    gameState.leadSuit = null;
    gameState.passedCards = { bottom: [], left: [], top: [], right: [] };
    gameState.takenCards = { bottom: [], left: [], top: [], right: [] };
    gameState.selectedCardsToPass = [];
    gameState.receivedCards = [];
    gameState.hands = { bottom: [], left: [], top: [], right: [] };
    
    // Create and shuffle deck
    gameState.deck = shuffleDeck(createDeck());
    
    // Clear hands display
    renderAllHands();
    renderReceivedCards();
    updateTakenCardsStack();
    
    // Deal cards with animation
    gameState.gamePhase = 'dealing';
    updateStatus(`Round ${gameState.roundNumber}: Dealing cards...`);
    
    await dealCardsWithAnimation();
    
    // Sort all hands after dealing
    for (const player of PLAYERS) {
        sortHand(player);
    }
    
    // Start passing phase
    gameState.gamePhase = 'passing';
    updateStatus(`Round ${gameState.roundNumber}: Select 3 cards to pass ${gameState.passDirection}`);
    
    renderAllHands();
    showPassModal();
}

// Deal cards one by one with animation
async function dealCardsWithAnimation() {
    const deckPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const dealOrder = ['bottom', 'left', 'top', 'right'];
    const startPlayerIdx = (gameState.dealerIndex + 1) % 4;
    
    let deckIndex = 0;
    
    // Start deal sound once at the beginning
    if (soundEnabled) {
        cardDealSound.currentTime = 0;
        cardDealSound.play().catch(() => {});
    }
    
    // Deal 13 cards to each player, one at a time rotating between players
    for (let cardNum = 0; cardNum < 13; cardNum++) {
        for (let i = 0; i < 4; i++) {
            const player = dealOrder[(startPlayerIdx + i) % 4];
            const card = gameState.deck[deckIndex++];
            
            // Add card to hand
            gameState.hands[player].push(card);
            
            // Animate card dealing
            const targetPos = getPlayerPosition(player);
            const showFace = player === 'bottom';
            
            // Create animation (don't await, let them overlap slightly)
            animateCardSlide(card, deckPos, targetPos, showFace, 250);
            
            // Render updated hand
            renderPlayerHand(player);
            
            // Wait before next card (80ms = fast dealing feel)
            await new Promise(r => setTimeout(r, 80));
        }
    }
    
    // Stop the deal sound when done
    cardDealSound.pause();
    cardDealSound.currentTime = 0;
    
    // Small delay after all cards dealt
    await new Promise(r => setTimeout(r, 400));
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

async function confirmPass() {
    if (gameState.selectedCardsToPass.length !== 3) return;
    
    playSound('sound-button');
    
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
    
    // Clear selection and hide modal
    gameState.selectedCardsToPass = [];
    hidePassModal();
    
    // Render hands without the passed cards
    renderAllHands();
    
    // Animate all card passing
    gameState.gamePhase = 'animating';
    updateStatus('Passing cards...');
    
    // Create list of all passes to animate
    const passAnimations = [];
    for (const player of PLAYERS) {
        const target = getPassTarget(player, gameState.passDirection);
        passAnimations.push({
            from: player,
            to: target,
            cards: gameState.passedCards[player]
        });
    }
    
    // Animate all passes simultaneously
    await Promise.all(passAnimations.map(pass => 
        animatePassingCards(pass.from, pass.to, pass.cards, 150)
    ));
    
    // Now apply the card exchanges for bots
    for (const player of ['left', 'top', 'right']) {
        const target = getPassTarget(player, gameState.passDirection);
        if (target !== 'bottom') {
            gameState.hands[target].push(...gameState.passedCards[player]);
        }
    }
    
    // Human's cards go to target bot
    const humanTarget = getPassTarget('bottom', gameState.passDirection);
    gameState.hands[humanTarget].push(...gameState.passedCards.bottom);
    
    // Store cards that human will receive (don't add to hand yet)
    const passingToBottom = getPassSource('bottom', gameState.passDirection);
    gameState.receivedCards = gameState.passedCards[passingToBottom].map(card => ({
        card: card,
        revealed: false
    }));
    
    // Sort bot hands
    for (const player of ['left', 'top', 'right']) {
        sortHand(player);
    }
    
    // Enter receiving phase
    gameState.gamePhase = 'receiving';
    updateStatus('Click the cards to reveal and collect them');
    renderAllHands();
    renderReceivedCards();
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
    
    // Check if multiplayer mode - let server handle it
    if (typeof isMultiplayer !== 'undefined' && isMultiplayer && player === 'bottom') {
        if (typeof multiplayerPlayCard === 'function' && multiplayerPlayCard(player, card)) {
            return true;
        }
    }
    
    playSound('sound-card-play');
    
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
        // Next player (counterclockwise)
        const nextIdx = (PLAYERS.indexOf(player) + 3) % 4;
        gameState.currentPlayer = PLAYERS[nextIdx];
        updateStatus(`Trick ${gameState.trickNumber}: ${getPlayerName(gameState.currentPlayer)}'s turn`);
        updateCurrentPlayerIndicator();
        if (gameState.currentPlayer === 'bottom') showYourTurnBanner();
        updateCurrentPlayerInfo();
        renderPlayerHand('bottom'); // Update playable indicators
        
        // If bot's turn, trigger bot play
        if (gameState.currentPlayer !== 'bottom') {
            setTimeout(botPlay, 800);
        }
    }
    
    return true;
}

async function completeTrick() {
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
    
    // Store won cards
    const wonCards = gameState.currentTrick.map(t => t.card);
    gameState.takenCards[winner.player].push(...wonCards);
    
    playSound('sound-trick-win');
    
    updateScores();
    updateCurrentPlayerInfo();
    
    // Animate cards sliding to winner
    updateStatus(`${getPlayerName(winner.player)} wins the trick!`);
    await animateTrickCollection(winner.player);
    
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
        updateCurrentPlayerInfo();
        renderPlayerHand('bottom');
        if (gameState.currentPlayer === 'bottom') showYourTurnBanner();
        
        // If bot's turn, trigger bot play
        if (gameState.currentPlayer !== 'bottom') {
            setTimeout(botPlay, 800);
        }
    }
}

function endRound() {
    gameState.gamePhase = 'roundOver';
    
    playSound('sound-round-end');
    
    // Add round scores to total
    for (const player of PLAYERS) {
        gameState.scores[player] += gameState.roundScores[player];
    }
    
    updateScores();
    
    // Check if someone reached 101+ (they lose this game)
    const maxScore = Math.max(...Object.values(gameState.scores));
    if (maxScore >= WINNING_SCORE) {
        // Find loser (highest score = they lose the game)
        let loser = null;
        let highestScore = -1;
        for (const player of PLAYERS) {
            if (gameState.scores[player] > highestScore) {
                highestScore = gameState.scores[player];
                loser = player;
            }
        }
        
        // Add HMAR letter to loser
        const HMAR = 'HMAR';
        if (loser && gameState.hmarLetters[loser].length < HMAR.length) {
            const nextLetterIdx = gameState.hmarLetters[loser].length;
            gameState.hmarLetters[loser] += HMAR[nextLetterIdx];
        }
        
        // Check if someone completed HMAR (match over)
        const hmarComplete = PLAYERS.find(p => gameState.hmarLetters[p] === 'HMAR');
        if (hmarComplete) {
            endMatch();
        } else {
            // Show game over for this game, then start new game
            showGameOverModal(loser);
        }
    } else {
        // If someone collected the Queen of Spades this round, set next dealer so
        // the next round's first player will be to that player's RIGHT.
        let qosTaker = null;
        for (const player of PLAYERS) {
            if ((gameState.takenCards[player] || []).some(c => isQueenOfSpades(c))) {
                qosTaker = player;
                break;
            }
        }
        if (qosTaker) {
            const qosIdx = PLAYERS.indexOf(qosTaker);
            // Set dealerIndex so that when nextRound() increments it, starter will be to QoS taker's right
            gameState.dealerIndex = (qosIdx + 1) % 4;
        }

        showRoundOverModal();
    }
}

function endMatch() {
    gameState.gamePhase = 'matchOver';
    
    playSound('sound-game-over');
    
    // Find loser (completed HMAR) and winner (least HMAR letters)
    let loser = PLAYERS.find(p => gameState.hmarLetters[p] === 'HMAR');
    let minLetters = 5;
    let winner = null;
    for (const player of PLAYERS) {
        if (gameState.hmarLetters[player].length < minLetters) {
            minLetters = gameState.hmarLetters[player].length;
            winner = player;
        }
    }
    
    showMatchOverModal(loser, winner);
}

function endGame() {
    // Not used - logic is now in endRound and endMatch
}

async function nextRound() {
    playSound('sound-button');
    hideRoundOverModal();
    gameState.roundNumber++;
    gameState.dealerIndex = (gameState.dealerIndex + 1) % 4;
    gameState.passDirection = 'left'; // Always counterclockwise
    await startRound();
}

function nextGame() {
    // Start next game in the match - reset scores but keep HMAR letters
    playSound('sound-button');
    hideGameOverModal();
    gameState.scores = { bottom: 0, left: 0, top: 0, right: 0 };
    gameState.roundNumber = 1;
    gameState.dealerIndex = 0;
    gameState.passDirection = 'left';
    updateScores();
    startGame();
}

function newGame() {
    // Alias for nextGame (for compatibility)
    nextGame();
}

function newMatch() {
    // Start completely new match - reset everything including HMAR
    playSound('sound-button');
    hideGameOverModal();
    gameState.scores = { bottom: 0, left: 0, top: 0, right: 0 };
    gameState.hmarLetters = { bottom: '', left: '', top: '', right: '' };
    gameState.roundNumber = 1;
    gameState.dealerIndex = 0;
    gameState.passDirection = 'left';
    updateScores();
    startGame();
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

// Get player position for animations
function getPlayerPosition(player) {
    const positions = {
        bottom: { x: window.innerWidth / 2, y: window.innerHeight - 80 },
        top: { x: window.innerWidth / 2, y: 120 },
        left: { x: 80, y: window.innerHeight / 2 },
        right: { x: window.innerWidth - 80, y: window.innerHeight / 2 }
    };
    return positions[player];
}

// Get received cards area position
function getReceivedCardsPosition() {
    const area = document.getElementById('received-cards-area');
    if (area && area.style.display !== 'none') {
        const rect = area.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    // Default position based on pass direction
    if (gameState.passDirection === 'right') {
        // Receiving from right player, so position on right side
        return { x: window.innerWidth / 2 + 350, y: window.innerHeight - 80 };
    } else {
        // Receiving from left player, so position on left side
        return { x: window.innerWidth / 2 - 350, y: window.innerHeight - 80 };
    }
}

// Animate a card sliding from one position to another
function animateCardSlide(card, fromPos, toPos, showFace = false, duration = 500) {
    return new Promise(resolve => {
        const layer = document.getElementById('card-animation-layer');
        const wrapper = document.createElement('div');
        wrapper.className = 'sliding-card';
        
        const cardEl = createCardElement(card, showFace);
        wrapper.appendChild(cardEl);
        
        // Start position
        wrapper.style.left = `${fromPos.x - 35}px`;
        wrapper.style.top = `${fromPos.y - 50}px`;
        wrapper.style.opacity = '1';
        
        layer.appendChild(wrapper);
        
        // Force reflow
        wrapper.offsetHeight;
        
        // Animate to end position
        wrapper.style.transitionDuration = `${duration}ms`;
        wrapper.style.left = `${toPos.x - 35}px`;
        wrapper.style.top = `${toPos.y - 50}px`;
        
        setTimeout(() => {
            wrapper.remove();
            resolve();
        }, duration);
    });
}

// Animate multiple cards sliding (for passing)
async function animatePassingCards(fromPlayer, toPlayer, cards, staggerDelay = 200) {
    const fromPos = getPlayerPosition(fromPlayer);
    let toPos;
    
    if (toPlayer === 'bottom') {
        toPos = getReceivedCardsPosition();
    } else {
        toPos = getPlayerPosition(toPlayer);
    }
    
    for (let i = 0; i < cards.length; i++) {
        animateCardSlide(cards[i], fromPos, toPos, false, 400);
        if (i < cards.length - 1) {
            await new Promise(r => setTimeout(r, staggerDelay));
        }
    }
    
    // Wait for last animation to complete
    await new Promise(r => setTimeout(r, 400));
}

// Animate trick collection
async function animateTrickCollection(winnerPlayer) {
    const surface = document.getElementById('table-surface');
    const tableCards = Array.from(surface.querySelectorAll('.table-card'));
    const winnerPos = getPlayerPosition(winnerPlayer);
    
    const promises = [];
    
    tableCards.forEach((tableCard, index) => {
        const rect = tableCard.getBoundingClientRect();
        const playerPos = tableCard.dataset.player;
        
        // Find card data from current trick by matching player position
        let cardData = gameState.currentTrick.find(t => t.player === playerPos);
        
        // Fallback to index-based lookup for backwards compatibility
        if (!cardData && gameState.currentTrick[index]) {
            cardData = gameState.currentTrick[index];
        }
        
        if (cardData) {
            const fromPos = { 
                x: rect.left + rect.width / 2, 
                y: rect.top + rect.height / 2 
            };
            
            promises.push(
                new Promise(resolve => {
                    setTimeout(() => {
                        // Remove the table card from DOM immediately when animation starts
                        tableCard.remove();
                        animateCardSlide(cardData.card, fromPos, winnerPos, true, 500)
                            .then(resolve);
                    }, index * 100);
                })
            );
        } else {
            // If no card data found, just remove the table card
            promises.push(
                new Promise(resolve => {
                    setTimeout(() => {
                        tableCard.remove();
                        resolve();
                    }, index * 100);
                })
            );
        }
    });
    
    await Promise.all(promises);
}

function createCardElement(card, showFace = true) {
    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.cardId = getCardId(card);
    
    if (showFace) {
        const suitClass = `suit-${card.suit}`;
        div.innerHTML = `
            <div class="card-corner card-corner-top ${suitClass}"><span class="card-rank">${card.rank}</span><span class="card-suit">${SUIT_SYMBOLS[card.suit]}</span></div>
            <div class="card-center ${suitClass}">${SUIT_SYMBOLS[card.suit]}</div>
            <div class="card-corner card-corner-bottom ${suitClass}"><span class="card-rank">${card.rank}</span><span class="card-suit">${SUIT_SYMBOLS[card.suit]}</span></div>
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

    // Only spread cards for the active player while playing; otherwise keep default layout.
    const SMALL_HAND_THRESHOLD = 9;
    // Only spread the human player's hand while in the playing phase.
    if (gameState.gamePhase === 'playing' && player === 'bottom' && hand.length > 0 && hand.length <= SMALL_HAND_THRESHOLD) {
        // Wider container for top/bottom when the active player has a small hand
        if (player === 'bottom' || player === 'top') {
            container.style.width = Math.min(window.innerWidth * 0.8, 1000) + 'px';
        } else {
            container.style.width = Math.min(window.innerHeight * 0.5, 300) + 'px';
        }
        container.style.justifyContent = 'space-between';
    } else {
        // Default layout (during dealing/passing or for non-active players)
        container.style.width = 'auto';
        container.style.justifyContent = 'center';
    }
    
    hand.forEach(card => {
        const cardEl = createCardElement(card, isHuman);
        
        if (isHuman) {
            if (gameState.gamePhase === 'passing') {
                // Passing phase
                cardEl.classList.add('selectable');
                const isSelected = gameState.selectedCardsToPass.some(
                    c => getCardId(c) === getCardId(card)
                );
                if (isSelected) {
                    cardEl.classList.add('selected');
                }
                cardEl.addEventListener('click', () => selectCardToPass(card));
            } else if (gameState.gamePhase === 'playing') {
                // Playing phase - check if we already played a card this turn (multiplayer)
                const alreadyPlayed = typeof hasPlayedCard !== 'undefined' && hasPlayedCard;
                const canPlay = canPlayCard(player, card) && !alreadyPlayed;
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

function renderReceivedCards() {
    const container = document.getElementById('received-cards-area');
    // const mobileIndicator = document.getElementById('mobile-received-indicator');
    const mobileCount = document.getElementById('mobile-received-count');
    
    if (!container) return;
    
    container.innerHTML = '';
    container.classList.remove('from-left', 'from-right');
    
    if (gameState.receivedCards.length === 0) {
        container.style.display = 'none';
        // mobileIndicator?.classList.add('hidden');
        return;
    }
    
    container.style.display = 'flex';
    
    // Update mobile indicator
    // if (isMobileDevice() && mobileIndicator && mobileCount) {
    if (isMobileDevice() && mobileCount) {
        // mobileIndicator.classList.remove('hidden');
        mobileCount.textContent = gameState.receivedCards.length;
    }
    
    // Position based on who is passing to us
    if (gameState.passDirection === 'right') {
        // Right player passes to us, so put cards on right
        container.classList.add('from-right');
    } else {
        // Left player passes to us, so put cards on left
        container.classList.add('from-left');
    }
    
    gameState.receivedCards.forEach((item, index) => {
        const cardEl = document.createElement('div');
        cardEl.className = 'received-card';
        // Rotate cards based on which side they're on
        const rotation = gameState.passDirection === 'right' 
            ? -(5 + index * 5)  // Coming from right, rotate left
            : (5 + index * 5);   // Coming from left, rotate right
        cardEl.style.transform = `rotate(${rotation}deg)`;
        cardEl.style.zIndex = index;
        
        if (item.revealed) {
            // Show face
            const suitClass = `suit-${item.card.suit}`;
            cardEl.classList.add('card', 'revealed');
            cardEl.innerHTML = `
                <div class="card-corner card-corner-top ${suitClass}"><span class="card-rank">${item.card.rank}</span><span class="card-suit">${SUIT_SYMBOLS[item.card.suit]}</span></div>
                <div class="card-center ${suitClass}">${SUIT_SYMBOLS[item.card.suit]}</div>
                <div class="card-corner card-corner-bottom ${suitClass}"><span class="card-rank">${item.card.rank}</span><span class="card-suit">${SUIT_SYMBOLS[item.card.suit]}</span></div>
            `;
            cardEl.addEventListener('click', () => collectReceivedCard(index));
        } else {
            // Show back
            cardEl.classList.add('card', 'card-back');
            cardEl.addEventListener('click', () => revealReceivedCard(index));
        }
        
        container.appendChild(cardEl);
    });
}

function revealReceivedCard(index) {
    if (gameState.gamePhase !== 'receiving') return;
    
    playSound('sound-card-flip');
    gameState.receivedCards[index].revealed = true;
    renderReceivedCards();
}

function collectReceivedCard(index) {
    if (gameState.gamePhase !== 'receiving') return;
    
    const item = gameState.receivedCards[index];
    if (!item.revealed) return;
    
    playSound('sound-card-play');
    
    // Add card to hand
    gameState.hands.bottom.push(item.card);
    
    // Remove from received cards
    gameState.receivedCards.splice(index, 1);
    
    // Sort hand and re-render
    sortHand('bottom');
    renderPlayerHand('bottom');
    renderReceivedCards();
    
    // Check if all cards collected
    if (gameState.receivedCards.length === 0) {
        startPlayingPhase();
    }
}

function startPlayingPhase() {
    gameState.gamePhase = 'playing';
    
    // Player to the right of dealer starts
    gameState.currentPlayer = PLAYERS[(gameState.dealerIndex + 1) % 4];
    gameState.trickNumber = 1;
    
    updateStatus(`Trick ${gameState.trickNumber}: ${getPlayerName(gameState.currentPlayer)}'s turn`);
    if (gameState.currentPlayer === 'bottom') showYourTurnBanner();
    renderAllHands();
    updateCurrentPlayerIndicator();
    updateCurrentPlayerInfo();
    
    // If bot starts, trigger bot play
    if (gameState.currentPlayer !== 'bottom') {
        setTimeout(botPlay, 1000);
    }
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
    // 'left' passDirection = counterclockwise = pass to RIGHT player
    const targetSide = gameState.passDirection === 'left' ? 'right' : 'left';
    direction.textContent = `Passing to your ${targetSide}`;
    
    modal.classList.add('active');
    renderPassCardsGrid();
    updatePassModal();
}

function hidePassModal() {
    document.getElementById('pass-modal').classList.remove('active');
}

function renderPassCardsGrid() {
    const grid = document.getElementById('pass-cards-grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    const hand = gameState.hands.bottom;
    hand.forEach(card => {
        const cardEl = createCardElement(card, true);
        
        const isSelected = gameState.selectedCardsToPass.some(
            c => getCardId(c) === getCardId(card)
        );
        
        if (isSelected) {
            cardEl.classList.add('selected');
        }
        
        cardEl.addEventListener('click', () => {
            selectCardToPass(card);
            renderPassCardsGrid();
        });
        
        grid.appendChild(cardEl);
    });
}

function updatePassModal() {
    const container = document.getElementById('selected-cards');
    const btn = document.getElementById('btn-confirm-pass');
    
    container.innerHTML = '';
    gameState.selectedCardsToPass.forEach(card => {
        const cardEl = createCardElement(card, true);
        cardEl.style.cursor = 'pointer';
        // Click to deselect
        cardEl.addEventListener('click', () => {
            selectCardToPass(card);
            renderPassCardsGrid();
        });
        container.appendChild(cardEl);
    });
    
    btn.disabled = gameState.selectedCardsToPass.length !== 3;
}

function showRoundOverModal() {
    const modal = document.getElementById('round-over-modal');
    const scoresDiv = document.getElementById('round-scores');
    
    // Find loser of this round (highest round score)
    let maxRoundScore = -1;
    let loser = null;
    for (const player of PLAYERS) {
        if (gameState.roundScores[player] > maxRoundScore) {
            maxRoundScore = gameState.roundScores[player];
            loser = player;
        }
    }
    
    scoresDiv.innerHTML = PLAYERS.map(player => {
        const hmar = gameState.hmarLetters[player] || '';
        const hmarDisplay = hmar ? ` [${hmar}]` : '';
        const isLoser = player === loser;
        return `
            <div class="score-row ${isLoser ? 'loser' : ''}">
                <span>${getPlayerName(player)}${hmarDisplay}</span>
                <span>+${gameState.roundScores[player]} (Total: ${gameState.scores[player]})</span>
            </div>
        `;
    }).join('');
    
    modal.classList.add('active');
}

function hideRoundOverModal() {
    document.getElementById('round-over-modal').classList.remove('active');
}

function showGameOverModal(loser) {
    // Called when someone reaches 101+ but HMAR is not yet complete
    const modal = document.getElementById('game-over-modal');
    const title = document.getElementById('game-over-title');
    const scoresDiv = document.getElementById('final-scores');
    const newGameBtn = document.getElementById('btn-new-game');
    
    const loserName = getPlayerName(loser);
    const loserHmar = gameState.hmarLetters[loser];
    
    title.textContent = `${loserName} lost this game! [${loserHmar}]`;
    
    scoresDiv.innerHTML = PLAYERS.map(player => {
        const hmar = gameState.hmarLetters[player] || '';
        const hmarDisplay = hmar ? ` [${hmar}]` : '';
        const isLoser = player === loser;
        return `
            <div class="score-row ${isLoser ? 'loser' : ''}">
                <span>${getPlayerName(player)}${hmarDisplay}</span>
                <span>${gameState.scores[player]} points</span>
            </div>
        `;
    }).join('');
    
    // Change button text to "Next Game"
    if (newGameBtn) {
        newGameBtn.textContent = 'Next Game';
        newGameBtn.onclick = nextGame;
    }
    
    modal.classList.add('active');
}

function showMatchOverModal(loser, winner) {
    // Called when someone completes HMAR (4 letters)
    const modal = document.getElementById('game-over-modal');
    const title = document.getElementById('game-over-title');
    const scoresDiv = document.getElementById('final-scores');
    const newGameBtn = document.getElementById('btn-new-game');
    
    title.textContent = `${getPlayerName(loser)} is HMAR!`;
    
    scoresDiv.innerHTML = PLAYERS.map(player => {
        const hmar = gameState.hmarLetters[player] || '';
        const hmarDisplay = hmar ? ` [${hmar}]` : '';
        const isLoser = player === loser;
        const isWinner = player === winner;
        return `
            <div class="score-row ${isLoser ? 'loser' : ''} ${isWinner ? 'winner' : ''}">
                <span>${getPlayerName(player)}${hmarDisplay}</span>
                <span>${isWinner ? '🏆 WINNER' : ''}</span>
            </div>
        `;
    }).join('');
    
    // Change button text to "New Match"
    if (newGameBtn) {
        newGameBtn.textContent = 'New Match';
        newGameBtn.onclick = newMatch;
    }
    
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

function updateCurrentPlayerInfo() {
    const player = gameState.currentPlayer;
    const container = document.getElementById('current-player-info');
    if (!container) return;
    
    const playerName = getPlayerName(player);
    const roundScore = gameState.roundScores[player];
    
    // Update player name and score
    container.querySelector('.info-player-name').textContent = playerName;
    container.querySelector('.info-round-score').textContent = roundScore;
    
    // Update your taken cards stack
    updateTakenCardsStack();
}

// Show a transient "Your turn" banner for the human player
let _yourTurnTimers = { removeVisible: null, hide: null };
function showYourTurnBanner() {
    const el = document.getElementById('your-turn-banner');
    if (!el) return;
    // Clear previous timers
    if (_yourTurnTimers.removeVisible) clearTimeout(_yourTurnTimers.removeVisible);
    if (_yourTurnTimers.hide) clearTimeout(_yourTurnTimers.hide);

    el.classList.remove('hidden');
    // Force reflow to allow transition
    void el.offsetWidth;
    el.classList.add('visible');

    // Remove visible class after 1200ms (fade out)
    _yourTurnTimers.removeVisible = setTimeout(() => {
        el.classList.remove('visible');
    }, 1200);

    // Hide element after transition completes
    _yourTurnTimers.hide = setTimeout(() => {
        el.classList.add('hidden');
    }, 1600);
}

function updateTakenCardsStack() {
    const takenCards = gameState.takenCards.bottom;
    const stackContainer = document.getElementById('stack-cards');
    const countEl = document.getElementById('taken-count');
    
    if (!stackContainer || !countEl) return;
    
    countEl.textContent = takenCards.length;
    stackContainer.innerHTML = '';
    
    // Show up to 5 stacked cards
    const stackCount = Math.min(Math.ceil(takenCards.length / 4), 5);
    for (let i = 0; i < stackCount; i++) {
        const cardEl = document.createElement('div');
        cardEl.className = 'stack-card';
        cardEl.style.top = `${-i * 3}px`;
        cardEl.style.left = `${i * 2}px`;
        stackContainer.appendChild(cardEl);
    }
}

function showTakenCardsModal() {
    const modal = document.getElementById('taken-cards-modal');
    const grid = document.getElementById('taken-cards-grid');
    const takenCards = gameState.takenCards.bottom;
    
    grid.innerHTML = '';
    
    if (takenCards.length === 0) {
        grid.innerHTML = '<p style="color: #888;">No cards taken yet</p>';
    } else {
        takenCards.forEach(card => {
            const cardEl = createCardElement(card, true);
            grid.appendChild(cardEl);
        });
    }
    
    modal.classList.add('active');
}

function hideTakenCardsModal() {
    document.getElementById('taken-cards-modal').classList.remove('active');
}

function getPlayerName(player) {
    // Use multiplayer names if in multiplayer mode
    if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof getMultiplayerPlayerName === 'function') {
        return getMultiplayerPlayerName(player);
    }
    const names = {
        bottom: 'You',
        left: 'Bot 1',
        top: 'Bot 2',
        right: 'Bot 3'
    };
    return names[player];
}

// =====================
// Mobile Card Picker
// =====================

function isMobileDevice() {
    return window.innerWidth <= 768;
}

function showMobileCardPicker() {
    if (!isMobileDevice()) return;
    
    const picker = document.getElementById('mobile-card-picker');
    const selectBtn = document.getElementById('mobile-select-btn');
    const passDir = document.getElementById('mobile-pass-direction');
    
    selectBtn?.classList.add('hidden');
    passDir?.classList.add('hidden');
    picker?.classList.add('active');
    document.body.classList.add('mobile-passing-phase');
    
    renderMobileCardCarousel();
}

function hideMobileCardPicker() {
    const picker = document.getElementById('mobile-card-picker');
    const selectBtn = document.getElementById('mobile-select-btn');
    const passDir = document.getElementById('mobile-pass-direction');
    const preview = document.getElementById('mobile-selection-preview');
    
    picker?.classList.remove('active');
    selectBtn?.classList.add('hidden');
    passDir?.classList.add('hidden');
    preview?.classList.add('hidden');
    document.body.classList.remove('mobile-passing-phase');
}

function showMobilePassingUI() {
    if (!isMobileDevice() || gameState.gamePhase !== 'passing') return;
    
    const selectBtn = document.getElementById('mobile-select-btn');
    const passDir = document.getElementById('mobile-pass-direction');
    
    if (selectBtn) {
        selectBtn.classList.remove('hidden');
        selectBtn.textContent = `📤 Select Cards to Pass`;
    }
    
    if (passDir) {
        passDir.classList.remove('hidden');
        // 'left' passDirection = counterclockwise = pass to RIGHT player
        passDir.textContent = `Passing to: ${gameState.passDirection === 'left' ? 'Right →' : '← Left'}`;
    }
    
    updateMobileSelectionPreview();
}

function renderMobileCardCarousel() {
    const carousel = document.getElementById('mobile-card-carousel');
    if (!carousel) return;
    
    carousel.innerHTML = '';
    
    const hand = gameState.hands.bottom;
    hand.forEach(card => {
        const cardEl = createCardElement(card, true);
        
        const isSelected = gameState.selectedCardsToPass.some(
            c => getCardId(c) === getCardId(card)
        );
        
        if (isSelected) {
            cardEl.classList.add('selected');
        }
        
        cardEl.addEventListener('click', () => {
            mobileSelectCard(card);
        });
        
        carousel.appendChild(cardEl);
    });
    
    updateMobilePickerUI();
}

function mobileSelectCard(card) {
    const cardId = getCardId(card);
    const idx = gameState.selectedCardsToPass.findIndex(c => getCardId(c) === cardId);
    
    if (idx >= 0) {
        gameState.selectedCardsToPass.splice(idx, 1);
    } else if (gameState.selectedCardsToPass.length < 3) {
        gameState.selectedCardsToPass.push(card);
    }
    
    renderMobileCardCarousel();
    renderPlayerHand('bottom');
    updateMobileSelectionPreview();
    
    // Also update the regular pass modal in case it's visible
    updatePassModal();
}

function updateMobilePickerUI() {
    const countEl = document.getElementById('mobile-picker-count');
    const confirmBtn = document.getElementById('btn-picker-confirm');
    
    if (countEl) {
        countEl.textContent = `${gameState.selectedCardsToPass.length} / 3`;
    }
    
    if (confirmBtn) {
        confirmBtn.disabled = gameState.selectedCardsToPass.length !== 3;
    }
}

function updateMobileSelectionPreview() {
    const preview = document.getElementById('mobile-selection-preview');
    if (!preview) return;
    
    if (gameState.selectedCardsToPass.length === 0) {
        preview.classList.add('hidden');
        return;
    }
    
    preview.classList.remove('hidden');
    preview.innerHTML = '';
    
    gameState.selectedCardsToPass.forEach(card => {
        const cardEl = createCardElement(card, true);
        preview.appendChild(cardEl);
    });
}

function clearMobileSelection() {
    gameState.selectedCardsToPass = [];
    renderMobileCardCarousel();
    renderPlayerHand('bottom');
    updateMobileSelectionPreview();
    updatePassModal();
}

function confirmMobilePass() {
    if (gameState.selectedCardsToPass.length !== 3) return;
    
    hideMobileCardPicker();
    
    // Use multiplayer or solo confirm based on mode
    if (typeof isMultiplayer !== 'undefined' && isMultiplayer) {
        if (typeof multiplayerConfirmPass === 'function') {
            multiplayerConfirmPass();
            return;
        }
    }
    confirmPass();
}

// Setup mobile picker event listeners
function setupMobileCardPicker() {
    const selectBtn = document.getElementById('mobile-select-btn');
    const clearBtn = document.getElementById('btn-picker-clear');
    const confirmBtn = document.getElementById('btn-picker-confirm');
    // const receivedIndicator = document.getElementById('mobile-received-indicator');
    
    selectBtn?.addEventListener('click', showMobileCardPicker);
    clearBtn?.addEventListener('click', clearMobileSelection);
    confirmBtn?.addEventListener('click', confirmMobilePass);
    
    // Mobile received cards indicator - scroll to received cards area
    // receivedIndicator?.addEventListener('click', () => {
    //     const receivedArea = document.getElementById('received-cards-area');
    //     if (receivedArea) {
    //         receivedArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
    //     }
    // });
    
    // Close picker when clicking outside (on background)
    document.getElementById('mobile-card-picker')?.addEventListener('click', (e) => {
        if (e.target.id === 'mobile-card-picker') {
            // Don't close, but could add a minimize option
        }
    });
}

// =====================
// Event Listeners
// =====================

document.addEventListener('DOMContentLoaded', () => {
    setupTableDrop();
    setupMobileCardPicker();
    
    document.getElementById('btn-confirm-pass').addEventListener('click', () => {
        // Check if multiplayer mode
        if (typeof isMultiplayer !== 'undefined' && isMultiplayer) {
            if (typeof multiplayerConfirmPass === 'function') {
                multiplayerConfirmPass();
                return;
            }
        }
        confirmPass();
    });
    document.getElementById('btn-next-round').addEventListener('click', () => {
        // In multiplayer mode, let multiplayer.js handle this via onclick
        if (typeof isMultiplayer !== 'undefined' && isMultiplayer) {
            return;
        }
        nextRound();
    });
    document.getElementById('btn-new-game').addEventListener('click', () => {
        // In multiplayer mode, let multiplayer.js handle this via onclick
        if (typeof isMultiplayer !== 'undefined' && isMultiplayer) {
            return;
        }
        newGame();
    });
    // btn-start-game is now handled by multiplayer.js mode selection
    document.getElementById('taken-cards-stack').addEventListener('click', showTakenCardsModal);
    document.getElementById('btn-close-taken').addEventListener('click', hideTakenCardsModal);
    document.getElementById('btn-sound').addEventListener('click', toggleSound);
    document.getElementById('btn-music').addEventListener('click', toggleMusic);
    
    // initGame is called but doesn't auto-start - waits for mode selection
    initGame();
});
