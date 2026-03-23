// ─── CONFIG ───────────────────────────────────────────────────────────────────
const WORLD_W = 900, WORLD_H = 500;
const GRAVITY = 0.55, JUMP_FORCE = -13, MOVE_SPEED = 4.5;
const ATTACK_RANGE = 60, ATTACK_DAMAGE = 15, SPECIAL_DAMAGE = 30;
const MAX_HP = 100, RESPAWN_TIME = 2500;
const PLAYER_COLORS = ['#e63946','#4cc9f0','#ffd166','#06d6a0','#ff6b6b','#c77dff','#ff9f1c','#2ec4b6'];

// ─── PLATFORMS ────────────────────────────────────────────────────────────────
const PLATFORMS = [
  { x: 0,    y: 460, w: 900, h: 40 },   // ground
  { x: 80,   y: 350, w: 160, h: 18 },
  { x: 340,  y: 310, w: 220, h: 18 },
  { x: 660,  y: 350, w: 160, h: 18 },
  { x: 180,  y: 230, w: 140, h: 18 },
  { x: 560,  y: 230, w: 140, h: 18 },
  { x: 370,  y: 160, w: 160, h: 18 },
  { x: 30,   y: 140, w: 100, h: 18 },
  { x: 770,  y: 140, w: 100, h: 18 },
];

// ─── STATE ────────────────────────────────────────────────────────────────────
let ws = null, myId = null, myColor = '#e63946', myName = 'Ninja';
let players = {};   // id -> playerState
let particles = []; // visual effects
let kills = 0, deaths = 0;
let keys = {};
let animFrame = 0;
let lastSent = 0;
let roomId = '';

// ─── CANVAS SETUP ─────────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const container = document.getElementById('canvas-container');
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
}
window.addEventListener('resize', resizeCanvas);

// ─── LOBBY UI ─────────────────────────────────────────────────────────────────
const colorPicker = document.getElementById('colorPicker');
PLAYER_COLORS.forEach((c, i) => {
  const btn = document.createElement('button');
  btn.className = 'color-btn' + (i === 0 ? ' selected' : '');
  btn.style.background = c;
  btn.onclick = () => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    myColor = c;
  };
  colorPicker.appendChild(btn);
});

