const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { GameRoom, SUIT_NAMES } = require('./game');

const app = express();
app.use(cors());
app.use(express.static('public'));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

const rooms = new Map();
const bots = new Map(); // playerId -> { name, roomId }

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new GameRoom(roomId));
  return rooms.get(roomId);
}

function addBot(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.players.length >= 4) return null;
  const botId = 'bot-' + Math.random().toString(36).substr(2, 9);
  const botNum = room.players.filter(p => p.id.startsWith('bot-')).length + 1;
  const botName = '机器人' + botNum;
  room.addPlayer(botId, botName);
  room.setReady(botId, true);
  bots.set(botId, { name: botName, roomId });
  return { botId, botName };
}

function checkBotAction(room) {
  if (!room) return;
  setTimeout(() => {
    if (room.state === 'calling') {
      const p = room.players[room.dealerIndex];
      if (p && bots.has(p.id)) botAct(room, p.id);
    } else if (room.state === 'burying') {
      const p = room.players[room.dealerIndex];
      if (p && bots.has(p.id)) botAct(room, p.id);
    } else if (room.state === 'playing') {
      const p = room.players[room.currentPlayerIndex];
      if (p && bots.has(p.id)) botAct(room, p.id);
    }
  }, 800);
}

function botAct(room, botId) {
  const bot = room.players.find(p => p.id === botId);
  if (!bot) return;

  if (room.state === 'calling' && bot.index === room.dealerIndex) {
    // 选主：只能选手牌中有的级牌花色
    const callable = room.getCallableSuits(bot.index);
    if (callable.length > 0) {
      // 选级牌最多的花色
      const suitCount = {};
      for (const c of bot.cards) {
        if (c.value === room.trumpRankValue && c.suit !== 'joker') {
          suitCount[c.suit] = (suitCount[c.suit] || 0) + 1;
        }
      }
      const bestSuit = callable.sort((a,b) => (suitCount[b]||0) - (suitCount[a]||0))[0];
      if (room.callTrump(bot.index, bestSuit)) {
        io.to(room.roomId).emit('chat_msg', { sender: '系统', text: `${bot.name} 亮主：${SUIT_NAMES[bestSuit] || bestSuit}（亮了${room.trumpRankValue}）` });
        broadcastRoomState(room);
        startTurnTimer(room);
        checkBotAction(room);
      }
    } else {
      // 无级牌，自动定主
      const auto = room.autoCallTrump();
      if (auto) {
        io.to(room.roomId).emit('chat_msg', { sender: '系统', text: `庄家无级牌，翻开底牌定主：${SUIT_NAMES[auto.suit] || auto.suit}` });
        broadcastRoomState(room);
        startTurnTimer(room);
        checkBotAction(room);
      }
    }
    return;
  }

  if (room.state === 'burying' && bot.index === room.dealerIndex) {
    const ids = bot.cards.slice(-8).map(c => c.id);
    if (room.buryCards(bot.index, ids)) {
      io.to(room.roomId).emit('chat_msg', { sender: '系统', text: `${bot.name} 已扣底` });
      broadcastRoomState(room);
      startTurnTimer(room);
      checkBotAction(room);
    }
    return;
  }

  if (room.state === 'playing' && bot.index === room.currentPlayerIndex) {
    const res = room.autoPlay(bot.index);
    if (res.success) {
      if (res.type === 'play_ok') {
        broadcastRoomState(room);
        startTurnTimer(room);
        checkBotAction(room);
      } else if (res.type === 'trick_end') {
        handleTrickEnd(room, res);
        if (!res.isGameEnd) checkBotAction(room);
      }
    }
    return;
  }
}

function broadcastRoomState(room) {
  for (const p of room.players) {
    const ps = room.getStateForPlayer(p.id);
    const socket = io.sockets.sockets.get(p.id);
    if (socket) socket.emit('game_state', ps);
  }
}

function clearTurnTimer(room) {
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
}

function startTurnTimer(room) {
  clearTurnTimer(room);
  if (room.state !== 'playing' && room.state !== 'burying') return;
  const seconds = room.state === 'burying' ? 40 : 15;
  room.turnDeadline = Date.now() + seconds * 1000;
  room.turnTimer = setTimeout(() => {
    if (room.state === 'burying') {
      // 超时埋底：随机选8张
      const p = room.players[room.dealerIndex];
      const ids = p.cards.slice(0, 8).map(c => c.id);
      room.buryCards(room.dealerIndex, ids);
      io.to(room.roomId).emit('chat_msg', { sender: '系统', text: '庄家埋底超时，系统自动扣底' });
    } else if (room.state === 'playing') {
      const p = room.players[room.currentPlayerIndex];
      const res = room.autoPlay(room.currentPlayerIndex);
      if (res.success) {
        if (res.type === 'play_ok') {
          broadcastRoomState(room);
        } else if (res.type === 'trick_end') {
          handleTrickEnd(room, res);
        }
      }
    }
  }, seconds * 1000);
}

function handleTrickEnd(room, res) {
  const winnerName = room.players[res.winnerIndex].name;
  let msg = `本墩 ${winnerName} 获胜`;
  if (res.trickScore > 0) msg += `，抢到 ${res.trickScore} 分`;
  if (res.isGameEnd && res.bottomScore > 0) msg += `。底牌 ${res.bottomScore} 分 ×${res.bottomMultiplier}`;
  io.to(room.roomId).emit('chat_msg', { sender: '系统', text: msg });
  broadcastRoomState(room);
  if (res.isGameEnd) {
    const result = room.getGameResult();
    io.to(room.roomId).emit('chat_msg', { sender: '系统', text: result.resultText });
    io.to(room.roomId).emit('game_end', result);
    clearTurnTimer(room);
  } else {
    startTurnTimer(room);
  }
}

