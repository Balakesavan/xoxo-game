// =============================================================
// XOXO MULTIPLAYER TIC TAC TOE — game.js
// All game logic, Firebase sync, and UI state management.
// =============================================================

// ─── Firebase Config Guard ────────────────────────────────────────────────
// Shows a clear error immediately if the user hasn't set up Firebase yet.
function checkFirebaseConfig() {
  const cfg = firebase.app().options;
  if (!cfg.databaseURL || cfg.databaseURL.includes('YOUR_PROJECT_ID')) {
    setStatus('Firebase is not configured. Open firebase-config.js and add your credentials.', 'error');
    return false;
  }
  return true;
}

// Wraps a Firebase promise with a timeout so buttons never hang forever.
function withTimeout(promise, ms = 8000) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Request timed out. Check your Firebase config and internet connection.')), ms)
  );
  return Promise.race([promise, timeout]);
}

// ─── Audio Context (Web Audio API — no external files needed) ─────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioCtx();
  return audioCtx;
}

function playTone(freq, type, duration, volume = 0.3) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (e) { /* silent fail on unsupported browsers */ }
}

const SFX = {
  place:  () => playTone(440, 'sine',    0.12),
  win:    () => { playTone(523, 'sine', 0.15); setTimeout(() => playTone(659, 'sine', 0.15), 150); setTimeout(() => playTone(784, 'sine', 0.3), 300); },
  lose:   () => { playTone(330, 'sawtooth', 0.15); setTimeout(() => playTone(220, 'sawtooth', 0.3), 150); },
  draw:   () => playTone(370, 'triangle', 0.25),
  click:  () => playTone(600, 'sine',    0.08, 0.15),
  join:   () => { playTone(440, 'sine', 0.1); setTimeout(() => playTone(550, 'sine', 0.15), 120); },
};

// ─── Win Combinations ─────────────────────────────────────────────────────
const WIN_COMBOS = [
  [0,1,2],[3,4,5],[6,7,8], // rows
  [0,3,6],[1,4,7],[2,5,8], // cols
  [0,4,8],[2,4,6]          // diagonals
];

// ─── State ────────────────────────────────────────────────────────────────
let state = {
  roomId:      null,
  playerId:    null,  // 'player1' | 'player2'
  playerName:  '',
  roomRef:     null,
  gameData:    null,
  unsubscribe: null,
};

// ─── DOM Helpers ──────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(name).classList.add('active');
}

function setStatus(msg, type = '') {
  const s = $('status-msg');
  s.textContent = msg;
  s.className = 'status-msg' + (type ? ' ' + type : '');
  s.style.opacity = '1';
}

function clearStatus() {
  $('status-msg').style.opacity = '0';
}

function setConnIndicator(online) {
  const dot = $('conn-dot');
  const label = $('conn-label');
  dot.className = 'conn-dot ' + (online ? 'online' : 'offline');
  label.textContent = online ? 'Online' : 'Offline';
}

// ─── Connection Monitor ───────────────────────────────────────────────────
firebase.database().ref('.info/connected').on('value', snap => {
  setConnIndicator(snap.val() === true);
});

