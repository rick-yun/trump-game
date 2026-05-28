// ================= 配置 =================
// 如果你把后端单独部署在 Render，请把下面改成你的 Render 地址：
// const SERVER_URL = 'https://你的服务名.onrender.com';
const SERVER_URL = ''; // 空字符串表示同域（前后端一起部署时）

// ================= 工具 =================
const $ = id => document.getElementById(id);
const SUIT_EMOJI = { spade: '♠', heart: '♥', diamond: '♦', club: '♣', joker: '🃏' };
const SUIT_NAMES = { spade: '黑桃', heart: '红桃', diamond: '方块', club: '梅花' };

let socket = null;
let myId = null;
let roomId = null;
let gameState = null;
let selectedCardIds = new Set();

function connect() {
  if (socket) return;
  socket = io(SERVER_URL || undefined);
  socket.on('connect', () => { console.log('connected'); });
  socket.on('game_state', onGameState);
  socket.on('joined', onJoined);
  socket.on('error_msg', msg => alert(msg));
  socket.on('chat_msg', onChat);
  socket.on('game_end', onGameEnd);
}

// ================= 登录面板 =================
$('btn-join').onclick = () => {
  const name = $('player-name').value.trim() || '玩家';
  const rid = $('room-id').value.trim() || '8888';
  connect();
  socket.emit('join_room', { roomId: rid, playerName: name });
};

function onJoined(data) {
  myId = data.myId;
  roomId = data.roomId;
  $('login-panel').classList.add('hidden');
  $('room-panel').classList.remove('hidden');
  $('room-id-display').textContent = roomId;
}

// ================= 房间面板 =================
$('btn-ready').onclick = () => socket.emit('ready', { ready: true });
$('btn-cancel-ready').onclick = () => socket.emit('ready', { ready: false });
$('btn-start').onclick = () => socket.emit('start_game');

// ================= 游戏主界面 =================
function onGameState(state) {
  gameState = state;

  if (state.state === 'waiting') {
    $('room-panel').classList.remove('hidden');
    $('game-panel').classList.add('hidden');
    renderRoomList(state);
    const isHost = state.allPlayers[0] && state.allPlayers[0].id === myId;
    $('btn-start').classList.toggle('hidden', !isHost);
    return;
  }

  $('room-panel').classList.add('hidden');
  $('game-panel').classList.remove('hidden');

  renderTopBar(state);
  renderSeats(state);
  renderTrick(state);
  renderHand(state);
  renderActions(state);
}

function renderTopBar(s) {
  $('g-room').textContent = s.roomId;
  $('g-level').textContent = s.currentLevel;
  $('g-trump').textContent = s.trumpSuit ? (SUIT_NAMES[s.trumpSuit] + SUIT_EMOJI[s.trumpSuit]) : '未选';
  $('g-trick').textContent = `${s.trickCount}/25`;
  const myTeam = s.myTeam;
  const opp = 1 - myTeam;
  $('g-score').textContent = `我方${s.roundScores[myTeam]} : 对方${s.roundScores[opp]}`;
}

function renderSeats(s) {
  const container = $('seats');
  container.innerHTML = '';
  const meIdx = s.myIndex;
  if (meIdx === -1) return;
  const relIndex = (targetIdx) => (targetIdx - meIdx + 4) % 4;

  for (const p of s.allPlayers) {
    const rel = relIndex(p.index);
    const div = document.createElement('div');
    div.className = `seat seat-pos-${rel} ${p.index === s.currentPlayerIndex ? 'active' : ''}`;
    const teamLabel = p.team === s.myTeam ? '(友)' : '(敌)';
    div.innerHTML = `
      <div class="seat-name">${p.name} ${teamLabel}</div>
      <div class="seat-cards">剩余 ${p.cardCount} 张</div>
    `;
    container.appendChild(div);
  }
}

function renderTrick(s) {
  const area = $('trick-area');
  area.innerHTML = '';
  if (!s.currentTrick || !s.currentTrick.plays.length) return;
  for (const play of s.currentTrick.plays) {
    const p = s.allPlayers.find(x => x.index === play.index);
    const div = document.createElement('div');
    div.className = 'trick-card';
    const isRed = play.card.suit === 'heart' || play.card.suit === 'diamond';
    const colorCls = play.card.suit === 'joker' ? 'joker' : (isRed ? 'red' : 'black');
    div.innerHTML = `
      <div class="tc-player">${p ? p.name : ''}</div>
      <div class="${colorCls}">${SUIT_EMOJI[play.card.suit]}${play.card.value}</div>
    `;
    area.appendChild(div);
  }
}

