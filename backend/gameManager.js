// Game constants
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const POSITIONS = ['bottom', 'left', 'top', 'right'];
const WINNING_SCORE = 101;

class GameState {
    constructor(roomId, players) {
        this.roomId = roomId;
        this.players = players; // Map: playerId -> { username, position }
        this.deck = [];
        this.hands = {}; // position -> cards[]
        this.scores = {}; // position -> total score
        this.roundScores = {}; // position -> round score
        this.takenCards = {}; // position -> cards[]
        this.currentTrick = []; // { position, card }[]
        this.currentPlayer = null; // position
        this.leadSuit = null;
        this.trickNumber = 0;
        this.roundNumber = 1;
        this.dealerIndex = 0;
        this.passDirection = 'right';
        this.passedCards = {}; // position -> cards[]
        this.receivedCards = {}; // position -> cards[]
        this.collectedCards = {}; // position -> true/false (has player collected all cards?)
        this.readyForNextRound = {}; // position -> true/false (has player clicked next round?)
        this.hmarLetters = {}; // position -> string (accumulated HMAR letters)
        this.phase = 'waiting'; // 'waiting', 'passing', 'collecting', 'playing', 'trickComplete', 'roundOver', 'gameOver'
        
        // Initialize scores and hands for each position
        for (const pos of POSITIONS) {
            this.scores[pos] = 0;
            this.roundScores[pos] = 0;
            this.hands[pos] = [];
            this.takenCards[pos] = [];
            this.passedCards[pos] = [];
            this.receivedCards[pos] = [];
            this.collectedCards[pos] = false;
            this.readyForNextRound[pos] = false;
            this.hmarLetters[pos] = '';
        }
    }

    // Get player ID by position
    getPlayerIdByPosition(position) {
        for (const [id, data] of this.players) {
            if (data.position === position) return id;
        }
        return null;
    }

    // Get position by player ID
    getPositionByPlayerId(playerId) {
        const player = this.players.get(playerId);
        return player ? player.position : null;
    }
}

class GameManager {
    constructor(io, roomManager) {
        this.io = io;
        this.roomManager = roomManager;
        this.games = new Map(); // roomId -> GameState
    }

    // Check if a position is controlled by a bot
    isBot(game, position) {
        const playerId = game.getPlayerIdByPosition(position);
        return playerId && playerId.startsWith('bot-');
    }

    // Get all bot positions for a game
    getBotPositions(game) {
        return POSITIONS.filter(pos => this.isBot(game, pos));
    }

    // Schedule bot actions with a delay for realism
    scheduleBotAction(callback, delay = 1000) {
        setTimeout(callback, delay);
    }

    // Create and shuffle deck
    createDeck() {
        const deck = [];
        for (const suit of SUITS) {
            for (const rank of RANKS) {
                deck.push({ suit, rank });
            }
        }
        return this.shuffleDeck(deck);
    }