// ─── Room ID Generator ────────────────────────────────────────────────────
function genRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ─── CREATE ROOM ──────────────────────────────────────────────────────────
async function createRoom() {
  SFX.click();
  if (!checkFirebaseConfig()) return;
  const name = $('player-name-input').value.trim();
  if (!name) { shakeInput('player-name-input'); return; }

  const btn = $('create-btn');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  const roomId = genRoomId();
  const roomRef = db.ref('rooms/' + roomId);

  const initialData = {
    board:    Array(9).fill(''),
    turn:     'player1',
    status:   'waiting',   // waiting | playing | finished
    winner:   null,
    winLine:  null,
    scores:   { player1: 0, player2: 0, draws: 0 },
    player1:  { name, online: true },
    player2:  null,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
  };

  try {
    await withTimeout(roomRef.set(initialData));

    // Mark host offline on disconnect
    roomRef.child('player1/online').onDisconnect().set(false);

    state.roomId    = roomId;
    state.playerId  = 'player1';
    state.playerName = name;
    state.roomRef   = roomRef;

    $('room-code-display').textContent = roomId;
    showScreen('waiting-screen');
    SFX.join();
    onEnterGame();
    listenToRoom();
  } catch (err) {
    console.error(err);
    setStatus('Failed to create room. Check Firebase config.', 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Create Room';
}

// ─── JOIN ROOM ────────────────────────────────────────────────────────────
async function joinRoom() {
  SFX.click();
  if (!checkFirebaseConfig()) return;
  const name   = $('player-name-input').value.trim();
  const roomId = $('room-id-input').value.trim().toUpperCase();

  if (!name)   { shakeInput('player-name-input'); return; }
  if (!roomId) { shakeInput('room-id-input');     return; }

  const btn = $('join-btn');
  btn.disabled = true;
  btn.textContent = 'Joining…';

  const roomRef = db.ref('rooms/' + roomId);

  try {
    const snap = await withTimeout(roomRef.once('value'));
    const data  = snap.val();

    if (!data) {
      setStatus('Room not found. Check the code.', 'error');
      btn.disabled = false; btn.textContent = 'Join Room';
      shakeInput('room-id-input');
      return;
    }
    if (data.player2) {
      setStatus('Room is full.', 'error');
      btn.disabled = false; btn.textContent = 'Join Room';
      return;
    }
    if (data.status === 'finished') {
      setStatus('Game already ended.', 'error');
      btn.disabled = false; btn.textContent = 'Join Room';
      return;
    }

    await roomRef.child('player2').set({ name, online: true });
    await roomRef.child('status').set('playing');

    roomRef.child('player2/online').onDisconnect().set(false);

    state.roomId     = roomId;
    state.playerId   = 'player2';
    state.playerName = name;
    state.roomRef    = roomRef;

    SFX.join();
    onEnterGame();
    listenToRoom();
  } catch (err) {
    console.error(err);
    setStatus('Error joining room.', 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Join Room';
}

// ─── REALTIME LISTENER ────────────────────────────────────────────────────
function listenToRoom() {
  if (state.unsubscribe) state.unsubscribe();

  const handler = state.roomRef.on('value', snap => {
    const data = snap.val();
    if (!data) { handleRoomDeleted(); return; }
    state.gameData = data;
    renderGame(data);
  });

  state.unsubscribe = () => state.roomRef.off('value', handler);
}

// ─── RENDER GAME ──────────────────────────────────────────────────────────
function renderGame(data) {
  const { board, turn, status, winner, winLine, scores, player1, player2 } = data;
  const me    = state.playerId;
  const other = me === 'player1' ? 'player2' : 'player1';

  // ── Waiting screen ──
  if (status === 'waiting') {
    showScreen('waiting-screen');
    return;
  }

  // ── Game screen ──
  showScreen('game-screen');

  // Player name panels
  $('p1-name').textContent = player1?.name || 'Player 1';
  $('p2-name').textContent = player2?.name || 'Player 2';
  $('p1-score').textContent = scores?.player1 ?? 0;
  $('p2-score').textContent = scores?.player2 ?? 0;
  $('draws-score').textContent = scores?.draws ?? 0;

  // Online indicators
  $('p1-online').className = 'player-online ' + (player1?.online ? 'on' : 'off');
  $('p2-online').className = 'player-online ' + (player2?.online ? 'on' : 'off');

  // Highlight active player
  $('p1-panel').classList.toggle('active-player', turn === 'player1' && status === 'playing');
  $('p2-panel').classList.toggle('active-player', turn === 'player2' && status === 'playing');

  // YOU badge — always present for equal height; text set per player
  [['p1-panel','player1'],['p2-panel','player2']].forEach(([id, pid]) => {
    const panel = $(id);
    let badge = panel.querySelector('.you-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'you-badge';
      panel.insertBefore(badge, panel.firstChild);
    }
    badge.textContent = me === pid ? 'YOU' : '';
  });

  // Room code badge
  $('room-badge').textContent = '# ' + state.roomId;

  // Board
  renderBoard(board, turn, status, winLine, me);

  // Status bar
  if (status === 'playing') {
    if (turn === me) {
      setStatus('Your turn (' + (me === 'player1' ? 'X' : 'O') + ')', 'my-turn');
    } else {
      const oppName = data[other]?.name || 'Opponent';
      setStatus(oppName + "'s turn…");
    }
    $('result-overlay').classList.remove('visible');
  } else if (status === 'finished') {
    showResult(data, me, other);
  }
}

// ─── RENDER BOARD ─────────────────────────────────────────────────────────
let prevBoard = Array(9).fill('');

function renderBoard(board, turn, status, winLine, me) {
  const boardEl = $('board');
  boardEl.innerHTML = '';

  const mySymbol   = me === 'player1' ? 'X' : 'O';
  const canPlay    = status === 'playing' && turn === me;

  board.forEach((cell, i) => {
    const tile = el('div', 'tile');
    tile.dataset.index = i;

    if (cell) {
      tile.classList.add('filled', cell === 'X' ? 'x-tile' : 'o-tile');
      tile.innerHTML = cell === 'X' ? svgX() : svgO();

      // Animate newly placed tile
      if (prevBoard[i] !== cell) {
        tile.classList.add('pop-in');
      }
    } else if (canPlay) {
      tile.classList.add('hoverable');
      tile.innerHTML = `<span class="ghost">${mySymbol === 'X' ? svgX() : svgO()}</span>`;
      tile.addEventListener('click', () => makeMove(i));
    }

    if (winLine && winLine.includes(i)) {
      tile.classList.add('winning-tile');
    }

    boardEl.appendChild(tile);
  });

  prevBoard = [...board];

  // Disabled overlay when not your turn or game over
  boardEl.classList.toggle('board-disabled', !canPlay || status !== 'playing');
}

// ─── MAKE MOVE ────────────────────────────────────────────────────────────
async function makeMove(index) {
  const data = state.gameData;
  if (!data || data.status !== 'playing') return;
  if (data.turn !== state.playerId) return;
  if (data.board[index] !== '') return;

  SFX.place();

  const symbol  = state.playerId === 'player1' ? 'X' : 'O';
  const newBoard = [...data.board];
  newBoard[index] = symbol;

  const { winner, winLine } = checkWinner(newBoard);
  const isDraw = !winner && newBoard.every(c => c !== '');

  const nextTurn = state.playerId === 'player1' ? 'player2' : 'player1';

  const updates = { board: newBoard };

  if (winner) {
    updates.status  = 'finished';
    updates.winner  = state.playerId;
    updates.winLine = winLine;
    const scoreKey  = `scores/${state.playerId}`;
    updates[scoreKey] = (data.scores?.[state.playerId] ?? 0) + 1;
  } else if (isDraw) {
    updates.status = 'finished';
    updates.winner = 'draw';
    updates['scores/draws'] = (data.scores?.draws ?? 0) + 1;
  } else {
    updates.turn = nextTurn;
  }

  try {
    await state.roomRef.update(updates);
  } catch (err) {
    console.error('Move failed:', err);
    setStatus('Move failed — connection issue.', 'error');
  }
}

// ─── WIN DETECTION ────────────────────────────────────────────────────────
function checkWinner(board) {
  for (const combo of WIN_COMBOS) {
    const [a, b, c] = combo;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], winLine: combo };
    }
  }
  return { winner: null, winLine: null };
}

// ─── SHOW RESULT ──────────────────────────────────────────────────────────
function showResult(data, me, other) {
  const overlay = $('result-overlay');
  const title   = $('result-title');
  const sub     = $('result-sub');

  if (data.winner === 'draw') {
    title.textContent = "It's a Draw!";
    sub.textContent   = 'Well played by both sides.';
    title.className   = 'result-title draw';
    SFX.draw();
  } else if (data.winner === me) {
    title.textContent = 'You Win! 🎉';
    sub.textContent   = 'Outstanding move!';
    title.className   = 'result-title win';
    SFX.win();
    launchConfetti();
  } else {
    const oppName = data[other]?.name || 'Opponent';
    title.textContent = oppName + ' Wins!';
    sub.textContent   = 'Better luck next round.';
    title.className   = 'result-title lose';
    SFX.lose();
  }

  overlay.classList.add('visible');
}

// ─── RESTART ──────────────────────────────────────────────────────────────
async function requestRestart() {
  SFX.click();
  if (!state.roomRef || !state.gameData) return;

  await state.roomRef.update({
    board:   Array(9).fill(''),
    turn:    'player1',
    status:  'playing',
    winner:  null,
    winLine: null,
  });

  prevBoard = Array(9).fill(null);
  $('result-overlay').classList.remove('visible');
}

// ─── LEAVE ROOM ───────────────────────────────────────────────────────────
async function leaveRoom() {
  SFX.click();
  stopVoiceChat(true);
  if (state.unsubscribe) state.unsubscribe();

  if (state.roomRef) {
    // If host leaves, delete the room; guest just marks offline
    if (state.playerId === 'player1') {
      await state.roomRef.remove().catch(() => {});
    } else {
      await state.roomRef.child('player2/online').set(false).catch(() => {});
    }
  }

  resetState();
  onExitGame();
  showScreen('lobby-screen');
  clearStatus();
}

function handleRoomDeleted() {
  resetState();
  setStatus('Room was closed by the host.', 'error');
  showScreen('lobby-screen');
}

function resetState() {
  if (state.unsubscribe) state.unsubscribe();
  state = { roomId: null, playerId: null, playerName: '', roomRef: null, gameData: null, unsubscribe: null };
  prevBoard = Array(9).fill(null);
}

// ─── COPY ROOM CODE ───────────────────────────────────────────────────────
function copyRoomCode() {
  SFX.click();
  const code = $('room-code-display').textContent;
  navigator.clipboard.writeText(code).then(() => {
    const btn = $('copy-btn');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy Code', 1500);
  });
}

// ─── SVG SYMBOLS ──────────────────────────────────────────────────────────
function svgX() {
  return `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <line x1="8" y1="8" x2="32" y2="32" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>
    <line x1="32" y1="8" x2="8" y2="32" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>
  </svg>`;
}

function svgO() {
  return `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="20" cy="20" r="12" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>
  </svg>`;
}

// ─── CONFETTI ─────────────────────────────────────────────────────────────
function launchConfetti() {
  const canvas = $('confetti-canvas');
  const ctx    = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.display = 'block';

  const pieces = Array.from({ length: 120 }, () => ({
    x:    Math.random() * canvas.width,
    y:    Math.random() * canvas.height - canvas.height,
    r:    Math.random() * 6 + 4,
    d:    Math.random() * 80 + 40,
    color: `hsl(${Math.random() * 360},80%,60%)`,
    tilt: Math.random() * 10 - 10,
    tiltAngle: 0,
    tiltSpeed: Math.random() * 0.1 + 0.05,
  }));

  let frame = 0;
  const MAX = 200;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      p.tiltAngle += p.tiltSpeed;
      p.y += (Math.cos(frame / p.d) + p.r / 5 + 1.5);
      p.x += Math.sin(frame / 15) * 1.5;
      p.tilt = Math.sin(p.tiltAngle) * 12;
      ctx.beginPath();
      ctx.lineWidth = p.r;
      ctx.strokeStyle = p.color;
      ctx.moveTo(p.x + p.tilt + p.r / 3, p.y);
      ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 4);
      ctx.stroke();
    });
    frame++;
    if (frame < MAX) requestAnimationFrame(draw);
    else { ctx.clearRect(0, 0, canvas.width, canvas.height); canvas.style.display = 'none'; }
  }
  draw();
}

