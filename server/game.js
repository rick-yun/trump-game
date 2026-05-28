const SUITS = ['spade', 'heart', 'diamond', 'club'];
const VALUES = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const SUIT_NAMES = { spade: '♠', heart: '♥', diamond: '♦', club: '♣' };
const VALUE_ORDER = { '3':1,'4':2,'5':3,'6':4,'7':5,'8':6,'9':7,'10':8,'J':9,'Q':10,'K':11,'A':12,'2':13 };

function createDeck() {
  const deck = [];
  for (let d = 0; d < 2; d++) {
    for (const suit of SUITS) {
      for (const value of VALUES) {
        deck.push({ suit, value, id: `${suit}-${value}-${d}`, deck: d });
      }
    }
  }
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

function cardPower(card, trumpSuit, trumpRankValue) {
  const suitOrder = { spade: 4, heart: 3, diamond: 2, club: 1, joker: 0 };
  if (card.suit === 'joker') return card.value === 'big' ? 100000 : 99999;
  const isTrumpSuit = card.suit === trumpSuit;
  const isTrumpRank = card.value === trumpRankValue;
  if (isTrumpSuit && isTrumpRank) return 90000;
  if (isTrumpRank) return 80000 + suitOrder[card.suit] * 100;
  if (isTrumpSuit) return 70000 + VALUE_ORDER[card.value] * 10;
  return 10000 + suitOrder[card.suit] * 1000 + VALUE_ORDER[card.value] * 10;
}

function isTrump(card, trumpSuit, trumpRankValue) {
  if (card.suit === 'joker') return true;
  if (card.value === trumpRankValue) return true;
  if (card.suit === trumpSuit) return true;
  return false;
}

function effectiveSuit(card, trumpSuit, trumpRankValue) {
  return isTrump(card, trumpSuit, trumpRankValue) ? 'trump' : card.suit;
}

function scoreValue(card) {
  if (card.value === '5') return 5;
  if (card.value === '10' || card.value === 'K') return 10;
  return 0;
}

// ========== 牌型解析 ==========
function groupByPairs(cards) {
  const map = {};
  for (const c of cards) {
    const k = `${c.suit}|${c.value}`;
    if (!map[k]) map[k] = [];
    map[k].push(c);
  }
  return Object.values(map);
}

function isConsecutivePairs(groups, trumpSuit, trumpRankValue) {
  if (groups.length < 2) return false;
  // 每组必须恰好2张
  if (!groups.every(g => g.length === 2)) return false;
  const vals = groups.map(g => cardPower(g[0], trumpSuit, trumpRankValue)).sort((a,b)=>a-b);
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] - vals[i-1] !== 10) return false; // power 步长为10
  }
  return true;
}

function parsePlayType(cards, trumpSuit, trumpRankValue) {
  if (!cards || cards.length === 0) return null;
  if (cards.length === 1) return { type: 'single', suit: effectiveSuit(cards[0], trumpSuit, trumpRankValue), cards, count: 1 };

  const suits = cards.map(c => effectiveSuit(c, trumpSuit, trumpRankValue));
  if (!suits.every(s => s === suits[0])) return null;
  const suit = suits[0];

  const groups = groupByPairs(cards);

  // 对子
  if (cards.length === 2 && groups.length === 1 && groups[0].length === 2) {
    return { type: 'pair', suit, cards, count: 2 };
  }

  // 拖拉机
  if (cards.length >= 4 && cards.length % 2 === 0) {
    if (isConsecutivePairs(groups, trumpSuit, trumpRankValue)) {
      return { type: 'tractor', suit, cards, count: cards.length, pairs: groups.length };
    }
  }

  // 甩牌：同 effective suit 多张（简化版）
  return { type: 'dump', suit, cards, count: cards.length };
}

// 手牌中某 effective suit 的牌
function cardsOfSuit(hand, suit, trumpSuit, trumpRankValue) {
  return hand.filter(c => effectiveSuit(c, trumpSuit, trumpRankValue) === suit);
}

