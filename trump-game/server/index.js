const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { GameRoom } = require('./game');

const app = express();
app.use(cors());
app.use(express.static('public'));
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const rooms = new Map(); // roomId -> GameRoom

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new GameRoom(roomId));
  }
  return rooms.get(roomId);
}

function broadcastRoomState(room) {
  const stateAll = room.getStateForPlayer(null);
  // 给每个玩家发包含自己手牌的完整状态
  for (const p of room.players) {
    const ps = room.getStateForPlayer(p.id);
    const socket = io.sockets.sockets.get(p.id);
    if (socket) {
      socket.emit('game_state', ps);
    }
  }
  // 给观战者发（如果有）
  io.to(room.roomId).except(room.players.map(p => p.id)).emit('game_state', {
    ...stateAll,
    myCards: [],
    myIndex: -1,
    myTeam: -1,
    players: room.players.map(p => ({ id: p.id, name: p.name, index: p.index, team: p.team, cardCount: p.cards.length, ready: p.ready }))
  });
}

io.on('connection', (socket) => {
  console.log('connect:', socket.id);
  let currentRoomId = null;

  socket.on('join_room', ({ roomId, playerName }) => {
    const rid = String(roomId).trim().toUpperCase();
    if (!rid) return;
    
    const room = getOrCreateRoom(rid);
    if (room.players.length >= 4) {
      socket.emit('error_msg', '房间已满');
      return;
    }
    if (room.state !== 'waiting' && !room.players.find(p => p.id === socket.id)) {
      socket.emit('error_msg', '游戏已开始，无法加入');
      return;
    }

    socket.join(rid);
    currentRoomId = rid;
    
    const added = room.addPlayer(socket.id, playerName || '玩家' + (room.players.length));
    if (!added) {
      // 可能是重连，更新名字
      const p = room.players.find(p => p.id === socket.id);
      if (p) p.name = playerName || p.name;
    }
    
    socket.emit('joined', { roomId: rid, myId: socket.id });
    broadcastRoomState(room);
    
    // 系统消息
    io.to(rid).emit('chat_msg', { sender: '系统', text: `${playerName || '新玩家'} 加入了房间` });
  });

  socket.on('ready', ({ ready }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const p = room.players.find(p => p.id === socket.id);
    if (!p) return;
    room.setReady(socket.id, ready);
    broadcastRoomState(room);
  });

  socket.on('start_game', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (room.players[0]?.id !== socket.id) {
      socket.emit('error_msg', '只有房主可以开始游戏');
      return;
    }
    if (room.startGame()) {
      io.to(currentRoomId).emit('chat_msg', { sender: '系统', text: `游戏开始！庄家：${room.players[room.dealerIndex].name}，打 ${room.currentLevel}` });
      broadcastRoomState(room);
    } else {
      socket.emit('error_msg', '需要4人全部准备才能开始');
    }
  });

  socket.on('call_trump', ({ suit }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const p = room.players.find(p => p.id === socket.id);
    if (!p) return;
    if (room.callTrump(p.index, suit)) {
      io.to(currentRoomId).emit('chat_msg', { sender: '系统', text: `${p.name} 选择了主花色 ${suit}` });
      broadcastRoomState(room);
    }
  });

  socket.on('bury_cards', ({ cardIds }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const p = room.players.find(p => p.id === socket.id);
    if (!p) return;
    if (room.buryCards(p.index, cardIds)) {
      io.to(currentRoomId).emit('chat_msg', { sender: '系统', text: `${p.name} 已完成扣底，开始出牌！` });
      broadcastRoomState(room);
    } else {
      socket.emit('error_msg', '扣底失败，请选择8张牌');
    }
  });

  socket.on('play_card', ({ cardId }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const p = room.players.find(p => p.id === socket.id);
    if (!p) return;
    
    const result = room.playCard(p.index, cardId);
    if (!result) {
      socket.emit('error_msg', '出牌不合法');
      return;
    }
    
    if (result.type === 'play_ok') {
      broadcastRoomState(room);
    } else if (result.type === 'trick_end') {
      const winnerName = room.players[result.winnerIndex].name;
      let msg = `本墩 ${winnerName} 获胜`;
      if (result.trickScore > 0) msg += `，抢到 ${result.trickScore} 分`;
      if (result.isGameEnd) {
        if (result.bottomScore > 0) msg += `。底牌 ${result.bottomScore} 分 ×${result.bottomMultiplier} 计入`;
      }
      io.to(currentRoomId).emit('chat_msg', { sender: '系统', text: msg });
      broadcastRoomState(room);
      
      if (result.isGameEnd) {
        const res = room.getGameResult();
        io.to(currentRoomId).emit('chat_msg', { sender: '系统', text: res.resultText });
        io.to(currentRoomId).emit('game_end', res);
      }
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
    console.log('disconnect:', socket.id);
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const p = room.players.find(p => p.id === socket.id);
    if (p) {
      io.to(currentRoomId).emit('chat_msg', { sender: '系统', text: `${p.name} 离开了房间` });
      // 游戏进行中离开，先不删除，标记离线，简化处理
      if (room.state === 'waiting') {
        room.removePlayer(socket.id);
      } else {
        p.name = p.name + '(离线)';
      }
      broadcastRoomState(room);
    }
    if (room.players.length === 0) {
      rooms.delete(currentRoomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`升级游戏服务器运行在端口 ${PORT}`);
});
