const SERVER_URL = '';
const $ = id => document.getElementById(id);
const SUIT_EMOJI = { spade: '♠', heart: '♥', diamond: '♦', club: '♣', joker: '🃏' };
const SUIT_NAMES = { spade: '黑桃', heart: '红桃', diamond: '方块', club: '梅花' };

let socket = null, myId = null, roomId = null, gameState = null, selectedCardIds = new Set();
let countdownTimer = null;

function connect() {
  if (socket) return;
  socket = io(SERVER_URL || undefined);
  socket.on('connect', () => console.log('connected'));
  socket.on('game_state', onGameState);
  socket.on('joined', onJoined);
  socket.on('error_msg', msg => alert(msg));
  socket.on('chat_msg', onChat);
  socket.on('game_end', onGameEnd);
}

/* 登录 */
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

/* 房间 */
$('btn-ready').onclick = () => socket.emit('ready', { ready: true });
$('btn-cancel-ready').onclick = () => socket.emit('ready', { ready: false });
$('btn-start').onclick = () => socket.emit('start_game');
$('btn-add-bot').onclick = () => {
  console.log('点击添加机器人');
  socket.emit('add_bot');
};

/* 游戏状态 */
function onGameState(state) {
  gameState = state;
  if (state.state === 'waiting') {
    $('room-panel').classList.remove('hidden');
    $('game-panel').classList.add('hidden');
    renderRoomList(state);
    const isHost = state.allPlayers[0] && state.allPlayers[0].id === myId;
    $('btn-start').classList.toggle('hidden', !isHost);
    $('btn-add-bot').classList.toggle('hidden', !isHost || state.allPlayers.length >= 4);
    clearCountdown();
    return;
  }
  $('room-panel').classList.add('hidden');
  $('game-panel').classList.remove('hidden');
  renderTopBar(state);
  renderSeats(state);
  renderTrick(state);
  renderHand(state);
  renderActions(state);
  startCountdown(state.turnDeadline);
}

function renderTopBar(s) {
  $('g-room').textContent = s.roomId;
  $('g-level').textContent = s.currentLevel;
  $('g-trump').textContent = '主:' + (s.trumpSuit ? SUIT_NAMES[s.trumpSuit] : '未选');
  $('g-trick').textContent = s.trickCount + '/25';
  const myTeam = s.myTeam, opp = 1 - myTeam;
  $('score-us').textContent = s.roundScores[myTeam];
  $('score-them').textContent = s.roundScores[opp];
}

function renderSeats(s) {
  const meIdx = s.myIndex;
  if (meIdx === -1) return;
  const rel = (targetIdx) => (targetIdx - meIdx + 4) % 4;
  const posMap = { 0: 'seat-me', 1: 'seat-right', 2: 'seat-top', 3: 'seat-left' };
  for (const pos of ['seat-top','seat-left','seat-right']) { $(pos).innerHTML = ''; $(pos).className = 'seat-wrap ' + pos.replace('seat-',''); }
  $('seat-me').innerHTML = '';

  for (const p of s.allPlayers) {
    const r = rel(p.index);
    const posId = posMap[r];
    const isActive = p.index === s.currentPlayerIndex;
    const teamText = p.team === s.myTeam ? '友' : '敌';
    const html = `<div class="seat-avatar">${teamText}</div><div class="seat-name">${p.name}</div><div class="seat-count">${p.cardCount}张</div>`;
    if (posId === 'seat-me') {
      $('seat-me').innerHTML = `<div class="seat-avatar">我</div>`;
    } else {
      const el = $(posId);
      el.innerHTML = html;
      if (isActive) el.classList.add('active');
    }
  }
}