    shuffleDeck(deck) {
        const shuffled = [...deck];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    // Card utilities
    getCardId(card) {
        return `${card.rank}-${card.suit}`;
    }

    parseCardId(cardId) {
        const [rank, suit] = cardId.split('-');
        return { rank, suit };
    }

    getCardValue(rank) {
        const values = {
            '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
            '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
        };
        return values[rank];
    }

    isQueenOfSpades(card) {
        return card.rank === 'Q' && card.suit === 'spades';
    }

    isTenOfDiamonds(card) {
        return card.rank === '10' && card.suit === 'diamonds';
    }

    isHeart(card) {
        return card.suit === 'hearts';
    }

    calculateTrickPoints(trick) {
        let points = 0;
        for (const { card } of trick) {
            if (this.isQueenOfSpades(card)) points += 13;
            if (this.isTenOfDiamonds(card)) points += 10;
            if (this.isHeart(card)) points += 1;
        }
        return points;
    }

    // Bot AI: Select 3 cards to pass
    botSelectCardsToPass(game, position) {
        const hand = [...game.hands[position]];
        
        // Sort by "danger" - try to pass high cards and penalty cards
        const cardValue = (card) => {
            let value = this.getCardValue(card.rank);
            if (this.isQueenOfSpades(card)) value += 20;
            if (this.isTenOfDiamonds(card)) value += 15;
            if (this.isHeart(card)) value += 5;
            return value;
        };
        
        hand.sort((a, b) => cardValue(b) - cardValue(a));
        return hand.slice(0, 3);
    }

    // Bot AI: Select a card to play
    botSelectCardToPlay(game, position) {
        const hand = game.hands[position];
        const playable = this.getPlayableCards(game, position);
        
        if (playable.length === 0) return null;
        if (playable.length === 1) return playable[0];
        
        // If leading, play low non-penalty card
        if (game.currentTrick.length === 0) {
            return this.botSelectLeadCard(playable);
        } else {
            return this.botSelectFollowCard(game, playable);
        }
    }

    botSelectLeadCard(playable) {
        // Prefer non-penalty cards, then lowest value
        const nonPenalty = playable.filter(c => 
            !this.isQueenOfSpades(c) && !this.isTenOfDiamonds(c) && !this.isHeart(c)
        );
        
        const choices = nonPenalty.length > 0 ? nonPenalty : playable;
        choices.sort((a, b) => this.getCardValue(a.rank) - this.getCardValue(b.rank));
        return choices[0];
    }

    botSelectFollowCard(game, playable) {
        const leadSuit = game.leadSuit;
        const hasLeadSuit = playable.some(c => c.suit === leadSuit);
        
        if (hasLeadSuit) {
            // Try to play under the highest card to avoid taking the trick
            const leadCards = playable.filter(c => c.suit === leadSuit);
            const currentHighest = this.findHighestInTrick(game.currentTrick, leadSuit);
            
            const safe = leadCards.filter(c => this.getCardValue(c.rank) < currentHighest);
            if (safe.length > 0) {
                safe.sort((a, b) => this.getCardValue(b.rank) - this.getCardValue(a.rank));
                return safe[0]; // Highest safe card
            }
            
            // Must give up and play high
            leadCards.sort((a, b) => this.getCardValue(a.rank) - this.getCardValue(b.rank));
            return leadCards[0]; // Lowest card we have
        } else {
            // Can't follow - dump penalty cards if possible
            const penalties = playable.filter(c => 
                this.isQueenOfSpades(c) || this.isTenOfDiamonds(c) || this.isHeart(c)
            );
            
            if (penalties.length > 0) {
                // Prefer Q of spades, then 10 of diamonds, then hearts
                const qos = penalties.find(c => this.isQueenOfSpades(c));
                if (qos) return qos;
                
                const tod = penalties.find(c => this.isTenOfDiamonds(c));
                if (tod) return tod;
                
                // Highest heart
                const hearts = penalties.filter(c => this.isHeart(c));
                hearts.sort((a, b) => this.getCardValue(b.rank) - this.getCardValue(a.rank));
                return hearts[0];
            }
            
            // Dump highest card
            playable.sort((a, b) => this.getCardValue(b.rank) - this.getCardValue(a.rank));
            return playable[0];
        }
    }

    findHighestInTrick(trick, leadSuit) {
        let highest = 0;
        for (const { card } of trick) {
            if (card.suit === leadSuit) {
                const value = this.getCardValue(card.rank);
                if (value > highest) highest = value;
            }
        }
        return highest;
    }

    getPlayableCards(game, position) {
        const hand = game.hands[position];
        if (!game.leadSuit) return [...hand];
        
        const hasLeadSuit = hand.some(c => c.suit === game.leadSuit);
        if (hasLeadSuit) {
            return hand.filter(c => c.suit === game.leadSuit);
        }
        return [...hand];
    }

    // Execute bot pass for a position
    executeBotPass(roomId, position) {
        const game = this.games.get(roomId);
        if (!game || game.phase !== 'passing') return;
        
        const cardsToPass = this.botSelectCardsToPass(game, position);
        const cardIds = cardsToPass.map(c => this.getCardId(c));
        const playerId = game.getPlayerIdByPosition(position);
        
        // Use the same logic as human pass
        this.handlePassCardsInternal(roomId, position, cardIds);
    }

    // Execute bot play for current position
    executeBotPlay(roomId) {
        const game = this.games.get(roomId);
        if (!game || game.phase !== 'playing') return;
        
        const position = game.currentPlayer;
        if (!this.isBot(game, position)) return;
        
        const card = this.botSelectCardToPlay(game, position);
        if (!card) return;
        
        const cardId = this.getCardId(card);
        this.handlePlayCardInternal(roomId, position, cardId);
    }

    // Check and trigger bot play if needed
    checkBotTurn(roomId) {
        const game = this.games.get(roomId);
        if (!game || game.phase !== 'playing') return;
        
        if (this.isBot(game, game.currentPlayer)) {
            this.scheduleBotAction(() => this.executeBotPlay(roomId), 800 + Math.random() * 700);
        }
    }

    // Auto-collect cards for bots
    botCollectCards(roomId, position) {
        const game = this.games.get(roomId);
        if (!game) return;
        
        game.collectedCards[position] = true;
    }

    // Auto-ready for next round/game for bots
    botReadyForNextRound(roomId) {
        const game = this.games.get(roomId);
        if (!game) return;
        
        for (const pos of POSITIONS) {
            if (this.isBot(game, pos)) {
                game.readyForNextRound[pos] = true;
            }
        }
    }

    // Start a new game
    startGame(roomId) {
        const room = this.roomManager.getRoom(roomId);
        if (!room) return;

        room.gameInProgress = true;

        // Create game state
        const game = new GameState(roomId, room.players);
        this.games.set(roomId, game);

        // Start first round
        this.startRound(roomId);
    }

    startRound(roomId) {
        const game = this.games.get(roomId);
        if (!game) return;

        // Reset round state
        for (const pos of POSITIONS) {
            game.roundScores[pos] = 0;
            game.hands[pos] = [];
            game.takenCards[pos] = [];
            game.passedCards[pos] = [];
            game.receivedCards[pos] = [];
            game.collectedCards[pos] = false;
        }
        game.currentTrick = [];
        game.leadSuit = null;
        game.trickNumber = 0;

        // Create and deal cards
        game.deck = this.createDeck();
        this.dealCards(game);

        // Set phase to passing
        game.phase = 'passing';

        // Notify all players
        this.broadcastGameState(roomId, 'roundStarted');
        
        // Schedule bot passes
        for (const pos of POSITIONS) {
            if (this.isBot(game, pos)) {
                // Bots auto-collect since they'll receive cards
                game.collectedCards[pos] = true;
                // Schedule bot pass with varying delays
                const delay = 1000 + Math.random() * 1500;
                this.scheduleBotAction(() => this.executeBotPass(roomId, pos), delay);
            }
        }
    }

    dealCards(game) {
        let cardIndex = 0;
        const startIdx = (game.dealerIndex + 1) % 4;

        // Deal 13 cards to each player
        for (let i = 0; i < 13; i++) {
            for (let j = 0; j < 4; j++) {
                const position = POSITIONS[(startIdx + j) % 4];
                game.hands[position].push(game.deck[cardIndex++]);
            }
        }

        // Sort all hands
        for (const pos of POSITIONS) {
            this.sortHand(game.hands[pos]);
        }
    }

    sortHand(hand) {
        hand.sort((a, b) => {
            const suitOrder = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };
            if (suitOrder[a.suit] !== suitOrder[b.suit]) {
                return suitOrder[a.suit] - suitOrder[b.suit];
            }
            return this.getCardValue(a.rank) - this.getCardValue(b.rank);
        });
    }