io.on('connection', (socket) => {
  let currentRoomId = null;

  socket.on('join_room', ({ roomId, playerName }) => {
    const rid = String(roomId).trim().toUpperCase();
    if (!rid) return;
    const room = getOrCreateRoom(rid);
    if (room.players.length >= 4) { socket.emit('error_msg', '房间已满'); return; }
    if (room.state !== 'waiting' && !room.players.find(p => p.id === socket.id)) {
      socket.emit('error_msg', '游戏已开始'); return;
    }
    socket.join(rid); currentRoomId = rid;
    room.addPlayer(socket.id, playerName || '玩家' + (room.players.length));
    socket.emit('joined', { roomId: rid, myId: socket.id });
    broadcastRoomState(room);
    io.to(rid).emit('chat_msg', { sender: '系统', text: `${playerName || '新玩家'} 加入` });
  });

  socket.on('ready', ({ ready }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    room.setReady(socket.id, ready);
    broadcastRoomState(room);
  });

  socket.on('add_bot', () => {
    console.log('收到 add_bot 请求', socket.id, currentRoomId);
    if (!currentRoomId) { console.log('无 currentRoomId'); return; }
    const room = rooms.get(currentRoomId);
    if (!room) { console.log('无房间'); return; }
    console.log('房主判断', room.players[0]?.id, socket.id);
    if (room.players[0]?.id !== socket.id) { socket.emit('error_msg', '只有房主可添加机器人'); return; }
    const bot = addBot(currentRoomId);
    console.log('addBot 结果', bot);
    if (bot) {
      io.to(currentRoomId).emit('chat_msg', { sender: '系统', text: `${bot.botName} 加入房间` });
      broadcastRoomState(room);
    } else {
      socket.emit('error_msg', '房间已满');
    }
  });

  socket.on('start_game', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (room.players[0]?.id !== socket.id) { socket.emit('error_msg', '只有房主可开始'); return; }
    if (room.startGame()) {
      io.to(currentRoomId).emit('chat_msg', { sender: '系统', text: `游戏开始！庄家：${room.players[room.dealerIndex].name}，打 ${room.currentLevel}` });
      // 检查庄家是否有级牌可亮
      const callable = room.getCallableSuits(room.dealerIndex);
      if (callable.length === 0) {
        const auto = room.autoCallTrump();
        if (auto) {
          io.to(currentRoomId).emit('chat_msg', { sender: '系统', text: `庄家无级牌，翻开底牌定主：${SUIT_NAMES[auto.suit] || auto.suit}` });
        }
      }
      broadcastRoomState(room);
      startTurnTimer(room);
      checkBotAction(room);
    } else {
      socket.emit('error_msg', '需要4人准备');
    }
  });

  socket.on('call_trump', ({ suit }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const p = room.players.find(p => p.id === socket.id);
    if (!p) return;
    if (room.callTrump(p.index, suit)) {
      io.to(currentRoomId).emit('chat_msg', { sender: '系统', text: `${p.name} 亮主：${SUIT_NAMES[suit] || suit}（亮了${room.trumpRankValue}）` });
      broadcastRoomState(room);
      startTurnTimer(room);
      checkBotAction(room);
    } else {
      socket.emit('error_msg', '无法亮主：你手中没有该花色的级牌');
    }
  });

  socket.on('bury_cards', ({ cardIds }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const p = room.players.find(p => p.id === socket.id);
    if (!p) return;
    if (room.buryCards(p.index, cardIds)) {
      io.to(currentRoomId).emit('chat_msg', { sender: '系统', text: `${p.name} 已扣底` });
      broadcastRoomState(room);
      startTurnTimer(room);
      checkBotAction(room);
    } else {
      socket.emit('error_msg', '扣底失败，选8张');
    }
  });

  socket.on('play_cards', ({ cardIds }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const p = room.players.find(p => p.id === socket.id);
    if (!p) return;
    const check = room.canPlayCards(p.index, cardIds);
    if (!check.ok) {
      socket.emit('error_msg', '出牌不合法：' + check.reason);
      return;
    }
    const res = room.playCards(p.index, cardIds);
    if (!res.success) {
      socket.emit('error_msg', '出牌失败');
      return;
    }
    if (res.type === 'play_ok') {
      clearTurnTimer(room);
      broadcastRoomState(room);
      startTurnTimer(room);
      checkBotAction(room);
    } else if (res.type === 'trick_end') {
      clearTurnTimer(room);
      handleTrickEnd(room, res);
    }
  });

  socket.on('chat', ({ text }) => {
    if (!currentRoomId || !text) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const p = room.players.find(p => p.id === socket.id);
    const name = p ? p.name : '未知';
    room.addChat(name, text);
    io.to(currentRoomId).emit('chat_msg', { sender: name, text });
  });

  socket.on('next_game', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (room.players[0]?.id !== socket.id) return;
    const res = room.getGameResult();
    room.dealerIndex = res.nextDealer;
    room.currentLevel = res.nextLevel;
    room.players.forEach(p => p.ready = false);
    room.state = 'waiting';
    io.to(currentRoomId).emit('chat_msg', { sender: '系统', text: '----- 准备下一局 -----' });
    broadcastRoomState(room);
  });

  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const p = room.players.find(p => p.id === socket.id);
    if (p) {
      io.to(currentRoomId).emit('chat_msg', { sender: '系统', text: `${p.name} 离开` });
      if (room.state === 'waiting') room.removePlayer(socket.id);
      else p.name = p.name + '(离线)';
      broadcastRoomState(room);
    }
    if (room.players.length === 0) rooms.delete(currentRoomId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`服务器运行在端口 ${PORT}`));