function renderTrick(s) {
  const area = $('trick-area');
  area.innerHTML = '';
  if (!s.currentTrick || !s.currentTrick.plays.length) {
    let msg = '等待开始...';
    if (s.state === 'playing') msg = '等待出牌...';
    else if (s.state === 'calling') msg = '等待选主...';
    else if (s.state === 'burying') msg = '等待扣底...';
    $('table-msg').textContent = msg;
    return;
  }
  $('table-msg').textContent = '';
  for (const play of s.currentTrick.plays) {
    const p = s.allPlayers.find(x => x.index === play.index);
    const wrap = document.createElement('div');
    wrap.className = 'trick-card-wrap';
    let cardsHtml = '';
    for (const c of play.cards) {
      const isRed = c.suit === 'heart' || c.suit === 'diamond';
      const cls = c.suit === 'joker' ? 'joker' : (isRed ? 'red' : 'black');
      cardsHtml += `<div class="trick-card ${cls}"><div class="tc-val">${c.value}</div><div class="tc-suit">${SUIT_EMOJI[c.suit]}</div></div>`;
    }
    wrap.innerHTML = `<div class="tc-player">${p ? p.name : ''}</div><div style="display:flex;gap:2px;">${cardsHtml}</div>`;
    area.appendChild(wrap);
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
function clearSelection() { selectedCardIds.clear(); renderHand(gameState); }

/* 倒计时 */
function startCountdown(deadline) {
  clearCountdown();
  if (!deadline) return;
  const update = () => {
    const sec = Math.ceil((deadline - Date.now()) / 1000);
    const el = $('action-msg');
    if (!el) return;
    const base = el.dataset.base || '';
    if (sec > 0 && (gameState?.state === 'playing' || gameState?.state === 'burying')) {
      el.textContent = base + (base ? ' ' : '') + `⏳${sec}s`;
    } else {
      el.textContent = base;
    }
  };
  update();
  countdownTimer = setInterval(update, 1000);
}
function clearCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}

/* 操作按钮 */
function renderActions(s) {
  const msg = $('action-msg');
  const btns = $('action-btns');
  btns.innerHTML = '';
  msg.dataset.base = '';

  if (s.state === 'calling' && s.myIndex === s.dealerIndex) {
    const callable = s.callableSuits || [];
    if (callable.length === 0) {
      msg.dataset.base = '你手中没有级牌，系统自动翻底牌定主';
      msg.textContent = msg.dataset.base;
    } else {
      msg.dataset.base = '请从手中级牌选主花色';
      msg.textContent = msg.dataset.base;
      for (const suit of callable) {
        const b = document.createElement('button');
        b.textContent = SUIT_NAMES[suit] + SUIT_EMOJI[suit];
        b.onclick = () => socket.emit('call_trump', { suit });
        btns.appendChild(b);
      }
    }
    return;
  }

  if (s.state === 'burying' && s.myIndex === s.dealerIndex) {
    msg.dataset.base = `选8张底牌（${selectedCardIds.size}/8）`;
    msg.textContent = msg.dataset.base;
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
    const isLead = s.currentTrick.plays.length === 0;
    msg.dataset.base = isLead ? '请出牌（首攻）' : '请跟牌';
    msg.textContent = msg.dataset.base;
    const b = document.createElement('button');
    b.textContent = '出牌';
    b.onclick = () => {
      const ids = Array.from(selectedCardIds);
      if (ids.length === 0) { alert('请至少选1张'); return; }
      socket.emit('play_cards', { cardIds: ids });
      clearSelection();
    };
    btns.appendChild(b);
    return;
  }

  if (s.state === 'playing') {
    const cur = s.allPlayers.find(p => p.index === s.currentPlayerIndex);
    msg.dataset.base = `等待 ${cur ? cur.name : ''}`;
    msg.textContent = msg.dataset.base;
    return;
  }

  if (s.state === 'ended') {
    msg.dataset.base = '本局已结束';
    msg.textContent = msg.dataset.base;
    return;
  }
  msg.textContent = '';
}

/* 聊天 */
function onChat(data) {
  const box = $('chat-history');
  const line = document.createElement('div');
  line.className = 'chat-line';
  line.innerHTML = `<span class="chat-sender">${data.sender}:</span> ${escapeHtml(data.text)}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}
$('btn-chat').onclick = () => $('chat-panel').classList.toggle('hidden');
$('btn-close-chat').onclick = () => $('chat-panel').classList.add('hidden');
$('btn-send').onclick = sendChat;
$('chat-input').onkeydown = e => { if (e.key === 'Enter') sendChat(); };
function sendChat() {
  const text = $('chat-input').value.trim();
  if (!text) return;
  socket.emit('chat', { text });
  $('chat-input').value = '';
}
function escapeHtml(t) { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* 结算 */
function onGameEnd(res) {
  $('result-text').textContent = res.resultText;
  const myTeam = gameState.myTeam;
  $('result-scores').innerHTML = `
    <div>我方得分：${res.scores[myTeam]}</div>
    <div>对方得分：${res.scores[1-myTeam]}</div>
  `;
  $('result-modal').classList.remove('hidden');
}
$('btn-next').onclick = () => {
  $('result-modal').classList.add('hidden');
  socket.emit('next_game');
};

/* 房间列表 */
function renderRoomList(s) {
  const box = $('players-list');
  box.innerHTML = '';
  for (const p of s.allPlayers) {
    const div = document.createElement('div');
    div.className = 'player-card';
    const readyStr = p.ready ? '✅ 已准备' : '⏳ 未准备';
    const teamStr = p.team === 0 ? 'A队' : 'B队';
    div.innerHTML = `<div class="p-avatar">${p.name[0]}</div><div class="p-name">${p.name}</div><div class="p-status">${readyStr}</div><div class="p-team">${teamStr}</div>`;
    box.appendChild(div);
  }
  const readyCount = s.allPlayers.filter(p => p.ready).length;
  $('room-status').textContent = `当前 ${s.allPlayers.length}/4 人，${readyCount} 人已准备`;
}