    // Handle card passing (from human player)
    handlePassCards(roomId, playerId, cardIds) {
        const game = this.games.get(roomId);
        if (!game || game.phase !== 'passing') return;

        const position = game.getPositionByPlayerId(playerId);
        if (!position) return;

        if (cardIds.length !== 3) {
            this.emitToPlayer(roomId, playerId, 'error', { message: 'Must pass exactly 3 cards' });
            return;
        }

        this.handlePassCardsInternal(roomId, position, cardIds);
    }

    // Internal pass cards logic (works for both humans and bots)
    handlePassCardsInternal(roomId, position, cardIds) {
        const game = this.games.get(roomId);
        if (!game || game.phase !== 'passing') return;
        
        const playerId = game.getPlayerIdByPosition(position);
        const isBot = this.isBot(game, position);

        // Find and remove cards from hand
        const cardsToPass = [];
        for (const cardId of cardIds) {
            const idx = game.hands[position].findIndex(c => this.getCardId(c) === cardId);
            if (idx === -1) {
                if (!isBot) {
                    this.emitToPlayer(roomId, playerId, 'error', { message: 'Invalid card selection' });
                }
                return;
            }
            cardsToPass.push(game.hands[position][idx]);
        }

        // Remove cards from hand
        for (const card of cardsToPass) {
            const idx = game.hands[position].findIndex(c => this.getCardId(c) === this.getCardId(card));
            game.hands[position].splice(idx, 1);
        }

        // Store passed cards
        game.passedCards[position] = cardsToPass;

        // Notify player that their pass was confirmed (only for humans)
        if (!isBot) {
            this.emitToPlayer(roomId, playerId, 'cardsPassedConfirmed', { cards: cardsToPass });
        }

        // Notify the receiving player that cards are coming to them (only if they're human)
        const targetPosition = this.getPassTarget(position, game.passDirection);
        const targetPlayerId = game.getPlayerIdByPosition(targetPosition);
        const targetIsBot = this.isBot(game, targetPosition);
        
        if (!targetIsBot) {
            // Calculate relative position of sender from receiver's perspective
            const positionOrder = ['bottom', 'left', 'top', 'right'];
            const senderIdx = positionOrder.indexOf(position);
            const receiverIdx = positionOrder.indexOf(targetPosition);
            const relativeSenderPos = positionOrder[(senderIdx - receiverIdx + 4) % 4];
            
            this.io.to(targetPlayerId).emit('cardsIncoming', {
                targetPlayer: targetPlayerId,
                fromPosition: relativeSenderPos,
                cards: cardsToPass,
                senderHasPassed: true
            });
        }

        // Check if all players have passed
        const allPassed = POSITIONS.every(pos => game.passedCards[pos].length === 3);
        if (allPassed) {
            this.executeCardPass(roomId);
        }
    }