document.getElementById('joinBtn').onclick = () => {
  const name = document.getElementById('nameInput').value.trim() || 'Ninja_' + Math.floor(Math.random()*900+100);
  const room = document.getElementById('roomInput').value.trim() || 'room-' + Math.random().toString(36).slice(2,6);
  myName = name;
  roomId = room;
  connect(room, name);
};
document.getElementById('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('joinBtn').click(); });

function setStatus(msg, type='') {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.className = type;
}

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────
function connect(room, name) {
  setStatus('Connecting…', '');
  document.getElementById('joinBtn').disabled = true;

  // Use the Cloudflare Worker URL (set via build or env)
  const wsUrl = window.WS_URL || `wss://${location.hostname.replace('pages.dev','workers.dev')}/ws?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}&color=${encodeURIComponent(myColor)}`;

  try { ws = new WebSocket(wsUrl); } catch(e) {
    setStatus('Connection failed: ' + e.message, 'error');
    document.getElementById('joinBtn').disabled = false;
    return;
  }

  ws.onopen = () => {
    setStatus('Connected!', 'ok');
    showGame(room);
  };

  ws.onmessage = (e) => {
    try { handleMessage(JSON.parse(e.data)); } catch(_) {}
  };

  ws.onclose = () => {
    setStatus('Disconnected. Reload to reconnect.', 'error');
  };

  ws.onerror = () => {
    setStatus('Could not reach server. Check WS_URL in config.js', 'error');
    document.getElementById('joinBtn').disabled = false;
    showLobby();
  };
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function handleMessage(msg) {
  switch(msg.type) {
    case 'init':
      myId = msg.id;
      players = {};
      msg.players.forEach(p => {
        players[p.id] = createPlayerState(p);
      });
      if (!players[myId]) players[myId] = createMyPlayer();
      break;

    case 'player_join':
      if (msg.id !== myId) players[msg.id] = createPlayerState(msg);
      break;

    case 'player_leave':
      delete players[msg.id];
      break;

    case 'state':
      // server broadcasts all player positions
      msg.players.forEach(p => {
        if (p.id === myId) return; // skip self (we predict locally)
        if (!players[p.id]) players[p.id] = createPlayerState(p);
        else {
          const pl = players[p.id];
          pl.x = p.x; pl.y = p.y;
          pl.vx = p.vx || 0; pl.vy = p.vy || 0;
          pl.facing = p.facing || 1;
          pl.action = p.action || 'idle';
          pl.hp = p.hp;
          pl.dead = p.dead || false;
          pl.name = p.name;
          pl.color = p.color;
        }
      });
      document.getElementById('playerCount').textContent = msg.players.length + ' fighter' + (msg.players.length!==1?'s':'');
      break;

    case 'hit':
      if (msg.targetId === myId) {
        const me = players[myId];
        if (me) {
          me.hp = Math.max(0, me.hp - msg.dmg);
          spawnParticles(me.x, me.y, '#ffffff', 8);
          if (me.hp <= 0) die();
        }
      } else {
        const victim = players[msg.targetId];
        if (victim) {
          victim.hp = Math.max(0, victim.hp - msg.dmg);
          spawnParticles(victim.x, victim.y, msg.color || '#fff', 6);
        }
      }
      break;

    case 'kill':
      if (msg.killerId === myId) { kills++; updateScore(); }
      if (msg.victimId === myId) { deaths++; }
      spawnParticles(msg.x || 450, msg.y || 300, '#ffd166', 20);
      break;

    case 'respawn':
      if (msg.id === myId) {
        const me = players[myId];
        if (me) { me.x=msg.x; me.y=msg.y; me.hp=MAX_HP; me.dead=false; me.vx=0; me.vy=0; }
      } else if (players[msg.id]) {
        players[msg.id].x=msg.x; players[msg.id].y=msg.y;
        players[msg.id].hp=MAX_HP; players[msg.id].dead=false;
      }
      break;
  }
}

// ─── PLAYER STATE ─────────────────────────────────────────────────────────────
function createPlayerState(p) {
  return {
    id: p.id, name: p.name || 'Ninja', color: p.color || '#e63946',
    x: p.x || 450, y: p.y || 380, vx: 0, vy: 0,
    hp: p.hp ?? MAX_HP, dead: p.dead || false,
    facing: 1, action: 'idle',
    attackTimer: 0, attackCooldown: 0,
    jumpCount: 0, onGround: false,
    specialCooldown: 0,
  };
}
function createMyPlayer() {
  return createPlayerState({ id: myId, name: myName, color: myColor, x: 100 + Math.random()*700, y: 380 });
}

// ─── SHOW/HIDE ────────────────────────────────────────────────────────────────
function showGame(room) {
  document.getElementById('lobby').style.display = 'none';
  const gw = document.getElementById('game-wrapper');
  gw.style.display = 'flex';
  document.getElementById('roomDisplay').textContent = '# ' + room;
  resizeCanvas();
  startGameLoop();
  setupInput();
}
function showLobby() {
  document.getElementById('lobby').style.display = 'flex';
  document.getElementById('game-wrapper').style.display = 'none';
  document.getElementById('joinBtn').disabled = false;
}
function updateScore() {
  document.getElementById('myScore').textContent = `K:${kills} D:${deaths}`;
}

// ─── INPUT ────────────────────────────────────────────────────────────────────
function setupInput() {
  document.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['KeyJ','KeyZ'].includes(e.code)) doAttack(false);
    if (['KeyK','KeyX'].includes(e.code)) doAttack(true);
    if (['Space','ArrowUp','KeyW'].includes(e.code)) e.preventDefault();
  });
  document.addEventListener('keyup', e => { keys[e.code] = false; });
}