// 手牌中某 effective suit 的对子列表（返回每组对子）
function getPairs(hand, suit, trumpSuit, trumpRankValue) {
  const cs = cardsOfSuit(hand, suit, trumpSuit, trumpRankValue);
  const map = {};
  for (const c of cs) {
    const k = `${c.suit}|${c.value}`;
    if (!map[k]) map[k] = [];
    map[k].push(c);
  }
  return Object.values(map).filter(g => g.length >= 2);
}

// 手牌中某 effective suit 的拖拉机（简化版：只检测power连续的连对）
function getTractors(hand, suit, trumpSuit, trumpRankValue) {
  const pairs = getPairs(hand, suit, trumpSuit, trumpRankValue);
  if (pairs.length < 2) return [];
  // 按 power 排序
  pairs.sort((a,b) => cardPower(a[0], trumpSuit, trumpRankValue) - cardPower(b[0], trumpSuit, trumpRankValue));
  const tractors = [];
  for (let i = 0; i < pairs.length - 1; i++) {
    let seq = [pairs[i]];
    for (let j = i + 1; j < pairs.length; j++) {
      const diff = cardPower(pairs[j][0], trumpSuit, trumpRankValue) - cardPower(seq[seq.length-1][0], trumpSuit, trumpRankValue);
      if (diff === 10) { seq.push(pairs[j]); }
      else if (diff > 10) break;
    }
    if (seq.length >= 2) tractors.push(seq);
  }
  return tractors;
}

// 甩牌检测：其他手牌是否有同suit且大于minCard的牌
function canBeatDump(dumpCards, otherHands, trumpSuit, trumpRankValue) {
  const suit = effectiveSuit(dumpCards[0], trumpSuit, trumpRankValue);
  let minPower = Infinity, minCard = null;
  for (const c of dumpCards) {
    const p = cardPower(c, trumpSuit, trumpRankValue);
    if (p < minPower) { minPower = p; minCard = c; }
  }
  for (const hand of otherHands) {
    for (const c of hand) {
      if (effectiveSuit(c, trumpSuit, trumpRankValue) === suit) {
        if (cardPower(c, trumpSuit, trumpRankValue) > minPower) return true;
      }
    }
  }
  return false;
}

// 从cards中选出最小的单张或对子
function pickMinCards(cards, type, trumpSuit, trumpRankValue) {
  if (type === 'pair') {
    const groups = groupByPairs(cards).filter(g => g.length >= 2);
    if (groups.length === 0) return [cards[cards.length-1]]; //  fallback
    groups.sort((a,b) => cardPower(a[0], trumpSuit, trumpRankValue) - cardPower(b[0], trumpSuit, trumpRankValue));
    return groups[0].slice(0,2);
  }
  const sorted = [...cards].sort((a,b) => cardPower(a, trumpSuit, trumpRankValue) - cardPower(b, trumpSuit, trumpRankValue));
  return [sorted[0]];
}