    executeCardPass(roomId) {
        const game = this.games.get(roomId);
        if (!game) return;

        // Exchange cards based on pass direction
        for (const pos of POSITIONS) {
            const targetPos = this.getPassTarget(pos, game.passDirection);
            game.receivedCards[targetPos] = [...game.passedCards[pos]];
            // Don't reset collectedCards - players may have already collected during passing phase
        }

        // Move to collecting phase - players must collect their cards before playing starts
        game.phase = 'collecting';
        
        // Check if all players have already collected (they may have collected during passing phase)
        const allCollected = POSITIONS.every(pos => game.collectedCards[pos]);
        if (allCollected) {
            console.log('All players already collected cards, finalizing immediately');
            this.finalizeCardExchange(roomId);
            return;
        }
        
        // Notify players that collection phase has started
        this.broadcastGameState(roomId, 'collectingStarted');
    }

    // Handle when a player has collected all their received cards
    handleCardsCollected(roomId, playerId) {
        const game = this.games.get(roomId);
        if (!game) return;
        
        // Allow collection during both passing (early) and collecting phases
        if (game.phase !== 'collecting' && game.phase !== 'passing') return;

        const position = game.getPositionByPlayerId(playerId);
        if (!position) return;

        console.log(`Player ${position} collected cards (phase: ${game.phase})`);

        // Mark this player as having collected
        game.collectedCards[position] = true;

        // Only check if all collected when we're in collecting phase
        if (game.phase === 'collecting') {
            const allCollected = POSITIONS.every(pos => game.collectedCards[pos]);
            if (allCollected) {
                this.finalizeCardExchange(roomId);
            }
        }
    }

    finalizeCardExchange(roomId) {
        const game = this.games.get(roomId);
        if (!game) return;

        // Add received cards to hands (for any cards not already collected client-side)
        for (const pos of POSITIONS) {
            game.hands[pos].push(...game.receivedCards[pos]);
            this.sortHand(game.hands[pos]);
        }

        // Move to playing phase
        game.phase = 'playing';
        game.trickNumber = 1;
        game.currentPlayer = POSITIONS[(game.dealerIndex + 1) % 4];

        // Broadcast the exchange complete
        this.broadcastGameState(roomId, 'cardsExchanged');
        
        // Check if first player is a bot
        this.checkBotTurn(roomId);
    }

    getPassTarget(position, direction) {
        const idx = POSITIONS.indexOf(position);
        if (direction === 'right') {
            return POSITIONS[(idx + 1) % 4];
        } else {
            return POSITIONS[(idx + 3) % 4];
        }
    }

    // Handle playing a card (from human player)
    handlePlayCard(roomId, playerId, cardId) {
        const game = this.games.get(roomId);
        if (!game || game.phase !== 'playing') return;

        const position = game.getPositionByPlayerId(playerId);
        if (!position || position !== game.currentPlayer) {
            this.emitToPlayer(roomId, playerId, 'error', { message: 'Not your turn' });
            return;
        }

        this.handlePlayCardInternal(roomId, position, cardId);
    }

    // Internal play card logic (works for both humans and bots)
    handlePlayCardInternal(roomId, position, cardId) {
        const game = this.games.get(roomId);
        if (!game || game.phase !== 'playing') return;
        if (position !== game.currentPlayer) return;
        
        const playerId = game.getPlayerIdByPosition(position);
        const isBot = this.isBot(game, position);

        // Find card in hand
        const card = this.parseCardId(cardId);
        const cardIdx = game.hands[position].findIndex(c => 
            c.rank === card.rank && c.suit === card.suit
        );

        if (cardIdx === -1) {
            if (!isBot) {
                this.emitToPlayer(roomId, playerId, 'error', { message: 'Card not in hand' });
            }
            return;
        }

        const fullCard = game.hands[position][cardIdx];

        // Validate play
        if (!this.canPlayCard(game, position, fullCard)) {
            if (!isBot) {
                this.emitToPlayer(roomId, playerId, 'error', { message: 'Invalid card play' });
            }
            return;
        }

        // Remove card from hand
        game.hands[position].splice(cardIdx, 1);

        // Set lead suit if first card
        if (game.currentTrick.length === 0) {
            game.leadSuit = fullCard.suit;
        }

        // Add to trick
        game.currentTrick.push({ position, card: fullCard });

        // Broadcast the play to each player with relative positions
        this.broadcastCardPlayed(roomId, position, fullCard);

        // Check if trick is complete
        if (game.currentTrick.length === 4) {
            setTimeout(() => this.completeTrick(roomId), 1500);
        } else {
            // Next player
            const nextIdx = (POSITIONS.indexOf(position) + 1) % 4;
            game.currentPlayer = POSITIONS[nextIdx];
            this.broadcastGameState(roomId, 'turnChanged');
            
            // Check if next player is a bot
            this.checkBotTurn(roomId);
        }
    }