function renderHand(s) {
  const area = $('hand-cards');
  area.innerHTML = '';
  if (!s.myCards) return;
  for (const c of s.myCards) {
    const div = document.createElement('div');
    div.className = 'card';
    const isRed = c.suit === 'heart' || c.suit === 'diamond';
    if (c.suit === 'joker') div.classList.add('joker');
    else div.classList.add(isRed ? 'red' : 'black');
    if (selectedCardIds.has(c.id)) div.classList.add('selected');
    div.innerHTML = `<div class="c-value">${c.value}</div><div class="c-suit">${SUIT_EMOJI[c.suit]}</div>`;
    div.onclick = () => toggleCard(c.id);
    area.appendChild(div);
  }
}

function toggleCard(id) {
  if (selectedCardIds.has(id)) selectedCardIds.delete(id);
  else selectedCardIds.add(id);
  renderHand(gameState);
}

function clearSelection() {
  selectedCardIds.clear();
  renderHand(gameState);
}

// ================= 操作按钮 =================
function renderActions(s) {
  const msg = $('msg-area');
  const btns = $('btn-area');
  btns.innerHTML = '';

  if (s.state === 'calling' && s.myIndex === s.dealerIndex) {
    msg.textContent = '你是庄家，请选择主花色';
    for (const suit of ['spade','heart','diamond','club']) {
      const b = document.createElement('button');
      b.textContent = SUIT_NAMES[suit] + SUIT_EMOJI[suit];
      b.onclick = () => socket.emit('call_trump', { suit });
      btns.appendChild(b);
    }
    return;
  }

  if (s.state === 'burying' && s.myIndex === s.dealerIndex) {
    msg.textContent = `请从手牌中选择8张作为底牌（已选${selectedCardIds.size}张）`;
    const b = document.createElement('button');
    b.textContent = '确认扣底';
    b.onclick = () => {
      const ids = Array.from(selectedCardIds);
      if (ids.length !== 8) { alert('必须选8张'); return; }
      socket.emit('bury_cards', { cardIds: ids });
      clearSelection();
    };
    btns.appendChild(b);
    return;
  }

  if (s.state === 'playing' && s.myIndex === s.currentPlayerIndex) {
    msg.textContent = s.currentTrick.plays.length === 0 ? '请出牌（首攻）' : '请跟牌';
    const b = document.createElement('button');
    b.textContent = '出牌';
    b.onclick = () => {
      const ids = Array.from(selectedCardIds);
      if (ids.length !== 1) { alert('测试版每次出1张'); return; }
      socket.emit('play_card', { cardId: ids[0] });
      clearSelection();
    };
    btns.appendChild(b);
    return;
  }

  if (s.state === 'playing') {
    const cur = s.allPlayers.find(p => p.index === s.currentPlayerIndex);
    msg.textContent = `等待 ${cur ? cur.name : ''} 出牌...`;
    return;
  }

  if (s.state === 'ended') {
    msg.textContent = '本局已结束';
    return;
  }

  msg.textContent = '';
}

// ================= 聊天 =================
function onChat(data) {
  const box = $('chat-history');
  const line = document.createElement('div');
  line.className = 'chat-line';
  line.innerHTML = `<span class="chat-sender">${data.sender}:</span> ${escapeHtml(data.text)}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

$('btn-send').onclick = sendChat;
$('chat-input').onkeydown = e => { if (e.key === 'Enter') sendChat(); };
function sendChat() {
  const text = $('chat-input').value.trim();
  if (!text) return;
  socket.emit('chat', { text });
  $('chat-input').value = '';
}
function escapeHtml(t) {
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ================= 结算 =================
function onGameEnd(res) {
  $('result-text').textContent = res.resultText;
  const myTeam = gameState.myTeam;
  $('result-scores').innerHTML = `
    <div>我方(${myTeam})得分：${res.scores[myTeam]}</div>
    <div>对方(${1-myTeam})得分：${res.scores[1-myTeam]}</div>
  `;
  $('result-modal').classList.remove('hidden');
}

$('btn-next').onclick = () => {
  $('result-modal').classList.add('hidden');
  socket.emit('next_game');
};

// ================= 房间列表（等待阶段） =================
function renderRoomList(s) {
  const box = $('players-list');
  box.innerHTML = '';
  for (const p of s.allPlayers) {
    const div = document.createElement('div');
    div.className = 'player-card';
    const readyStr = p.ready ? '✅ 已准备' : '⏳ 未准备';
    const teamStr = p.team === 0 ? 'A队' : 'B队';
    div.innerHTML = `<div class="p-name">${p.name}</div><div class="p-status">${readyStr}</div><div class="p-team">${teamStr}</div>`;
    box.appendChild(div);
  }
  const readyCount = s.allPlayers.filter(p => p.ready).length;
  $('room-tip').textContent = `当前 ${s.allPlayers.length}/4 人，${readyCount} 人已准备`;
}