// ─── ATTACK ───────────────────────────────────────────────────────────────────
function doAttack(special) {
  const me = players[myId];
  if (!me || me.dead) return;
  if (special && me.specialCooldown > 0) return;
  if (!special && me.attackCooldown > 0) return;

  if (special) { me.specialCooldown = 90; me.action = 'special'; }
  else { me.attackCooldown = 25; me.action = 'attack'; }

  const dmg = special ? SPECIAL_DAMAGE : ATTACK_DAMAGE;
  const range = special ? ATTACK_RANGE * 1.5 : ATTACK_RANGE;

  // Check hits
  Object.values(players).forEach(p => {
    if (p.id === myId || p.dead) return;
    const dx = p.x - me.x, dy = p.y - me.y;
    const dist = Math.hypot(dx, dy);
    if (dist < range && Math.sign(dx) === me.facing) {
      send({ type: 'attack', targetId: p.id, dmg, x: p.x, y: p.y, color: myColor, special });
      spawnParticles(p.x, p.y - 20, special ? '#ffd166' : myColor, special ? 14 : 8);
    }
  });

  spawnParticles(me.x + me.facing * 35, me.y, special ? '#ffd166' : myColor, special ? 10 : 5);
  me.attackTimer = special ? 20 : 12;
}

function die() {
  const me = players[myId];
  if (!me || me.dead) return;
  me.dead = true;
  me.hp = 0;
  spawnParticles(me.x, me.y, myColor, 25);
  deaths++;
  updateScore();
  send({ type: 'died', x: me.x, y: me.y });
  setTimeout(() => {
    const spawnX = 100 + Math.random() * 700;
    const spawnY = 380;
    me.x = spawnX; me.y = spawnY; me.hp = MAX_HP;
    me.dead = false; me.vx = 0; me.vy = 0;
    send({ type: 'respawn', x: spawnX, y: spawnY });
  }, RESPAWN_TIME);
}

// ─── PARTICLES ────────────────────────────────────────────────────────────────
function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 5;
    particles.push({
      x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed - 2,
      life: 1, color, size: 2 + Math.random()*3
    });
  }
}

// ─── PHYSICS ──────────────────────────────────────────────────────────────────
function updatePhysics(p, dt) {
  if (p.dead) return;
  p.vy += GRAVITY;
  p.x += p.vx;
  p.y += p.vy;
  p.onGround = false;

  PLATFORMS.forEach(pl => {
    if (p.x + 12 > pl.x && p.x - 12 < pl.x + pl.w &&
        p.y + 24 > pl.y && p.y + 24 < pl.y + pl.h + Math.abs(p.vy) + 2 &&
        p.vy >= 0) {
      p.y = pl.y - 24;
      p.vy = 0;
      p.onGround = true;
      p.jumpCount = 0;
    }
  });

  if (p.x < 16) { p.x = 16; p.vx = 0; }
  if (p.x > WORLD_W - 16) { p.x = WORLD_W - 16; p.vx = 0; }
  if (p.y > WORLD_H + 100) {
    if (p.id === myId) die();
    else { p.y = 380; p.x = 450; p.vy = 0; }
  }
}

function handleInput() {
  const me = players[myId];
  if (!me || me.dead) return;

  const left = keys['ArrowLeft'] || keys['KeyA'];
  const right = keys['ArrowRight'] || keys['KeyD'];
  const jump = keys['ArrowUp'] || keys['KeyW'] || keys['Space'];

  if (left)  { me.vx = -MOVE_SPEED; me.facing = -1; me.action = 'run'; }
  else if (right) { me.vx = MOVE_SPEED; me.facing = 1; me.action = 'run'; }
  else { me.vx *= 0.7; if (Math.abs(me.vx) < 0.3) me.vx = 0; }

  if (jump && !keys['_jumpHeld'] && me.jumpCount < 2) {
    me.vy = JUMP_FORCE * (me.jumpCount === 1 ? 0.85 : 1);
    me.jumpCount++;
    keys['_jumpHeld'] = true;
    spawnParticles(me.x, me.y + 20, '#4cc9f0', 5);
  }
  if (!jump) keys['_jumpHeld'] = false;

  if (me.attackCooldown > 0) me.attackCooldown--;
  if (me.specialCooldown > 0) me.specialCooldown--;
  if (me.attackTimer > 0) { me.attackTimer--; me.action = 'attack'; }
  else if (me.vx === 0 && me.vy === 0) me.action = 'idle';
  else if (!me.onGround) me.action = 'jump';
  else if (me.vx !== 0) me.action = 'run';
  else me.action = 'idle';
}