    canPlayCard(game, position, card) {
        const hand = game.hands[position];

        // If no lead suit, any card is valid
        if (!game.leadSuit) return true;

        // Check if player has cards of lead suit
        const hasLeadSuit = hand.some(c => c.suit === game.leadSuit);

        if (hasLeadSuit) {
            return card.suit === game.leadSuit;
        } else {
            // Leekha rule: must play QoS or 10oD if can't follow suit
            const hasQoS = hand.some(c => this.isQueenOfSpades(c));
            const has10oD = hand.some(c => this.isTenOfDiamonds(c));

            if (hasQoS || has10oD) {
                return this.isQueenOfSpades(card) || this.isTenOfDiamonds(card);
            }

            return true;
        }
    }

    completeTrick(roomId) {
        const game = this.games.get(roomId);
        if (!game) return;

        // Find winner
        let winner = game.currentTrick[0];
        for (let i = 1; i < game.currentTrick.length; i++) {
            const current = game.currentTrick[i];
            if (this.compareCards(current.card, winner.card, game.leadSuit) > 0) {
                winner = current;
            }
        }

        // Calculate points
        const points = this.calculateTrickPoints(game.currentTrick);
        game.roundScores[winner.position] += points;

        // Store won cards
        const wonCards = game.currentTrick.map(t => t.card);
        game.takenCards[winner.position].push(...wonCards);

        // Broadcast trick result to each player with relative winner position
        this.broadcastTrickComplete(roomId, winner.position, points, wonCards);

        // Clear trick
        game.currentTrick = [];
        game.leadSuit = null;

        // Check if round is over
        if (game.hands[POSITIONS[0]].length === 0) {
            setTimeout(() => this.endRound(roomId), 2000);
        } else {
            // Start next trick after delay for animation
            setTimeout(() => {
                game.trickNumber++;
                game.currentPlayer = winner.position;
                this.broadcastGameState(roomId, 'newTrick');
                
                // Check if trick winner is a bot
                this.checkBotTurn(roomId);
            }, 1500);
        }
    }

    compareCards(card1, card2, leadSuit) {
        if (card1.suit === leadSuit && card2.suit !== leadSuit) return 1;
        if (card2.suit === leadSuit && card1.suit !== leadSuit) return -1;
        if (card1.suit === card2.suit) {
            return this.getCardValue(card1.rank) - this.getCardValue(card2.rank);
        }
        return 0;
    }

    endRound(roomId) {
        const game = this.games.get(roomId);
        if (!game) return;

        // Add round scores to total
        for (const pos of POSITIONS) {
            game.scores[pos] += game.roundScores[pos];
        }

        // Check if anyone reached 101+ (game over)
        const maxScore = Math.max(...POSITIONS.map(pos => game.scores[pos]));
        
        if (maxScore >= WINNING_SCORE) {
            // Find loser (first player to reach 101+)
            const loserPosition = POSITIONS.find(pos => game.scores[pos] >= WINNING_SCORE);
            
            // Add HMAR letter to loser
            const HMAR = 'HMAR';
            if (loserPosition && game.hmarLetters[loserPosition].length < HMAR.length) {
                const nextLetterIdx = game.hmarLetters[loserPosition].length;
                game.hmarLetters[loserPosition] += HMAR[nextLetterIdx];
            }
            
            // Check if HMAR is complete (match over)
            if (game.hmarLetters[loserPosition] === 'HMAR') {
                this.endMatch(roomId);
            } else {
                // Game over but match continues
                this.showGameOver(roomId, loserPosition);
            }
        } else {
            // Regular round over - no one reached 101 yet
            game.phase = 'roundOver';
            this.broadcastRoundOver(roomId, null);
            
            // Auto-ready bots for next round
            this.botReadyForNextRound(roomId);
            this.checkAllReadyForNextRound(roomId);
        }
    }
    
