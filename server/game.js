const SUITS = ['spade', 'heart', 'diamond', 'club'];
const VALUES = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const SUIT_NAMES = { spade: '♠', heart: '♥', diamond: '♦', club: '♣' };
const VALUE_NAMES = { '10': '10', 'J': 'J', 'Q': 'Q', 'K': 'K', 'A': 'A', '2': '2', '3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9' };

function createDeck() {
  const deck = [];
  // 两副牌
  for (let d = 0; d < 2; d++) {
    for (const suit of SUITS) {
      for (const value of VALUES) {
        deck.push({ suit, value, id: `${suit}-${value}-${d}`, deck: d });
      }
    }
  }
  // 4张王牌
  deck.push({ suit: 'joker', value: 'small', id: 'joker-small-0', deck: 0 });
  deck.push({ suit: 'joker', value: 'small', id: 'joker-small-1', deck: 1 });
  deck.push({ suit: 'joker', value: 'big', id: 'joker-big-0', deck: 0 });
  deck.push({ suit: 'joker', value: 'big', id: 'joker-big-1', deck: 1 });
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 计算牌的点数力（用于比大小）
function cardPower(card, trumpSuit, trumpRankValue) {
  const suitOrder = { spade: 4, heart: 3, diamond: 2, club: 1, joker: 0 };
  const valueOrder = { '3':1,'4':2,'5':3,'6':4,'7':5,'8':6,'9':7,'10':8,'J':9,'Q':10,'K':11,'A':12,'2':13 };
  
  if (card.suit === 'joker') {
    return card.value === 'big' ? 100000 : 99999;
  }
  
  const isTrumpSuit = card.suit === trumpSuit;
  const isTrumpRank = card.value === trumpRankValue;
  
  if (isTrumpSuit && isTrumpRank) return 90000;
  if (isTrumpRank) return 80000 + suitOrder[card.suit] * 100;
  if (isTrumpSuit) return 70000 + valueOrder[card.value] * 10;
  return 10000 + suitOrder[card.suit] * 1000 + valueOrder[card.value] * 10;
}

function isTrump(card, trumpSuit, trumpRankValue) {
  if (card.suit === 'joker') return true;
  if (card.value === trumpRankValue) return true;
  if (card.suit === trumpSuit) return true;
  return false;
}

function cardSuitForFollow(card, trumpSuit, trumpRankValue) {
  // 用于跟牌判断：主牌统一视为同一种"主牌花色"
  if (isTrump(card, trumpSuit, trumpRankValue)) return 'trump';
  return card.suit;
}

function scoreValue(card) {
  if (card.value === '5') return 5;
  if (card.value === '10' || card.value === 'K') return 10;
  return 0;
}

class GameRoom {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = []; // { id, name, index, cards: [], team }
    this.state = 'waiting'; // waiting, dealing, calling, burying, playing, ended
    this.deck = [];
    this.bottomCards = [];
    this.dealerIndex = 0; // 庄家索引
    this.currentLevel = '2'; // 当前打的级
    this.trumpSuit = null;
    this.trumpRankValue = '2';
    this.currentTrick = null; // { leaderIndex, plays: [{index, card}] }
    this.trickCount = 0;
    this.roundScores = { 0: 0, 1: 0 }; // 本局两队的得分
    this.trickWinnerHistory = [];
    this.currentPlayerIndex = 0; // 当前轮到谁出牌
    this.buryCount = 0;
    this.chatHistory = [];
  }

  addPlayer(id, name) {
    if (this.players.length >= 4) return false;
    if (this.players.find(p => p.id === id)) return false;
    const index = this.players.length;
    const team = index % 2; // 0和2一队，1和3一队
    this.players.push({ id, name, index, team, cards: [], ready: false });
    return true;
  }

  removePlayer(id) {
    const idx = this.players.findIndex(p => p.id === id);
    if (idx === -1) return;
    this.players.splice(idx, 1);
    // 重新计算索引
    this.players.forEach((p, i) => { p.index = i; p.team = i % 2; });
    if (this.players.length === 0) {
      this.state = 'waiting';
    }
  }

  setReady(id, ready) {
    const p = this.players.find(p => p.id === id);
    if (p) p.ready = ready;
  }

  allReady() {
    return this.players.length === 4 && this.players.every(p => p.ready);
  }

  startGame() {
    if (!this.allReady()) return false;
    this.state = 'dealing';
    this.deck = shuffle(createDeck());
    this.players.forEach(p => p.cards = []);
    this.bottomCards = [];
    this.trickCount = 0;
    this.roundScores = { 0: 0, 1: 0 };
    this.trickWinnerHistory = [];
    this.trumpSuit = null;
    this.trumpRankValue = this.currentLevel;
    this.buryCount = 0;

    // 发牌：每人25张
    for (let i = 0; i < 25; i++) {
      for (let p = 0; p < 4; p++) {
        this.players[p].cards.push(this.deck.pop());
      }
    }
    // 底牌8张给庄家
    for (let i = 0; i < 8; i++) {
      this.bottomCards.push(this.deck.pop());
    }
    this.players[this.dealerIndex].cards.push(...this.bottomCards);
    
    // 排序庄家手牌
    this.players[this.dealerIndex].cards.sort((a, b) => {
      const pa = cardPower(a, this.trumpSuit || 'spade', this.trumpRankValue);
      const pb = cardPower(b, this.trumpSuit || 'spade', this.trumpRankValue);
      return pb - pa; // 降序
    });

    this.state = 'calling';
    return true;
  }

  callTrump(playerIndex, suit) {
    if (this.state !== 'calling') return false;
    if (playerIndex !== this.dealerIndex) return false;
    this.trumpSuit = suit;
    // 重新排序所有玩家手牌，按主牌在前
    this.players.forEach(p => {
      p.cards.sort((a, b) => {
        const pa = cardPower(a, this.trumpSuit, this.trumpRankValue);
        const pb = cardPower(b, this.trumpSuit, this.trumpRankValue);
        return pb - pa;
      });
    });
    this.state = 'burying';
    return true;
  }

  buryCards(playerIndex, cardIds) {
    if (this.state !== 'burying') return false;
    if (playerIndex !== this.dealerIndex) return false;
    if (cardIds.length !== 8) return false;
    const p = this.players[playerIndex];
    const buried = [];
    for (const cid of cardIds) {
      const idx = p.cards.findIndex(c => c.id === cid);
      if (idx === -1) return false;
      buried.push(p.cards.splice(idx, 1)[0]);
    }
    this.bottomCards = buried;
    this.state = 'playing';
    this.currentPlayerIndex = this.dealerIndex;
    this.currentTrick = { leaderIndex: this.dealerIndex, plays: [] };
    return true;
  }

  canPlayCard(playerIndex, cardId) {
    if (this.state !== 'playing') return false;
    if (this.currentPlayerIndex !== playerIndex) return false;
    const p = this.players[playerIndex];
    const cardIdx = p.cards.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return false;
    const card = p.cards[cardIdx];

    // 首攻任意
    if (this.currentTrick.plays.length === 0) return true;

    const leadCard = this.currentTrick.plays[0].card;
    const leadSuit = cardSuitForFollow(leadCard, this.trumpSuit, this.trumpRankValue);
    const cardSuit = cardSuitForFollow(card, this.trumpSuit, this.trumpRankValue);

    // 如果就是首攻花色，允许
    if (cardSuit === leadSuit) return true;

    // 如果不是首攻花色，检查手牌里是否还有首攻花色的牌
    const hasLeadSuit = p.cards.some(c => cardSuitForFollow(c, this.trumpSuit, this.trumpRankValue) === leadSuit);
    if (hasLeadSuit) return false; // 有必须跟

    return true; // 没有首攻花色，可以垫/杀
  }

  playCard(playerIndex, cardId) {
    if (!this.canPlayCard(playerIndex, cardId)) return null;
    const p = this.players[playerIndex];
    const cardIdx = p.cards.findIndex(c => c.id === cardId);
    const card = p.cards.splice(cardIdx, 1)[0];
    
    this.currentTrick.plays.push({ index: playerIndex, card });

    // 如果4个人都出了
    if (this.currentTrick.plays.length === 4) {
      // 结算这一墩
      const leadCard = this.currentTrick.plays[0].card;
      const leadSuit = cardSuitForFollow(leadCard, this.trumpSuit, this.trumpRankValue);
      
      let winnerPlay = this.currentTrick.plays[0];
      for (let i = 1; i < this.currentTrick.plays.length; i++) {
        const play = this.currentTrick.plays[i];
        const playSuit = cardSuitForFollow(play.card, this.trumpSuit, this.trumpRankValue);
        const winSuit = cardSuitForFollow(winnerPlay.card, this.trumpSuit, this.trumpRankValue);
        
        // 如果当前玩家出的牌更大
        const cp = cardPower(play.card, this.trumpSuit, this.trumpRankValue);
        const wp = cardPower(winnerPlay.card, this.trumpSuit, this.trumpRankValue);
        
        // 规则：跟了首攻花色的牌才有资格赢，除非出的是主牌杀
        // 简化逻辑：直接比cardPower，但垫牌的power天然低于主牌和首攻副牌
        // 实际上cardPower里主牌>副牌，所以直接比即可
        if (cp > wp) {
          winnerPlay = play;
        }
      }

      const winnerIndex = winnerPlay.index;
      const winnerTeam = this.players[winnerIndex].team;
      
      // 计分（5,10,K）
      let trickScore = 0;
      for (const play of this.currentTrick.plays) {
        trickScore += scoreValue(play.card);
      }
      this.roundScores[winnerTeam] += trickScore;
      this.trickWinnerHistory.push({ winnerIndex, trickScore, plays: this.currentTrick.plays.map(x => ({...x})) });

      this.trickCount++;

      // 检查是否出完（25墩）
      if (this.trickCount >= 25) {
        // 最后一墩，底牌分数归赢家，且翻倍
        let bottomScore = 0;
        for (const c of this.bottomCards) bottomScore += scoreValue(c);
        const multiplier = winnerPlay.card.suit === 'joker' || isTrump(winnerPlay.card, this.trumpSuit, this.trumpRankValue) ? 2 : 1;
        this.roundScores[winnerTeam] += bottomScore * multiplier;
        
        // 结束本局
        this.state = 'ended';
        this.currentTrick = null;
        this.currentPlayerIndex = winnerIndex; // 下局庄家
        return { type: 'trick_end', winnerIndex, trickScore, bottomScore, bottomMultiplier: multiplier, isGameEnd: true };
      }

      // 准备下一墩
      this.currentTrick = { leaderIndex: winnerIndex, plays: [] };
      this.currentPlayerIndex = winnerIndex;
      return { type: 'trick_end', winnerIndex, trickScore, isGameEnd: false };
    } else {
      // 轮到下一个人
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % 4;
      return { type: 'play_ok' };
    }
  }

  getGameResult() {
    const team0Score = this.roundScores[0];
    const team1Score = this.roundScores[1];
    const dealerTeam = this.dealerIndex % 2;
    const defenderTeam = 1 - dealerTeam;
    
    let winnerTeam, nextDealer, nextLevel, resultText;
    
    // 闲家（防守方）要 >=80 才能赢
    const defenderScore = this.roundScores[defenderTeam];
    if (defenderScore >= 80) {
      winnerTeam = defenderTeam;
      nextDealer = this.players.find(p => p.team === defenderTeam).index; // 简化：取该队第一个
      nextLevel = this.currentLevel;
      resultText = `闲家获胜！得分 ${defenderScore}，庄家下台。`;
    } else {
      winnerTeam = dealerTeam;
      nextDealer = this.dealerIndex;
      // 根据闲家得分决定升几级
      let levels = 1;
      if (defenderScore === 0) levels = 3;
      else if (defenderScore < 40) levels = 2;
      else if (defenderScore < 80) levels = 1;
      
      const levelOrder = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
      const curIdx = levelOrder.indexOf(this.currentLevel);
      const nextIdx = Math.min(curIdx + levels, levelOrder.length - 1);
      nextLevel = levelOrder[nextIdx];
      resultText = `庄家获胜！闲家仅得 ${defenderScore} 分，庄家连升 ${levels} 级！`;
    }
    
    return { winnerTeam, nextDealer, nextLevel, resultText, scores: this.roundScores };
  }

  getStateForPlayer(playerId) {
    const me = this.players.find(p => p.id === playerId);
    const others = this.players.filter(p => p.id !== playerId).map(p => ({
      id: p.id, name: p.name, index: p.index, team: p.team,
      cardCount: p.cards.length, ready: p.ready
    }));
    
    return {
      roomId: this.roomId,
      state: this.state,
      myIndex: me ? me.index : -1,
      myTeam: me ? me.team : -1,
      myCards: me ? me.cards : [],
      players: others,
      allPlayers: this.players.map(p => ({ id: p.id, name: p.name, index: p.index, team: p.team, ready: p.ready, cardCount: p.cards.length })),
      dealerIndex: this.dealerIndex,
      currentLevel: this.currentLevel,
      trumpSuit: this.trumpSuit,
      trumpRankValue: this.trumpRankValue,
      currentPlayerIndex: this.currentPlayerIndex,
      currentTrick: this.currentTrick,
      trickCount: this.trickCount,
      roundScores: this.roundScores,
      bottomCount: this.bottomCards.length,
      chatHistory: this.chatHistory.slice(-30)
    };
  }

  addChat(sender, text) {
    this.chatHistory.push({ sender, text, time: Date.now() });
  }
}

module.exports = { GameRoom, cardPower, isTrump, SUIT_NAMES, VALUE_NAMES };
