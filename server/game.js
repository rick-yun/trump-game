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

function getValueRank(value, trumpRankValue) {
  // 返回该点数在普通副牌序列中的排名（A最大=0，依次递减）
  // trumpRankValue 被移出序列
  const order = ['A','K','Q','J','10','9','8','7','6','5','4','3','2'];
  const filtered = order.filter(v => v !== trumpRankValue);
  return filtered.indexOf(value);
}

function cardPower(card, trumpSuit, trumpRankValue) {
  const suitOrder = { spade: 4, heart: 3, diamond: 2, club: 1, joker: 0 };

  // 王牌
  if (card.suit === 'joker') {
    return card.value === 'big' ? 100000 : 99900;
  }

  const isTrumpSuit = card.suit === trumpSuit;
  const isTrumpRank = card.value === trumpRankValue;

  // 主级牌（正主）
  if (isTrumpSuit && isTrumpRank) return 99800;

  // 副级牌（按花色：黑桃>红桃>方块>梅花，但黑桃已作为主级牌处理）
  if (isTrumpRank) {
    const offset = { heart: 0, diamond: 1, club: 2 };
    return 99700 - offset[card.suit] * 100;
  }

  // 主花色普通牌
  if (isTrumpSuit) {
    const rank = getValueRank(card.value, trumpRankValue);
    return 99400 - rank * 100;
  }

  // 副牌（按花色和点数）
  const rank = getValueRank(card.value, trumpRankValue);
  const suitBase = { spade: 24000, heart: 22000, diamond: 20000, club: 18000 };
  return suitBase[card.suit] - rank * 100;
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
    if (vals[i] - vals[i-1] !== 100) return false; // 相邻对子power步长为100
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
  // 按 power 升序
  pairs.sort((a,b) => cardPower(a[0], trumpSuit, trumpRankValue) - cardPower(b[0], trumpSuit, trumpRankValue));
  const tractors = [];
  for (let i = 0; i < pairs.length - 1; i++) {
    let seq = [pairs[i]];
    for (let j = i + 1; j < pairs.length; j++) {
      const diff = cardPower(pairs[j][0], trumpSuit, trumpRankValue) - cardPower(seq[seq.length-1][0], trumpSuit, trumpRankValue);
      if (diff === 100) { seq.push(pairs[j]); }
      else if (diff > 100) break;
    }
    if (seq.length >= 2) tractors.push(seq);
  }
  return tractors;
}

// 解析甩牌的内部组件（拖拉机、对子、单张）
function analyzeDumpComponents(cards, trumpSuit, trumpRankValue) {
  const groups = groupByPairs(cards);
  const pairGroups = groups.filter(g => g.length === 2);
  const singleGroups = groups.filter(g => g.length === 1);

  const tractors = [];
  const usedPairs = new Set();

  if (pairGroups.length >= 2) {
    pairGroups.sort((a, b) => cardPower(a[0], trumpSuit, trumpRankValue) - cardPower(b[0], trumpSuit, trumpRankValue));
    let seq = [pairGroups[0]];
    for (let i = 1; i < pairGroups.length; i++) {
      const diff = cardPower(pairGroups[i][0], trumpSuit, trumpRankValue) - cardPower(seq[seq.length - 1][0], trumpSuit, trumpRankValue);
      if (diff === 100) {
        seq.push(pairGroups[i]);
      } else if (diff > 100) {
        if (seq.length >= 2) {
          tractors.push([...seq]);
          for (const g of seq) usedPairs.add(g);
        }
        seq = [pairGroups[i]];
      }
    }
    if (seq.length >= 2) {
      tractors.push([...seq]);
      for (const g of seq) usedPairs.add(g);
    }
  }

  // 剩余未组成拖拉机的对子
  const remainingPairs = pairGroups.filter(g => !usedPairs.has(g));
  const singles = singleGroups.map(g => g[0]);

  return { tractors, pairs: remainingPairs, singles };
}