    broadcastRoundOver(roomId, loserPosition) {
        const game = this.games.get(roomId);
        if (!game) return;

        // Broadcast round results to each player with relative positions
        const positionOrder = ['bottom', 'left', 'top', 'right'];
        const loserActualIdx = loserPosition ? positionOrder.indexOf(loserPosition) : -1;
        
        for (const [playerId, playerData] of game.players) {
            // Skip bots
            if (playerId.startsWith('bot-')) continue;
            
            const myPosition = game.getPositionByPlayerId(playerId);
            const myIndex = positionOrder.indexOf(myPosition);
            
            const relativeRoundScores = {};
            const relativeTotalScores = {};
            const relativeHmarLetters = {};
            const relativeLoser = loserPosition ? positionOrder[(loserActualIdx - myIndex + 4) % 4] : null;
            
            for (let i = 0; i < 4; i++) {
                const actualPosition = positionOrder[(myIndex + i) % 4];
                const relativePosition = positionOrder[i];
                relativeRoundScores[relativePosition] = game.roundScores[actualPosition];
                relativeTotalScores[relativePosition] = game.scores[actualPosition];
                relativeHmarLetters[relativePosition] = game.hmarLetters[actualPosition];
            }
            
            this.io.to(playerId).emit('roundOver', {
                targetPlayer: playerId,
                roundScores: relativeRoundScores,
                totalScores: relativeTotalScores,
                hmarLetters: relativeHmarLetters,
                loser: relativeLoser
            });
        }
    }
    
    showGameOver(roomId, loserPosition) {
        const game = this.games.get(roomId);
        if (!game) return;

        game.phase = 'gameOver';

        // Broadcast game over (someone reached 101 but HMAR not complete)
        const positionOrder = ['bottom', 'left', 'top', 'right'];
        const loserIdx = positionOrder.indexOf(loserPosition);

        for (const [playerId, playerData] of game.players) {
            // Skip bots
            if (playerId.startsWith('bot-')) continue;
            
            const myPosition = game.getPositionByPlayerId(playerId);
            const myIndex = positionOrder.indexOf(myPosition);
            const relativeLoser = positionOrder[(loserIdx - myIndex + 4) % 4];
            
            const relativeHmarLetters = {};
            for (let i = 0; i < 4; i++) {
                const actualPosition = positionOrder[(myIndex + i) % 4];
                const relativePosition = positionOrder[i];
                relativeHmarLetters[relativePosition] = game.hmarLetters[actualPosition];
            }
            
            this.io.to(playerId).emit('gameOver', {
                targetPlayer: playerId,
                loser: relativeLoser,
                hmarLetters: relativeHmarLetters,
                isMatchOver: false
            });
        }
        
        // Auto-ready bots for next game
        this.botReadyForNextRound(roomId);
        this.checkAllReadyForNextGame(roomId);
    }

    endMatch(roomId) {
        const game = this.games.get(roomId);
        if (!game) return;

        game.phase = 'matchOver';

        // Find loser (completed HMAR) and winner (least HMAR letters)
        const loserPosition = POSITIONS.find(pos => game.hmarLetters[pos] === 'HMAR');
        let minLetters = 5;
        let winnerPosition = null;
        for (const pos of POSITIONS) {
            if (game.hmarLetters[pos].length < minLetters) {
                minLetters = game.hmarLetters[pos].length;
                winnerPosition = pos;
            }
        }

        const positionOrder = ['bottom', 'left', 'top', 'right'];
        const loserIdx = positionOrder.indexOf(loserPosition);
        const winnerIdx = positionOrder.indexOf(winnerPosition);

        // Send personalized match over to each player
        for (const [playerId, playerData] of game.players) {
            // Skip bots
            if (playerId.startsWith('bot-')) continue;
            
            const myPosition = game.getPositionByPlayerId(playerId);
            const myIndex = positionOrder.indexOf(myPosition);
            const relativeLoser = positionOrder[(loserIdx - myIndex + 4) % 4];
            const relativeWinner = positionOrder[(winnerIdx - myIndex + 4) % 4];
            
            const relativeHmarLetters = {};
            for (let i = 0; i < 4; i++) {
                const actualPosition = positionOrder[(myIndex + i) % 4];
                const relativePosition = positionOrder[i];
                relativeHmarLetters[relativePosition] = game.hmarLetters[actualPosition];
            }
            
            this.io.to(playerId).emit('matchOver', {
                targetPlayer: playerId,
                loser: relativeLoser,
                winner: relativeWinner,
                hmarLetters: relativeHmarLetters,
                isMatchOver: true
            });
        }
    }

    // Start next round (called by client)
    startNextRound(roomId, playerId) {
        const game = this.games.get(roomId);
        if (!game || game.phase !== 'roundOver') return;

        const position = game.getPositionByPlayerId(playerId);
        if (!position) return;

        // Mark this player as ready
        game.readyForNextRound[position] = true;
        console.log(`Player ${position} ready for next round`);

        // Notify all players about who's ready
        this.broadcastNextRoundStatus(roomId);

        // Check if all players are ready
        this.checkAllReadyForNextRound(roomId);
    }
    