// ─── INPUT SHAKE ANIMATION ────────────────────────────────────────────────
function shakeInput(id) {
  const el = $(id);
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  el.focus();
}

// ─── KEYBOARD SHORTCUTS ───────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const lobbyActive = $('lobby-screen').classList.contains('active');
    if (lobbyActive) {
      const joinInput = $('room-id-input').value.trim();
      if (joinInput) joinRoom();
      else createRoom();
    }
  }
});

// ─── VOICE CHAT (WebRTC + Firebase Signaling) ─────────────────────────────
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

let localStream    = null;
let peerConn       = null;
let isMuted        = false;
let voiceActive    = false;

async function toggleVoiceChat() {
  if (voiceActive) {
    stopVoiceChat();
  } else {
    await startVoiceChat();
  }
}

async function startVoiceChat() {
  try {
    setVoiceDot('connecting');
    setVoiceText('Requesting mic…');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Mic not supported — use Chrome/Firefox on localhost or HTTPS');
    }

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    voiceActive = true;
    updateVoiceUI();

    peerConn = new RTCPeerConnection(RTC_CONFIG);

    // Add local audio tracks
    localStream.getTracks().forEach(t => peerConn.addTrack(t, localStream));

    // Play remote audio when received
    peerConn.ontrack = e => {
      $('remote-audio').srcObject = e.streams[0];
    };

    // Send ICE candidates to Firebase
    peerConn.onicecandidate = async e => {
      if (e.candidate) {
        await state.roomRef.child(`voice/ice_${state.playerId}`).push(e.candidate.toJSON());
      }
    };

    peerConn.onconnectionstatechange = () => {
      const s = peerConn.connectionState;
      if (s === 'connected')    { setVoiceDot('connected');  setVoiceText('Connected'); }
      if (s === 'connecting')   { setVoiceDot('connecting'); setVoiceText('Connecting…'); }
      if (s === 'disconnected') { setVoiceDot('');           setVoiceText('Peer disconnected'); }
      if (s === 'failed')       { stopVoiceChat(); setVoiceText('Connection failed'); }
    };

    if (state.playerId === 'player1') {
      // Host creates the offer
      const offer = await peerConn.createOffer();
      await peerConn.setLocalDescription(offer);
      await state.roomRef.child('voice/offer').set({ type: offer.type, sdp: offer.sdp });

      // Wait for answer from player2
      state.roomRef.child('voice/answer').on('value', async snap => {
        if (snap.val() && peerConn && peerConn.signalingState === 'have-local-offer') {
          await peerConn.setRemoteDescription(new RTCSessionDescription(snap.val()));
        }
      });

      // Receive ICE from player2
      state.roomRef.child('voice/ice_player2').on('child_added', async snap => {
        if (snap.val() && peerConn) await peerConn.addIceCandidate(new RTCIceCandidate(snap.val()));
      });

    } else {
      // Guest waits for offer then answers
      setVoiceText('Waiting for host…');
      state.roomRef.child('voice/offer').on('value', async snap => {
        if (!snap.val() || !peerConn || peerConn.signalingState !== 'stable') return;
        await peerConn.setRemoteDescription(new RTCSessionDescription(snap.val()));
        const answer = await peerConn.createAnswer();
        await peerConn.setLocalDescription(answer);
        await state.roomRef.child('voice/answer').set({ type: answer.type, sdp: answer.sdp });
      });

      // Receive ICE from player1
      state.roomRef.child('voice/ice_player1').on('child_added', async snap => {
        if (snap.val() && peerConn) await peerConn.addIceCandidate(new RTCIceCandidate(snap.val()));
      });
    }

  } catch (err) {
    console.error('Voice chat error:', err);
    const msg = err.name === 'NotAllowedError'
      ? 'Mic access denied — allow mic in browser'
      : (err.message || err.name || 'Voice chat failed');
    setVoiceText(msg);
    setVoiceDot('');
    stopVoiceChat(true);
  }
}