// 甩牌检测：其他手牌是否有大于甩牌中任一组件的牌
function canBeatDump(dumpCards, otherHands, trumpSuit, trumpRankValue) {
  const suit = effectiveSuit(dumpCards[0], trumpSuit, trumpRankValue);
  const comp = analyzeDumpComponents(dumpCards, trumpSuit, trumpRankValue);

  // 1. 检查拖拉机组件是否被压
  for (const tractor of comp.tractors) {
    const minPower = cardPower(tractor[0][0], trumpSuit, trumpRankValue);
    const len = tractor.length;
    for (const hand of otherHands) {
      const handTractors = getTractors(hand, suit, trumpSuit, trumpRankValue);
      for (const ht of handTractors) {
        if (ht.length >= len && cardPower(ht[ht.length - 1][0], trumpSuit, trumpRankValue) > minPower) {
          return true;
        }
      }
    }
  }

  // 2. 检查对子组件是否被压
  for (const pair of comp.pairs) {
    const pairPower = cardPower(pair[0], trumpSuit, trumpRankValue);
    for (const hand of otherHands) {
      const handPairs = getPairs(hand, suit, trumpSuit, trumpRankValue);
      for (const hp of handPairs) {
        if (cardPower(hp[0], trumpSuit, trumpRankValue) > pairPower) return true;
      }
    }
  }

  // 3. 检查最小单张是否被压
  if (comp.singles.length > 0) {
    let minPower = Infinity;
    for (const s of comp.singles) {
      const p = cardPower(s, trumpSuit, trumpRankValue);
      if (p < minPower) minPower = p;
    }
    for (const hand of otherHands) {
      for (const c of hand) {
        if (effectiveSuit(c, trumpSuit, trumpRankValue) === suit) {
          if (cardPower(c, trumpSuit, trumpRankValue) > minPower) return true;
        }
      }
    }
  }

  return false;
}