    // Check if all players ready and start next round
    checkAllReadyForNextRound(roomId) {
        const game = this.games.get(roomId);
        if (!game || game.phase !== 'roundOver') return;
        
        const allReady = POSITIONS.every(pos => game.readyForNextRound[pos]);
        if (allReady) {
            // Reset ready state for next time
            for (const pos of POSITIONS) {
                game.readyForNextRound[pos] = false;
            }
            
            game.roundNumber++;
            game.dealerIndex = (game.dealerIndex + 1) % 4;
            game.passDirection = game.passDirection === 'right' ? 'left' : 'right';

            this.startRound(roomId);
        }
    }
    
    // Start next game in the match (after someone hit 101)
    startNextGame(roomId, playerId) {
        const game = this.games.get(roomId);
        if (!game || game.phase !== 'gameOver') return;

        const position = game.getPositionByPlayerId(playerId);
        if (!position) return;

        // Mark this player as ready
        game.readyForNextRound[position] = true;
        console.log(`Player ${position} ready for next game`);

        // Notify all players about who's ready
        this.broadcastNextGameStatus(roomId);

        // Check if all players are ready
        this.checkAllReadyForNextGame(roomId);
    }
    
    // Check if all players ready and start next game
    checkAllReadyForNextGame(roomId) {
        const game = this.games.get(roomId);
        if (!game || game.phase !== 'gameOver') return;
        
        const allReady = POSITIONS.every(pos => game.readyForNextRound[pos]);
        if (allReady) {
            // Reset ready state
            for (const pos of POSITIONS) {
                game.readyForNextRound[pos] = false;
            }
            
            // Reset scores but keep HMAR letters
            game.scores = { bottom: 0, left: 0, top: 0, right: 0 };
            game.roundNumber = 1;
            game.dealerIndex = 0;
            game.passDirection = 'right';
            
            this.startRound(roomId);
        }
    }
    
    // Broadcast next game readiness status
    broadcastNextGameStatus(roomId) {
        const game = this.games.get(roomId);
        if (!game) return;

        const readyCount = POSITIONS.filter(pos => game.readyForNextRound[pos]).length;
        
        for (const [playerId, playerData] of game.players) {
            // Skip bots
            if (playerId.startsWith('bot-')) continue;
            
            const myPosition = game.getPositionByPlayerId(playerId);
            this.io.to(playerId).emit('nextGameStatus', {
                targetPlayer: playerId,
                readyCount: readyCount,
                totalPlayers: 4,
                youReady: game.readyForNextRound[myPosition]
            });
        }
    }

    // Broadcast next round readiness status
    broadcastNextRoundStatus(roomId) {
        const game = this.games.get(roomId);
        if (!game) return;

        const readyCount = POSITIONS.filter(pos => game.readyForNextRound[pos]).length;
        
        for (const [playerId, playerData] of game.players) {
            // Skip bots
            if (playerId.startsWith('bot-')) continue;
            
            const myPosition = game.getPositionByPlayerId(playerId);
            this.io.to(playerId).emit('nextRoundStatus', {
                targetPlayer: playerId,
                readyCount: readyCount,
                totalPlayers: 4,
                youReady: game.readyForNextRound[myPosition]
            });
        }
    }

    // Handle player disconnect during game
    handlePlayerDisconnect(roomId, playerId) {
        const game = this.games.get(roomId);
        if (!game) return;

        // For now, end the game if a player disconnects
        this.io.to(roomId).emit('playerDisconnected', {
            message: 'A player disconnected. Game ended.'
        });

        const room = this.roomManager.getRoom(roomId);
        if (room) {
            room.gameInProgress = false;
        }
        this.games.delete(roomId);
    }

    // Helper to emit to specific player
    emitToPlayer(roomId, playerId, event, data) {
        // Emit directly to the player's socket
        this.io.to(playerId).emit(event, { ...data, targetPlayer: playerId });
    }

    // Broadcast game state to all players
    broadcastGameState(roomId, event) {
        const game = this.games.get(roomId);
        if (!game) return;

        // Send personalized state to each HUMAN player (hiding other hands)
        for (const [playerId, playerData] of game.players) {
            // Skip bots - they don't have sockets
            if (playerId.startsWith('bot-')) continue;
            
            const personalState = this.getPersonalizedState(game, playerId);
            // IMPORTANT: emit to the individual player socket, not the whole room
            this.io.to(playerId).emit(event, {
                targetPlayer: playerId,
                state: personalState
            });
        }
    }