class GameRoom {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = [];
    this.state = 'waiting';
    this.deck = [];
    this.bottomCards = [];
    this.dealerIndex = 0;
    this.currentLevel = '2';
    this.trumpSuit = null;
    this.trumpRankValue = '2';
    this.currentTrick = null;
    this.trickCount = 0;
    this.roundScores = { 0: 0, 1: 0 };
    this.trickWinnerHistory = [];
    this.currentPlayerIndex = 0;
    this.chatHistory = [];
    this.turnTimer = null;
    this.turnDeadline = null;
  }

  addPlayer(id, name) {
    if (this.players.length >= 4) return false;
    if (this.players.find(p => p.id === id)) return false;
    const index = this.players.length;
    const team = index % 2;
    this.players.push({ id, name, index, team, cards: [], ready: false });
    return true;
  }

  removePlayer(id) {
    const idx = this.players.findIndex(p => p.id === id);
    if (idx === -1) return;
    this.players.splice(idx, 1);
    this.players.forEach((p, i) => { p.index = i; p.team = i % 2; });
    if (this.players.length === 0) this.state = 'waiting';
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

    for (let i = 0; i < 25; i++) {
      for (let p = 0; p < 4; p++) this.players[p].cards.push(this.deck.pop());
    }
    for (let i = 0; i < 8; i++) this.bottomCards.push(this.deck.pop());
    this.players[this.dealerIndex].cards.push(...this.bottomCards);
    this.sortAllHands();
    this.state = 'calling';
    return true;
  }

  sortAllHands() {
    for (const p of this.players) {
      p.cards.sort((a, b) => cardPower(b, this.trumpSuit || 'spade', this.trumpRankValue) - cardPower(a, this.trumpSuit || 'spade', this.trumpRankValue));
    }
  }

  getCallableSuits(playerIndex) {
    const p = this.players[playerIndex];
    if (!p) return [];
    const suits = new Set();
    for (const c of p.cards) {
      if (c.suit !== 'joker' && c.value === this.trumpRankValue) {
        suits.add(c.suit);
      }
    }
    return Array.from(suits);
  }

  callTrump(playerIndex, suit) {
    if (this.state !== 'calling') return false;
    if (playerIndex !== this.dealerIndex) return false;
    const p = this.players[playerIndex];
    // 验证：必须有该花色的级牌才能亮主
    const hasTrumpRank = p.cards.some(c => c.suit === suit && c.value === this.trumpRankValue);
    if (!hasTrumpRank) return false;
    this.trumpSuit = suit;
    this.sortAllHands();
    this.state = 'burying';
    return true;
  }

  autoCallTrump() {
    // 庄家没有级牌时，翻开底牌第一张定主
    if (this.state !== 'calling') return null;
    for (let i = 0; i < this.bottomCards.length; i++) {
      const c = this.bottomCards[i];
      if (c.suit === 'joker') continue; // 王跳过，继续翻下一张
      this.trumpSuit = c.suit;
      this.sortAllHands();
      this.state = 'burying';
      return { suit: c.suit, fromCard: c };
    }
    // 底牌全是王，随机定黑桃
    this.trumpSuit = 'spade';
    this.sortAllHands();
    this.state = 'burying';
    return { suit: 'spade', fromCard: null };
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

  // ========== 核心验证 ==========
  canPlayCards(playerIndex, cardIds) {
    if (this.state !== 'playing') return { ok: false, reason: 'not_playing' };
    if (this.currentPlayerIndex !== playerIndex) return { ok: false, reason: 'not_your_turn' };
    const p = this.players[playerIndex];
    const cards = [];
    for (const cid of cardIds) {
      const c = p.cards.find(x => x.id === cid);
      if (!c) return { ok: false, reason: 'card_not_found' };
      cards.push(c);
    }

    const playType = parsePlayType(cards, this.trumpSuit, this.trumpRankValue);
    if (!playType) return { ok: false, reason: 'invalid_play_type' };

    // 首攻
    if (this.currentTrick.plays.length === 0) {
      return { ok: true, playType, cards };
    }

    const lead = this.currentTrick.plays[0];
    const leadType = lead.playType;
    const leadSuit = leadType.suit;
    const leadCount = lead.cards.length;

    // 张数必须相同
    if (cards.length !== leadCount) return { ok: false, reason: `必须出${leadCount}张` };

    const hand = p.cards.concat(cards); // 加上即将出的牌来检测（因为cards还没从hand移除）
    // 实际上 cards 还没从 p.cards 移除，所以 hand 就是 p.cards
    const realHand = p.cards;
    const handSuitCards = cardsOfSuit(realHand, leadSuit, this.trumpSuit, this.trumpRankValue);

    // 如果出的不是首攻花色，检查手牌是否还有首攻花色
    if (playType.suit !== leadSuit) {
      if (handSuitCards.length > 0) return { ok: false, reason: '必须跟首攻花色' };
      return { ok: true, playType, cards };
    }

    // 出了首攻花色，检查跟牌规则
    if (leadType.type === 'single') {
      return { ok: true, playType, cards };
    }

    if (leadType.type === 'pair') {
      const myPairs = getPairs(realHand, leadSuit, this.trumpSuit, this.trumpRankValue);
      if (myPairs.length > 0 && playType.type !== 'pair' && playType.type !== 'tractor') {
        return { ok: false, reason: '有对子必须跟对子' };
      }
      return { ok: true, playType, cards };
    }

    if (leadType.type === 'tractor') {
      const myTractors = getTractors(realHand, leadSuit, this.trumpSuit, this.trumpRankValue);
      const myPairs = getPairs(realHand, leadSuit, this.trumpSuit, this.trumpRankValue);
      // 手牌有足够拖拉机但没出
      if (myTractors.length > 0 && playType.type !== 'tractor') {
        // 检查手牌是否有足够张数的拖拉机来跟
        const needPairs = leadType.pairs;
        const hasEnough = myTractors.some(t => t.length >= needPairs);
        if (hasEnough) return { ok: false, reason: '有拖拉机必须跟拖拉机' };
      }
      // 有对子但没出对子（且没出拖拉机）
      if (myPairs.length >= leadType.pairs && playType.type !== 'pair' && playType.type !== 'tractor') {
        return { ok: false, reason: '有对子必须跟对子' };
      }
      // 有对子但出的对子数不够
      if (playType.type === 'pair') {
        const outPairs = groupByPairs(cards).filter(g => g.length === 2 && effectiveSuit(g[0], this.trumpSuit, this.trumpRankValue) === leadSuit).length;
        if (myPairs.length >= leadType.pairs && outPairs < leadType.pairs) {
          return { ok: false, reason: '对子数不够' };
        }
      }
      return { ok: true, playType, cards };
    }

    // 首攻是甩牌或dump：简化处理，只要张数对且跟了首攻花色即可
    return { ok: true, playType, cards };
  }

  playCards(playerIndex, cardIds) {
    const check = this.canPlayCards(playerIndex, cardIds);
    if (!check.ok) return { success: false, reason: check.reason };

    const p = this.players[playerIndex];
    const cards = [];
    for (const cid of cardIds) {
      const idx = p.cards.findIndex(c => c.id === cid);
      cards.push(p.cards.splice(idx, 1)[0]);
    }

    // 甩牌检测（仅限首攻甩牌）
    if (this.currentTrick.plays.length === 0 && check.playType.type === 'dump' && cards.length > 1) {
      const otherHands = this.players.filter((_,i) => i !== playerIndex).map(pl => pl.cards);
      if (canBeatDump(cards, otherHands, this.trumpSuit, this.trumpRankValue)) {
        // 甩牌失败：强制出最小的单张或对子
        const minCards = pickMinCards(cards, 'pair', this.trumpSuit, this.trumpRankValue);
        // 把没出的牌放回手牌
        for (const c of cards) {
          if (!minCards.find(mc => mc.id === c.id)) p.cards.push(c);
        }
        p.cards.sort((a,b) => cardPower(b, this.trumpSuit, this.trumpRankValue) - cardPower(a, this.trumpSuit, this.trumpRankValue));
        const minType = parsePlayType(minCards, this.trumpSuit, this.trumpRankValue);
        this.currentTrick.plays.push({ index: playerIndex, cards: minCards, playType: minType || { type:'single', suit:effectiveSuit(minCards[0],this.trumpSuit,this.trumpRankValue), cards:minCards, count:minCards.length } });
        return { success: true, type: 'play_ok', dumpFailed: true };
      }
    }

    this.currentTrick.plays.push({ index: playerIndex, cards, playType: check.playType });

    if (this.currentTrick.plays.length === 4) {
      return this.endTrick();
    }
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % 4;
    return { success: true, type: 'play_ok' };
  }

  endTrick() {
    const lead = this.currentTrick.plays[0];
    const leadType = lead.playType;
    const leadSuit = leadType.suit;

    let winner = this.currentTrick.plays[0];
    for (let i = 1; i < this.currentTrick.plays.length; i++) {
      const play = this.currentTrick.plays[i];
      const w = this.comparePlay(winner, play, leadSuit);
      if (w === play) winner = play;
    }

    const winnerTeam = this.players[winner.index].team;
    let trickScore = 0;
    for (const play of this.currentTrick.plays) {
      for (const c of play.cards) trickScore += scoreValue(c);
    }
    this.roundScores[winnerTeam] += trickScore;
    this.trickWinnerHistory.push({ winnerIndex: winner.index, trickScore });
    this.trickCount++;

    let bottomScore = 0, bottomMultiplier = 1;
    if (this.trickCount >= 25) {
      for (const c of this.bottomCards) bottomScore += scoreValue(c);
      bottomMultiplier = this.getBottomMultiplier(winner);
      this.roundScores[winnerTeam] += bottomScore * bottomMultiplier;
      this.state = 'ended';
      return { success: true, type: 'trick_end', isGameEnd: true, winnerIndex: winner.index, trickScore, bottomScore, bottomMultiplier };
    }

    this.currentTrick = { leaderIndex: winner.index, plays: [] };
    this.currentPlayerIndex = winner.index;
    return { success: true, type: 'trick_end', isGameEnd: false, winnerIndex: winner.index, trickScore };
  }

  comparePlay(a, b, leadSuit) {
    const aSuit = a.playType.suit, bSuit = b.playType.suit;
    const aPower = this.getPlayPower(a), bPower = this.getPlayPower(b);

    if (leadSuit !== 'trump') {
      if (aSuit === 'trump' && bSuit !== 'trump') return a;
      if (bSuit === 'trump' && aSuit !== 'trump') return b;
      if (aSuit === 'trump' && bSuit === 'trump') return aPower > bPower ? a : b;
      if (aSuit === leadSuit && bSuit !== leadSuit) return a;
      if (bSuit === leadSuit && aSuit !== leadSuit) return b;
      if (aSuit === leadSuit && bSuit === leadSuit) return aPower > bPower ? a : b;
      return aPower > bPower ? a : b;
    }
    if (aSuit === 'trump' && bSuit !== 'trump') return a;
    if (bSuit === 'trump' && aSuit !== 'trump') return b;
    return aPower > bPower ? a : b;
  }

  getPlayPower(play) {
    let max = 0;
    for (const c of play.cards) {
      const p = cardPower(c, this.trumpSuit, this.trumpRankValue);
      if (p > max) max = p;
    }
    return max;
  }

  getBottomMultiplier(winnerPlay) {
    const type = winnerPlay.playType.type;
    if (type === 'single') return 2;
    if (type === 'pair') return 4;
    if (type === 'tractor') {
      const pairs = winnerPlay.playType.pairs || 2;
      return 8 * Math.pow(2, pairs - 2);
    }
    // dump 按其中最大的组合算：简化按单张
    return 2;
  }

  autoPlay(playerIndex) {
    const p = this.players[playerIndex];
    if (this.currentTrick.plays.length === 0) {
      // 首攻：出最小的一张
      const c = p.cards[p.cards.length - 1];
      return this.playCards(playerIndex, [c.id]);
    }
    const lead = this.currentTrick.plays[0];
    const leadType = lead.playType;
    const leadSuit = leadType.suit;
    const count = lead.cards.length;
    const hand = p.cards;

    const suitCards = cardsOfSuit(hand, leadSuit, this.trumpSuit, this.trumpRankValue);
    if (suitCards.length >= count) {
      const ids = suitCards.slice(-count).map(c => c.id);
      return this.playCards(playerIndex, ids);
    }
    const ids = hand.slice(-count).map(c => c.id);
    return this.playCards(playerIndex, ids);
  }

  getGameResult() {
    const dealerTeam = this.dealerIndex % 2;
    const defenderTeam = 1 - dealerTeam;
    const defenderScore = this.roundScores[defenderTeam];

    let nextDealer, nextLevel, resultText, scoreBase;

    // 国标规则：庄家胜 → 对家（同伴）继续坐庄；庄家败 → 下家上台
    const dealerPartner = (this.dealerIndex + 2) % 4;
    const nextClockwise = (this.dealerIndex + 1) % 4;

    if (defenderScore === 0) {
      nextDealer = dealerPartner; nextLevel = this.advanceLevel(3);
      scoreBase = 4; resultText = `庄家大光头！连升3级！闲家0分。`;
    } else if (defenderScore < 40) {
      nextDealer = dealerPartner; nextLevel = this.advanceLevel(2);
      scoreBase = 2; resultText = `庄家小光头！连升2级！闲家仅${defenderScore}分。`;
    } else if (defenderScore < 80) {
      nextDealer = dealerPartner; nextLevel = this.advanceLevel(1);
      scoreBase = 1; resultText = `庄家升级！闲家${defenderScore}分。`;
    } else if (defenderScore < 120) {
      nextDealer = nextClockwise; nextLevel = this.currentLevel; scoreBase = 1;
      resultText = `闲家上台！得${defenderScore}分。`;
    } else if (defenderScore < 160) {
      nextDealer = nextClockwise; nextLevel = this.advanceLevel(1, defenderTeam);
      scoreBase = 2; resultText = `闲家上台并升1级！得${defenderScore}分。`;
    } else if (defenderScore < 200) {
      nextDealer = nextClockwise; nextLevel = this.advanceLevel(2, defenderTeam);
      scoreBase = 3; resultText = `闲家上台并连升2级！得${defenderScore}分。`;
    } else {
      const levels = 1 + Math.floor((defenderScore - 120) / 40);
      nextDealer = nextClockwise; nextLevel = this.advanceLevel(levels, defenderTeam);
      scoreBase = levels;
      resultText = `闲家狂胜！得${defenderScore}分，连升${levels}级！`;
    }

    return { winnerTeam: defenderScore >= 80 ? defenderTeam : dealerTeam, nextDealer, nextLevel, resultText, scoreBase, scores: this.roundScores, defenderScore };
  }

  advanceLevel(n) {
    const levelOrder = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    const curIdx = levelOrder.indexOf(this.currentLevel);
    const nextIdx = Math.min(curIdx + n, levelOrder.length - 1);
    return levelOrder[nextIdx];
  }

  getStateForPlayer(playerId) {
    const me = this.players.find(p => p.id === playerId);
    return {
      roomId: this.roomId, state: this.state,
      myIndex: me ? me.index : -1, myTeam: me ? me.team : -1, myCards: me ? me.cards : [],
      allPlayers: this.players.map(p => ({ id: p.id, name: p.name, index: p.index, team: p.team, ready: p.ready, cardCount: p.cards.length })),
      dealerIndex: this.dealerIndex, currentLevel: this.currentLevel,
      trumpSuit: this.trumpSuit, trumpRankValue: this.trumpRankValue,
      callableSuits: me ? this.getCallableSuits(me.index) : [],
      currentPlayerIndex: this.currentPlayerIndex,
      currentTrick: this.currentTrick, turnDeadline: this.turnDeadline,
      trickCount: this.trickCount, roundScores: this.roundScores,
      chatHistory: this.chatHistory.slice(-30)
    };
  }

  addChat(sender, text) { this.chatHistory.push({ sender, text, time: Date.now() }); }
}

module.exports = { GameRoom, cardPower, isTrump, SUIT_NAMES, parsePlayType };