function stopVoiceChat(keepUI = false) {
  if (localStream)  { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (peerConn)     { peerConn.close(); peerConn = null; }
  voiceActive = false;
  isMuted = false;

  // Clean up Firebase signaling data
  if (state.roomRef) state.roomRef.child('voice').remove().catch(() => {});

  if (!keepUI) {
    setVoiceDot('');
    setVoiceText('Voice Chat');
    $('voice-btn').textContent = 'Join Voice';
    $('mute-btn').style.display = 'none';
  }
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  $('mute-btn').textContent = isMuted ? 'Unmute' : 'Mute';
  setVoiceDot(isMuted ? 'muted' : 'connected');
  setVoiceText(isMuted ? 'Muted' : 'Connected');
}

function updateVoiceUI() {
  const btn     = $('voice-btn');
  const muteBtn = $('mute-btn');
  if (!btn) return;
  if (voiceActive) {
    btn.textContent         = 'Leave Voice';
    muteBtn.style.display   = 'inline-flex';
    setVoiceDot('connecting');
    setVoiceText('Connecting…');
  } else {
    btn.textContent         = 'Join Voice';
    muteBtn.style.display   = 'none';
  }
}

function setVoiceDot(state) {
  const dot = $('voice-dot');
  if (dot) dot.className = 'voice-dot ' + state;
}

function setVoiceText(msg) {
  const el = $('voice-status-text');
  if (el) el.textContent = msg;
}

// ─── AVAILABLE ROOMS BROWSER ──────────────────────────────────────────────
function listenToAvailableRooms() {
  const roomsRef = db.ref('rooms');

  roomsRef.on('value', snap => {
    const data = snap.val();
    const list = $('rooms-list');
    const count = $('rooms-count');

    if (!list) return;

    const openRooms = [];
    if (data) {
      Object.entries(data).forEach(([id, room]) => {
        if (room.status === 'waiting' && room.player1) {
          openRooms.push({ id, host: room.player1.name });
        }
      });
    }

    if (openRooms.length === 0) {
      count.textContent = 'No open rooms';
      list.innerHTML = '<div class="rooms-empty">No open rooms yet. Create one!</div>';
      return;
    }

    count.textContent = openRooms.length + ' open';
    list.innerHTML = '';

    openRooms.forEach(({ id, host }) => {
      const item = el('div', 'room-item');
      item.innerHTML = `
        <div class="room-item-info">
          <span class="room-item-host">${escapeHtml(host)}'s Room</span>
          <span class="room-item-code"># ${id}</span>
        </div>
        <button class="btn btn-secondary" onclick="quickJoin('${id}')">Join</button>
      `;
      list.appendChild(item);
    });
  });
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function quickJoin(roomId) {
  SFX.click();
  const name = $('player-name-input').value.trim();
  if (!name) { shakeInput('player-name-input'); setStatus('Enter your name first!', 'error'); return; }

  // Pre-fill the code input and call joinRoom
  $('room-id-input').value = roomId;
  await joinRoom();
}

// Start listening to available rooms on page load
listenToAvailableRooms();

// ─── LOBBY CHAT & ONLINE PRESENCE ────────────────────────────────────────
let lobbyUserId   = null;   // unique key for this browser session
let lobbyUserName = '';

function initLobby() {
  lobbyUserId = db.ref('lobby/online').push().key; // generate unique ID

  // Listen to online users
  db.ref('lobby/online').on('value', snap => {
    const data = snap.val() || {};
    const users = Object.values(data).filter(u => u && u.name);
    $('online-num').textContent = users.length;

    const list = $('online-list');
    list.innerHTML = '';
    users.forEach(u => {
      const chip = el('div', 'online-user-chip');
      chip.innerHTML = `<span class="dot"></span>${escapeHtml(u.name)}`;
      list.appendChild(chip);
    });
  });

  // Listen to chat messages (last 60)
  db.ref('lobby/messages').limitToLast(60).on('child_added', snap => {
    const msg = snap.val();
    if (!msg) return;
    appendChatMessage(msg);
  });

  // Chat input — send on Enter
  $('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChat();
  });
}

function setLobbyPresence(name) {
  if (!name || !lobbyUserId) return;
  if (name === lobbyUserName) return; // no change
  lobbyUserName = name;

  const ref = db.ref(`lobby/online/${lobbyUserId}`);
  ref.set({ name });
  ref.onDisconnect().remove();
}

function removeLobbyPresence() {
  if (!lobbyUserId) return;
  db.ref(`lobby/online/${lobbyUserId}`).remove().catch(() => {});
  lobbyUserName = '';
}

async function sendChat() {
  const input = $('chat-input');
  const text  = input.value.trim();
  if (!text) return;

  const name = $('player-name-input').value.trim();
  if (!name) { shakeInput('player-name-input'); setStatus('Enter your name to chat.', 'error'); return; }

  setLobbyPresence(name);
  input.value = '';

  await db.ref('lobby/messages').push({
    name,
    text,
    uid:  lobbyUserId,
    time: firebase.database.ServerValue.TIMESTAMP,
  });
}

function appendChatMessage(msg) {
  const box   = $('chat-messages');
  const isMe  = msg.uid === lobbyUserId;

  const div   = el('div', 'chat-msg');
  const ts    = msg.time ? new Date(msg.time).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '';

  div.innerHTML = `
    <div class="chat-msg-header">
      <span class="chat-msg-name${isMe ? ' is-me' : ''}">${escapeHtml(msg.name)}</span>
      <span class="chat-msg-time">${ts}</span>
    </div>
    <div class="chat-msg-text">${escapeHtml(msg.text)}</div>
  `;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

// Update presence whenever name changes
$('player-name-input').addEventListener('input', function() {
  const name = this.value.trim();
  if (name.length >= 2) setLobbyPresence(name);
});

// Remove presence when entering a game room
const _origCreateRoom = createRoom;
const _origJoinRoom   = joinRoom;
// Wrapped below in their existing functions — instead patch via leaveRoom restore
function onEnterGame()  { removeLobbyPresence(); }
function onExitGame()   { const name = $('player-name-input').value.trim(); if (name) setLobbyPresence(name); }

// Init lobby on load
initLobby();

// ─── INPUT FORMATTING ─────────────────────────────────────────────────────
$('room-id-input').addEventListener('input', function() {
  this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