    // Broadcast card played with relative positions
    broadcastCardPlayed(roomId, actualPosition, card) {
        const game = this.games.get(roomId);
        if (!game) return;

        const positionOrder = ['bottom', 'left', 'top', 'right'];
        const actualIdx = positionOrder.indexOf(actualPosition);

        for (const [playerId, playerData] of game.players) {
            // Skip bots
            if (playerId.startsWith('bot-')) continue;
            
            const myPosition = game.getPositionByPlayerId(playerId);
            const myIndex = positionOrder.indexOf(myPosition);
            const relativePosition = positionOrder[(actualIdx - myIndex + 4) % 4];

            // Emit to individual player socket
            this.io.to(playerId).emit('cardPlayed', {
                targetPlayer: playerId,
                position: relativePosition,
                card: card
            });
        }
    }

    // Broadcast trick complete with relative winner position
    broadcastTrickComplete(roomId, winnerPosition, points, cards) {
        const game = this.games.get(roomId);
        if (!game) return;

        const positionOrder = ['bottom', 'left', 'top', 'right'];
        const winnerIdx = positionOrder.indexOf(winnerPosition);

        for (const [playerId, playerData] of game.players) {
            // Skip bots
            if (playerId.startsWith('bot-')) continue;
            
            const myPosition = game.getPositionByPlayerId(playerId);
            const myIndex = positionOrder.indexOf(myPosition);
            const relativeWinner = positionOrder[(winnerIdx - myIndex + 4) % 4];

            // Emit to individual player socket
            this.io.to(playerId).emit('trickComplete', {
                targetPlayer: playerId,
                winner: relativeWinner,
                points: points,
                cards: cards
            });
        }
    }

    getPersonalizedState(game, playerId) {
        const myPosition = game.getPositionByPlayerId(playerId);
        
        // Build player names map (relative to this player's view)
        // From this player's perspective, they are always "bottom"
        const playerNames = {};
        const positionOrder = ['bottom', 'left', 'top', 'right'];
        const myIndex = positionOrder.indexOf(myPosition);
        
        for (let i = 0; i < 4; i++) {
            const actualPosition = positionOrder[(myIndex + i) % 4];
            const relativePosition = positionOrder[i]; // bottom, left, top, right from player's view
            const pid = game.getPlayerIdByPosition(actualPosition);
            const pdata = game.players.get(pid);
            playerNames[relativePosition] = pdata?.username || `Player ${i + 1}`;
        }
        
        // Convert current player position to relative
        const currentPlayerActualIdx = positionOrder.indexOf(game.currentPlayer);
        const relativeCurrentPlayer = positionOrder[(currentPlayerActualIdx - myIndex + 4) % 4];
        
        // Convert trick positions to relative
        const relativeTrick = game.currentTrick.map(t => {
            const actualIdx = positionOrder.indexOf(t.position);
            const relativePos = positionOrder[(actualIdx - myIndex + 4) % 4];
            return { position: relativePos, card: t.card };
        });
        
        // Convert scores to relative positions
        const relativeScores = {};
        const relativeRoundScores = {};
        const relativeTakenCards = {};
        const relativeHmarLetters = {};
        for (let i = 0; i < 4; i++) {
            const actualPosition = positionOrder[(myIndex + i) % 4];
            const relativePosition = positionOrder[i];
            relativeScores[relativePosition] = game.scores[actualPosition];
            relativeRoundScores[relativePosition] = game.roundScores[actualPosition];
            relativeTakenCards[relativePosition] = game.takenCards[actualPosition];
            relativeHmarLetters[relativePosition] = game.hmarLetters[actualPosition] || '';
        }
        
        // Other players info (relative)
        const otherPlayers = positionOrder.filter(p => p !== 'bottom').map((relPos, idx) => {
            const actualPos = positionOrder[(myIndex + idx + 1) % 4];
            return {
                position: relPos,
                cardCount: game.hands[actualPos]?.length || 0,
                hasPassed: game.passedCards[actualPos]?.length === 3
            };
        });
        
        return {
            phase: game.phase,
            roundNumber: game.roundNumber,
            trickNumber: game.trickNumber,
            currentPlayer: relativeCurrentPlayer,
            leadSuit: game.leadSuit,
            passDirection: game.passDirection,
            myPosition: 'bottom', // Always bottom from player's perspective
            myHand: game.hands[myPosition] || [],
            myReceivedCards: game.receivedCards[myPosition] || [],
            hasPassed: game.passedCards[myPosition]?.length === 3,
            currentTrick: relativeTrick,
            scores: relativeScores,
            roundScores: relativeRoundScores,
            takenCards: relativeTakenCards,
            hmarLetters: relativeHmarLetters,
            playerNames: playerNames,
            otherPlayers: otherPlayers
        };
    }
}

module.exports = GameManager;
