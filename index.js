// ─── MAIN WORKER ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // WebSocket endpoint
    if (url.pathname === '/ws') {
      const room = url.searchParams.get('room') || 'default';
      const name = url.searchParams.get('name') || 'Ninja';
      const color = url.searchParams.get('color') || '#e63946';

      // Route to the correct Durable Object for this room
      const id = env.GAME_ROOM.idFromName(room);
      const obj = env.GAME_ROOM.get(id);
      return obj.fetch(request);
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response('Ninja Battle WS Server\nConnect via /ws?room=ROOM&name=NAME&color=COLOR', {
      headers: corsHeaders
    });
  }
};

// ─── DURABLE OBJECT: ONE PER ROOM ─────────────────────────────────────────────
export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.sessions = new Map(); // id -> { ws, player }
    this.nextId = 1;
    this.broadcastInterval = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const name = url.searchParams.get('name') || 'Ninja';
    const color = url.searchParams.get('color') || '#e63946';

    // Upgrade to WebSocket
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    const playerId = 'p' + (this.nextId++);

    server.accept();
    this.handleSession(server, playerId, name, color);

    return new Response(null, { status: 101, webSocket: client });
  }

  handleSession(ws, id, name, color) {
    const spawnX = 100 + Math.random() * 700;
    const spawnY = 380;

    const player = {
      id, name, color,
      x: spawnX, y: spawnY,
      vx: 0, vy: 0,
      facing: 1, action: 'idle',
      hp: 100, dead: false,
      kills: 0, deaths: 0,
    };

    this.sessions.set(id, { ws, player });

    // Send init to new player (includes all current players)
    ws.send(JSON.stringify({
      type: 'init',
      id,
      players: [...this.sessions.values()].map(s => s.player)
    }));

    // Tell everyone else about the new player
    this.broadcast({
      type: 'player_join',
      ...player
    }, id);

    // Start broadcast loop if first player
    if (this.sessions.size === 1) {
      this.startBroadcastLoop();
    }

    ws.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data);
        this.handleMessage(id, msg);
      } catch (_) {}
    });

    ws.addEventListener('close', () => {
      this.sessions.delete(id);
      this.broadcast({ type: 'player_leave', id });
      if (this.sessions.size === 0 && this.broadcastInterval) {
        clearInterval(this.broadcastInterval);
        this.broadcastInterval = null;
      }
    });

    ws.addEventListener('error', () => {
      this.sessions.delete(id);
      this.broadcast({ type: 'player_leave', id });
    });
  }

  handleMessage(senderId, msg) {
    const session = this.sessions.get(senderId);
    if (!session) return;
    const { player } = session;

    switch (msg.type) {
      case 'move':
        player.x = clamp(msg.x ?? player.x, 0, 900);
        player.y = clamp(msg.y ?? player.y, 0, 600);
        player.vx = msg.vx ?? 0;
        player.vy = msg.vy ?? 0;
        player.facing = msg.facing ?? 1;
        player.action = msg.action ?? 'idle';
        player.hp = msg.hp ?? player.hp;
        player.dead = msg.dead ?? false;
        break;

      case 'attack': {
        const target = this.sessions.get(msg.targetId);
        if (!target || target.player.dead) break;
        const dmg = clamp(msg.dmg ?? 15, 0, 50);
        target.player.hp = Math.max(0, target.player.hp - dmg);

        // Notify target
        target.ws.send(JSON.stringify({
          type: 'hit',
          targetId: msg.targetId,
          attackerId: senderId,
          dmg, color: player.color
        }));

        // Tell everyone
        this.broadcast({
          type: 'hit',
          targetId: msg.targetId,
          attackerId: senderId,
          dmg, color: player.color
        });

        // Kill?
        if (target.player.hp <= 0 && !target.player.dead) {
          target.player.dead = true;
          target.player.deaths = (target.player.deaths || 0) + 1;
          player.kills = (player.kills || 0) + 1;
          this.broadcast({
            type: 'kill',
            killerId: senderId,
            victimId: msg.targetId,
            x: target.player.x,
            y: target.player.y
          });
        }
        break;
      }

      case 'died':
        player.dead = true;
        player.hp = 0;
        break;

      case 'respawn':
        player.x = clamp(msg.x ?? 450, 0, 900);
        player.y = msg.y ?? 380;
        player.hp = 100;
        player.dead = false;
        player.vx = 0; player.vy = 0;
        this.broadcast({
          type: 'respawn',
          id: senderId,
          x: player.x, y: player.y
        });
        break;
    }
  }

  startBroadcastLoop() {
    // Broadcast full game state 20x per second
    this.broadcastInterval = setInterval(() => {
      if (this.sessions.size === 0) return;
      const players = [...this.sessions.values()].map(s => s.player);
      const msg = JSON.stringify({ type: 'state', players });
      this.sessions.forEach(({ ws }) => {
        try { ws.send(msg); } catch (_) {}
      });
    }, 50);
  }

  broadcast(msg, excludeId = null) {
    const str = JSON.stringify(msg);
    this.sessions.forEach(({ ws }, id) => {
      if (id === excludeId) return;
      try { ws.send(str); } catch (_) {}
    });
  }
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
