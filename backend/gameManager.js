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
        this.phase = 'waiting'; // 'waiting', 'passing', 'receiving', 'playing', 'trickComplete', 'roundOver', 'gameOver'
        
        // Initialize scores and hands for each position
        for (const pos of POSITIONS) {
            this.scores[pos] = 0;
            this.roundScores[pos] = 0;
            this.hands[pos] = [];
            this.takenCards[pos] = [];
            this.passedCards[pos] = [];
            this.receivedCards[pos] = [];
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

    // Handle card passing
    handlePassCards(roomId, playerId, cardIds) {
        const game = this.games.get(roomId);
        if (!game || game.phase !== 'passing') return;

        const position = game.getPositionByPlayerId(playerId);
        if (!position) return;

        if (cardIds.length !== 3) {
            this.emitToPlayer(roomId, playerId, 'error', { message: 'Must pass exactly 3 cards' });
            return;
        }

        // Find and remove cards from hand
        const cardsToPass = [];
        for (const cardId of cardIds) {
            const idx = game.hands[position].findIndex(c => this.getCardId(c) === cardId);
            if (idx === -1) {
                this.emitToPlayer(roomId, playerId, 'error', { message: 'Invalid card selection' });
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

        // Notify player
        this.emitToPlayer(roomId, playerId, 'cardsPassedConfirmed', { cards: cardsToPass });

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
        }

        // Add received cards to hands
        for (const pos of POSITIONS) {
            game.hands[pos].push(...game.receivedCards[pos]);
            this.sortHand(game.hands[pos]);
        }

        // Move to playing phase
        game.phase = 'playing';
        game.trickNumber = 1;
        game.currentPlayer = POSITIONS[(game.dealerIndex + 1) % 4];

        // Broadcast the exchange
        this.broadcastGameState(roomId, 'cardsExchanged');
    }

    getPassTarget(position, direction) {
        const idx = POSITIONS.indexOf(position);
        if (direction === 'right') {
            return POSITIONS[(idx + 1) % 4];
        } else {
            return POSITIONS[(idx + 3) % 4];
        }
    }

    // Handle playing a card
    handlePlayCard(roomId, playerId, cardId) {
        const game = this.games.get(roomId);
        if (!game || game.phase !== 'playing') return;

        const position = game.getPositionByPlayerId(playerId);
        if (!position || position !== game.currentPlayer) {
            this.emitToPlayer(roomId, playerId, 'error', { message: 'Not your turn' });
            return;
        }

        // Find card in hand
        const card = this.parseCardId(cardId);
        const cardIdx = game.hands[position].findIndex(c => 
            c.rank === card.rank && c.suit === card.suit
        );

        if (cardIdx === -1) {
            this.emitToPlayer(roomId, playerId, 'error', { message: 'Card not in hand' });
            return;
        }

        const fullCard = game.hands[position][cardIdx];

        // Validate play
        if (!this.canPlayCard(game, position, fullCard)) {
            this.emitToPlayer(roomId, playerId, 'error', { message: 'Invalid card play' });
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
            setTimeout(() => this.endRound(roomId), 1000);
        } else {
            // Start next trick
            game.trickNumber++;
            game.currentPlayer = winner.position;
            this.broadcastGameState(roomId, 'newTrick');
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

        game.phase = 'roundOver';

        // Broadcast round results to each player with relative positions
        const positionOrder = ['bottom', 'left', 'top', 'right'];
        
        for (const [playerId, playerData] of game.players) {
            const myPosition = game.getPositionByPlayerId(playerId);
            const myIndex = positionOrder.indexOf(myPosition);
            
            const relativeRoundScores = {};
            const relativeTotalScores = {};
            
            for (let i = 0; i < 4; i++) {
                const actualPosition = positionOrder[(myIndex + i) % 4];
                const relativePosition = positionOrder[i];
                relativeRoundScores[relativePosition] = game.roundScores[actualPosition];
                relativeTotalScores[relativePosition] = game.scores[actualPosition];
            }
            
            this.io.to(roomId).emit('roundOver', {
                targetPlayer: playerId,
                roundScores: relativeRoundScores,
                totalScores: relativeTotalScores
            });
        }

        // Check for game over
        const maxScore = Math.max(...Object.values(game.scores));
        if (maxScore >= WINNING_SCORE) {
            this.endGame(roomId);
        }
    }

    endGame(roomId) {
        const game = this.games.get(roomId);
        if (!game) return;

        game.phase = 'gameOver';

        // Find winner (lowest score)
        let minScore = Infinity;
        let winnerPosition = null;
        for (const pos of POSITIONS) {
            if (game.scores[pos] < minScore) {
                minScore = game.scores[pos];
                winnerPosition = pos;
            }
        }

        const winnerId = game.getPlayerIdByPosition(winnerPosition);
        const winnerData = game.players.get(winnerId);
        
        const positionOrder = ['bottom', 'left', 'top', 'right'];
        const winnerIdx = positionOrder.indexOf(winnerPosition);

        // Send personalized game over to each player
        for (const [playerId, playerData] of game.players) {
            const myPosition = game.getPositionByPlayerId(playerId);
            const myIndex = positionOrder.indexOf(myPosition);
            const relativeWinner = positionOrder[(winnerIdx - myIndex + 4) % 4];
            
            const relativeFinalScores = {};
            for (let i = 0; i < 4; i++) {
                const actualPosition = positionOrder[(myIndex + i) % 4];
                const relativePosition = positionOrder[i];
                relativeFinalScores[relativePosition] = game.scores[actualPosition];
            }
            
            this.io.to(roomId).emit('gameOver', {
                targetPlayer: playerId,
                winner: {
                    position: relativeWinner,
                    username: winnerData?.username,
                    score: minScore
                },
                finalScores: relativeFinalScores
            });
        }

        // Clean up
        const room = this.roomManager.getRoom(roomId);
        if (room) {
            room.gameInProgress = false;
            // Reset ready states
            for (const player of room.players.values()) {
                player.ready = false;
            }
        }
        this.games.delete(roomId);
    }

    // Start next round (called by client)
    startNextRound(roomId) {
        const game = this.games.get(roomId);
        if (!game || game.phase !== 'roundOver') return;

        game.roundNumber++;
        game.dealerIndex = (game.dealerIndex + 1) % 4;
        game.passDirection = game.passDirection === 'right' ? 'left' : 'right';

        this.startRound(roomId);
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
        this.io.to(roomId).emit(event, { ...data, targetPlayer: playerId });
    }

    // Broadcast game state to all players
    broadcastGameState(roomId, event) {
        const game = this.games.get(roomId);
        if (!game) return;

        // Send personalized state to each player (hiding other hands)
        for (const [playerId, playerData] of game.players) {
            const personalState = this.getPersonalizedState(game, playerId);
            this.io.to(roomId).emit(event, {
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
            const myPosition = game.getPositionByPlayerId(playerId);
            const myIndex = positionOrder.indexOf(myPosition);
            const relativePosition = positionOrder[(actualIdx - myIndex + 4) % 4];

            this.io.to(roomId).emit('cardPlayed', {
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
            const myPosition = game.getPositionByPlayerId(playerId);
            const myIndex = positionOrder.indexOf(myPosition);
            const relativeWinner = positionOrder[(winnerIdx - myIndex + 4) % 4];

            this.io.to(roomId).emit('trickComplete', {
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
        for (let i = 0; i < 4; i++) {
            const actualPosition = positionOrder[(myIndex + i) % 4];
            const relativePosition = positionOrder[i];
            relativeScores[relativePosition] = game.scores[actualPosition];
            relativeRoundScores[relativePosition] = game.roundScores[actualPosition];
            relativeTakenCards[relativePosition] = game.takenCards[actualPosition];
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
            playerNames: playerNames,
            otherPlayers: otherPlayers
        };
    }
}

module.exports = GameManager;