// ─── NETWORK SEND ─────────────────────────────────────────────────────────────
function sendState() {
  const me = players[myId];
  if (!me || !ws) return;
  const now = Date.now();
  if (now - lastSent < 50) return; // 20hz
  lastSent = now;
  send({
    type: 'move',
    x: Math.round(me.x), y: Math.round(me.y),
    vx: +me.vx.toFixed(2), vy: +me.vy.toFixed(2),
    facing: me.facing, action: me.action,
    hp: me.hp, dead: me.dead
  });
}

// ─── DRAW ─────────────────────────────────────────────────────────────────────
const SCALE_X = () => canvas.width / WORLD_W;
const SCALE_Y = () => canvas.height / WORLD_H;

function wx(x) { return x * SCALE_X(); }
function wy(y) { return y * SCALE_Y(); }
function ws_(w) { return w * SCALE_X(); }
function hs_(h) { return h * SCALE_Y(); }

function drawBackground() {
  ctx.fillStyle = '#080810';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Stars
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  for (let i = 0; i < 80; i++) {
    const sx = ((i * 137.5) % WORLD_W);
    const sy = ((i * 79.3) % (WORLD_H * 0.7));
    ctx.fillRect(wx(sx), wy(sy), 1, 1);
  }

  // Moon
  ctx.fillStyle = 'rgba(200,210,240,0.15)';
  ctx.beginPath();
  ctx.arc(wx(800), wy(70), ws_(55), 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = '#080810';
  ctx.beginPath();
  ctx.arc(wx(780), wy(60), ws_(48), 0, Math.PI*2);
  ctx.fill();
}

function drawPlatforms() {
  PLATFORMS.forEach((p, i) => {
    const isGround = i === 0;
    ctx.fillStyle = isGround ? '#1a1a2e' : '#16213e';
    ctx.strokeStyle = isGround ? '#2a2a4e' : '#0f3460';
    ctx.lineWidth = 1;
    const r = 3;
    const x = wx(p.x), y = wy(p.y), w = ws_(p.w), h = hs_(p.h);
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
    ctx.arcTo(x+w,y,x+w,y+r,r); ctx.lineTo(x+w,y+h-r);
    ctx.arcTo(x+w,y+h,x+w-r,y+h,r); ctx.lineTo(x+r,y+h);
    ctx.arcTo(x,y+h,x,y+h-r,r); ctx.lineTo(x,y+r);
    ctx.arcTo(x,y,x+r,y,r); ctx.closePath();
    ctx.fill(); ctx.stroke();

    // top glow line
    ctx.strokeStyle = '#4cc9f020';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x+4, y+1); ctx.lineTo(x+w-4, y+1);
    ctx.stroke();
  });
}