// 从cards中选出最小的有效牌型（甩牌失败时强制出最小单位）
function pickMinCards(cards, trumpSuit, trumpRankValue) {
  const groups = groupByPairs(cards);
  const pairGroups = groups.filter(g => g.length === 2);
  const singleGroups = groups.filter(g => g.length === 1);

  if (pairGroups.length > 0) {
    // 有对子，出最小对子
    pairGroups.sort((a, b) => cardPower(a[0], trumpSuit, trumpRankValue) - cardPower(b[0], trumpSuit, trumpRankValue));
    return pairGroups[0].slice(0, 2);
  }
  if (singleGroups.length > 0) {
    singleGroups.sort((a, b) => cardPower(a[0], trumpSuit, trumpRankValue) - cardPower(b[0], trumpSuit, trumpRankValue));
    return [singleGroups[0][0]];
  }
  // fallback
  const sorted = [...cards].sort((a, b) => cardPower(a, trumpSuit, trumpRankValue) - cardPower(b, trumpSuit, trumpRankValue));
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

    // 首攻
    if (this.currentTrick.plays.length === 0) {
      const playType = parsePlayType(cards, this.trumpSuit, this.trumpRankValue);
      if (!playType) return { ok: false, reason: 'invalid_play_type' };
      return { ok: true, playType, cards };
    }

    const lead = this.currentTrick.plays[0];
    const leadType = lead.playType;
    const leadSuit = leadType.suit;
    const leadCount = lead.cards.length;

    // 张数必须相同
    if (cards.length !== leadCount) return { ok: false, reason: `必须出${leadCount}张` };

    const realHand = p.cards;
    const handSuitCards = cardsOfSuit(realHand, leadSuit, this.trumpSuit, this.trumpRankValue);
    const playedSuitCards = cards.filter(c => effectiveSuit(c, this.trumpSuit, this.trumpRankValue) === leadSuit);

    // 原则1：有同花色必须优先出同花色
    if (handSuitCards.length > 0) {
      const mustPlaySuit = Math.min(handSuitCards.length, leadCount);
      if (playedSuitCards.length < mustPlaySuit) {
        return { ok: false, reason: '有同花色必须跟同花色' };
      }
    }

    // 先计算 playType（后续比较需要）
    let playType = parsePlayType(cards, this.trumpSuit, this.trumpRankValue);
    if (!playType) playType = { type: 'dump', suit: leadSuit, cards, count: cards.length };

    // 手牌中没有领出花色 → 可任意垫牌或毙牌
    if (handSuitCards.length === 0) {
      return { ok: true, playType, cards };
    }

    // 出了首攻花色，检查牌型对应
    if (leadType.type === 'single') {
      return { ok: true, playType, cards };
    }

    if (leadType.type === 'pair') {
      const myPairs = getPairs(realHand, leadSuit, this.trumpSuit, this.trumpRankValue);
      const playedPairs = groupByPairs(playedSuitCards).filter(g => g.length >= 2);
      if (myPairs.length > 0 && playedPairs.length === 0) {
        return { ok: false, reason: '有对子必须跟对子' };
      }
      return { ok: true, playType, cards };
    }

    if (leadType.type === 'tractor') {
      const needPairs = leadType.pairs;
      const myTractors = getTractors(realHand, leadSuit, this.trumpSuit, this.trumpRankValue);
      const myPairs = getPairs(realHand, leadSuit, this.trumpSuit, this.trumpRankValue);
      const playedGroups = groupByPairs(playedSuitCards);
      const playedPairs = playedGroups.filter(g => g.length >= 2);

      // 有拖拉机必须跟拖拉机
      const hasTractor = myTractors.some(t => t.length >= needPairs);
      if (hasTractor) {
        // 检查玩家出的牌是否构成足够长的拖拉机
        if (playedPairs.length >= needPairs) {
          const playedPairPowers = playedPairs.map(g => cardPower(g[0], this.trumpSuit, this.trumpRankValue)).sort((a,b)=>a-b);
          let isTractor = true;
          for (let i = 1; i < needPairs; i++) {
            if (playedPairPowers[i] - playedPairPowers[i-1] !== 100) { isTractor = false; break; }
          }
          if (!isTractor) return { ok: false, reason: '有拖拉机必须跟拖拉机' };
        } else {
          return { ok: false, reason: '有拖拉机必须跟拖拉机' };
        }
      }

      // 没有对子拖拉机时，有对子必须跟足对子数
      if (!hasTractor && myPairs.length >= needPairs && playedPairs.length < needPairs) {
        return { ok: false, reason: '有对子必须跟对子' };
      }

      return { ok: true, playType, cards };
    }

    // 首攻是甩牌：按内部组件拆分验证
    if (leadType.type === 'dump') {
      // 简化：确保出了足够的同花色牌
      if (handSuitCards.length > 0 && playedSuitCards.length < Math.min(handSuitCards.length, leadCount)) {
        return { ok: false, reason: '有同花色必须跟同花色' };
      }
      return { ok: true, playType, cards };
    }

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
        // 甩牌失败：强制出最小单位
        const minCards = pickMinCards(cards, this.trumpSuit, this.trumpRankValue);
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
      const w = this.comparePlay(winner, play, leadSuit, leadType);
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

  comparePlay(a, b, leadSuit, leadType) {
    const aSuit = a.playType.suit, bSuit = b.playType.suit;
    const aPower = this.getPlayPower(a), bPower = this.getPlayPower(b);

    // 判断是否为有效毙牌（主牌牌型必须对应领出牌型）
    const aValidKill = this.isValidKill(a, leadType, leadSuit);
    const bValidKill = this.isValidKill(b, leadType, leadSuit);

    // 垫牌（非领出花色且非有效毙牌）不能赢
    const aIsDump = aSuit !== leadSuit && !aValidKill;
    const bIsDump = bSuit !== leadSuit && !bValidKill;
    if (aIsDump && !bIsDump) return b;
    if (bIsDump && !aIsDump) return a;
    if (aIsDump && bIsDump) return aPower > bPower ? a : b;

    // 有效毙牌 > 非毙牌跟牌
    if (aValidKill && !bValidKill) return a;
    if (bValidKill && !aValidKill) return b;

    // 都是有效毙牌，按牌型结构比较
    if (aValidKill && bValidKill) {
      // 拖拉机毙 > 对子毙 > 单张毙
      if (a.playType.type === 'tractor' && b.playType.type !== 'tractor') return a;
      if (b.playType.type === 'tractor' && a.playType.type !== 'tractor') return b;
      if (a.playType.type === 'pair' && b.playType.type === 'single') return a;
      if (b.playType.type === 'pair' && a.playType.type === 'single') return b;
      return aPower > bPower ? a : b;
    }

    // 都没有毙牌，按领出花色比较
    if (leadSuit !== 'trump') {
      if (aSuit === leadSuit && bSuit !== leadSuit) return a;
      if (bSuit === leadSuit && aSuit !== leadSuit) return b;
      if (aSuit === leadSuit && bSuit === leadSuit) return aPower > bPower ? a : b;
      return aPower > bPower ? a : b;
    }
    // 领出是主牌
    if (aSuit === 'trump' && bSuit !== 'trump') return a;
    if (bSuit === 'trump' && aSuit !== 'trump') return b;
    return aPower > bPower ? a : b;
  }

  isValidKill(play, leadType, leadSuit) {
    // 只有领出是副牌时，主牌才有可能毙牌
    if (leadSuit === 'trump') return false;
    if (play.playType.suit !== 'trump') return false;

    const playType = play.playType.type;
    const leadTypeName = leadType.type;

    // 单张领出：主牌单张可以毙
    if (leadTypeName === 'single') return playType === 'single';
    // 对子领出：主牌对子或拖拉机可以毙
    if (leadTypeName === 'pair') return playType === 'pair' || playType === 'tractor';
    // 拖拉机领出：必须主牌拖拉机才能毙
    if (leadTypeName === 'tractor') return playType === 'tractor';
    // 甩牌领出：简化处理，要求主牌牌型结构至少包含对应的对子/拖拉机
    if (leadTypeName === 'dump') return false; // 暂不处理甩牌毙牌
    return false;
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