function drawPlayer(p) {
  const x = wx(p.x), y = wy(p.y);
  const pw = ws_(22), ph = hs_(40);
  const scale = SCALE_X();

  ctx.save();
  ctx.translate(x, y);

  if (p.dead) {
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = p.color;
    ctx.fillRect(-pw/2, -ph/2, pw, ph);
    ctx.restore();
    return;
  }

  // Attack flash
  if (p.action === 'attack' || p.action === 'special') {
    ctx.shadowColor = p.action === 'special' ? '#ffd166' : p.color;
    ctx.shadowBlur = 18 * scale;
  }

  // Body
  ctx.fillStyle = p.color;
  const bodyH = ph * 0.65;
  ctx.beginPath();
  ctx.roundRect(-pw/2, -bodyH, pw, bodyH, 4*scale);
  ctx.fill();

  // Legs
  const run = p.action === 'run';
  const t = animFrame * 0.25;
  const legOff = run ? Math.sin(t) * 6 * scale : 0;
  ctx.fillStyle = shadeColor(p.color, -30);
  ctx.fillRect(-pw/2, 0, pw*0.45, ph*0.35 + legOff);
  ctx.fillRect(pw*0.05, 0, pw*0.45, ph*0.35 - legOff);

  // Head
  ctx.fillStyle = shadeColor(p.color, 20);
  const headS = pw * 0.85;
  ctx.beginPath();
  ctx.roundRect(-headS/2, -bodyH - headS*0.8, headS, headS, headS*0.3);
  ctx.fill();

  // Eyes
  const eyeX = p.facing * headS * 0.18;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(eyeX, -bodyH - headS*0.4, headS*0.12, headS*0.15, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(eyeX + p.facing*1.5*scale, -bodyH - headS*0.38, headS*0.07, 0, Math.PI*2);
  ctx.fill();

  // Attack arm
  if (p.action === 'attack' || p.action === 'special') {
    ctx.strokeStyle = p.action === 'special' ? '#ffd166' : '#ffffff';
    ctx.lineWidth = 3 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.facing * pw*0.4, -bodyH*0.6);
    ctx.lineTo(p.facing * pw*1.2, -bodyH*0.3);
    ctx.stroke();
    // blade
    ctx.strokeStyle = p.action === 'special' ? '#fffde0' : '#e0e0ff';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(p.facing * pw*1.2, -bodyH*0.3);
    ctx.lineTo(p.facing * (pw*1.2 + 22*scale), -bodyH*0.6);
    ctx.stroke();
  } else {
    // idle arm
    ctx.strokeStyle = shadeColor(p.color, -20);
    ctx.lineWidth = 2.5*scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.facing * pw*0.35, -bodyH*0.6);
    ctx.lineTo(p.facing * pw*0.6, -bodyH*0.2);
    ctx.stroke();
  }

  // Ninja headband
  ctx.strokeStyle = '#e63946';
  ctx.lineWidth = 2.5*scale;
  ctx.beginPath();
  ctx.moveTo(-headS/2, -bodyH - headS*0.45);
  ctx.lineTo(headS/2, -bodyH - headS*0.45);
  ctx.stroke();

  ctx.restore();

  // HP bar
  const barW = ws_(36), barH = hs_(5);
  const barX = x - barW/2, barY = y - wy(48);
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(barX, barY, barW, barH);
  const hpRatio = p.hp / MAX_HP;
  ctx.fillStyle = hpRatio > 0.5 ? '#06d6a0' : hpRatio > 0.25 ? '#ffd166' : '#e63946';
  ctx.fillRect(barX, barY, barW * hpRatio, barH);

  // Name
  ctx.fillStyle = p.id === myId ? '#ffffff' : '#aaaacc';
  ctx.font = `${Math.max(9, 11*scale)}px "Share Tech Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(p.name, x, y - wy(52));
}

function drawParticles() {
  particles.forEach(p => {
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(wx(p.x), wy(p.y), p.size * SCALE_X(), 0, Math.PI*2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

// ─── GAME LOOP ────────────────────────────────────────────────────────────────
function startGameLoop() {
  function loop() {
    animFrame++;
    handleInput();
    const me = players[myId];
    if (me) updatePhysics(me, 1);

    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.1;
      p.life -= 0.04;
    });
    particles = particles.filter(p => p.life > 0);

    sendState();

    // Draw
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();
    drawPlatforms();
    drawParticles();
    Object.values(players).forEach(p => drawPlayer(p));

    // My cooldown indicator
    if (me && !me.dead) {
      const cd = me.specialCooldown;
      if (cd > 0) {
        ctx.fillStyle = 'rgba(255,209,102,0.25)';
        ctx.fillRect(canvas.width/2 - 50, canvas.height - 18, 100 * (1 - cd/90), 6);
        ctx.strokeStyle = '#ffd16660';
        ctx.strokeRect(canvas.width/2 - 50, canvas.height - 18, 100, 6);
      }
    }

    requestAnimationFrame(loop);
  }
  loop();
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function shadeColor(hex, amount) {
  const num = parseInt(hex.replace('#',''), 16);
  const r = Math.min(255, Math.max(0, (num>>16) + amount));
  const g = Math.min(255, Math.max(0, ((num>>8)&0xff) + amount));
  const b = Math.min(255, Math.max(0, (num&0xff) + amount));
  return '#' + ((1<<24)|(r<<16)|(g<<8)|b).toString(16).slice(1);
}
