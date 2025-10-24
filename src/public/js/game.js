// game.js - klient (vanilla JS)
function gameApp() {
  return {
    socket: null,
    gameStarted: false,
    gameOver: false,
    playerName: '',
    currentPlayer: null,
    players: [],
    food: [],
    playerCount: 0,
    leaderboard: [],
    canvas: null,
    ctx: null,
    camera: { x: 0, y: 0 },
    mouse: { x: 0, y: 0 },
    worldWidth: 5000,
    worldHeight: 5000,
    lastRender: 0,
    // interpolatedPlayers stores { prev: {x,y,r,ts}, next: {...} }
    interpolatedPlayers: new Map(),
    finalMass: 0,
    finalPosition: 0,
    eatenBy: '',
    lastServerUpdate: 0,
    frameCount: 0,
    lastMoveSend: 0,
    playerInitialized: false,
    // client-side constants
    SERVER_TICK_MS: 100, // server emits visible states ~10Hz
    MOVE_SEND_MS: 30,    // client sends movement at ~33Hz
    INTERP_MAX_AGE: 3000, // cleanup old snapshots
    cameraLerp: 0.25,    // camera smoothing
    debug: false,

    init() {
      this.socket = io({
        transports: ['websocket'],
        upgrade: false,
      });
      this.setupSocketListeners();
    },

    setupSocketListeners() {
      this.socket.on('init', (data) => {
        console.log('Game initialized', data.player);
        this.currentPlayer = data.player;
        this.worldWidth = data.worldWidth;
        this.worldHeight = data.worldHeight;
        this.playerInitialized = true;
        this.initCanvas();
        this.startGameLoop();
      });

      // server sends per-socket visible snapshot with timestamp
      this.socket.on('gameUpdate', (gameState) => {
        // ignore updates when not in-game
        if (this.gameOver || !this.gameStarted) return;

        this.lastServerUpdate = Date.now();
        // integrate snapshots into interpolatedPlayers
        this.applyServerSnapshot(gameState);
        this.updateLeaderboardFromSnapshot(gameState);
      });

      this.socket.on('playerDeath', (data) => {
        console.log('Player death received', data);
        if (data.playerId === this.currentPlayer?.id) {
          this.handlePlayerDeath(data);
        }
      });

      this.socket.on('connect', () => {
        console.log('Connected to server');
      });

      this.socket.on('disconnect', () => {
        console.log('Disconnected from server');
      });
    },

    handlePlayerDeath(data = {}) {
      if (this.gameOver) return;

      console.log('Handling player death');
      this.gameOver = true;
      this.gameStarted = false;
      this.finalMass = this.currentPlayer?.mass || 0;
      this.eatenBy = data.eatenBy || 'Another player';

      // compute final position using last known leaderboard
      const sorted = [...this.leaderboard].sort((a, b) => b.mass - a.mass);
      const pos = sorted.findIndex(p => p.id === this.currentPlayer?.id) + 1;
      this.finalPosition = pos > 0 ? `#${pos}` : 'Unknown';

      if (this.canvas) {
        this.canvas.classList.add('death-animation');
        setTimeout(() => {
          this.canvas.classList.remove('death-animation');
        }, 1000);
      }
      console.log('Player died! Final mass:', this.finalMass);
    },

    applyServerSnapshot(snapshot) {
      const ts = snapshot.ts || Date.now();
      // record players
      for (const p of snapshot.players || []) {
        const entry = this.interpolatedPlayers.get(p.id);
        const snap = { x: p.x, y: p.y, r: p.radius, mass: p.mass, ts };

        if (!entry) {
          // create prev and next identical to avoid jumps on first packet
          this.interpolatedPlayers.set(p.id, {
            prev: { ...snap },
            next: { ...snap },
            name: p.name,
            color: p.color,
            isBot: p.isBot
          });
        } else {
          // shift next -> prev, set new next
          entry.prev = entry.next;
          entry.next = snap;
          entry.name = p.name;
          entry.color = p.color;
          entry.isBot = p.isBot;
        }

        // keep players list updated for UI
        const existing = this.players.find(x => x.id === p.id);
        if (!existing) {
          this.players.push({ id: p.id, name: p.name, color: p.color, mass: p.mass, radius: p.radius, isBot: p.isBot });
        } else {
          existing.mass = p.mass;
          existing.radius = p.radius;
          existing.x = p.x;
          existing.y = p.y;
        }

        if (this.currentPlayer && p.id === this.currentPlayer.id) {
          // update authoritative player state
          this.currentPlayer.x = p.x;
          this.currentPlayer.y = p.y;
          this.currentPlayer.mass = p.mass;
          this.currentPlayer.radius = p.radius;
        }
      }

      // record food (we'll render food directly from snapshot)
      this.food = (snapshot.food || []).map(f => ({ ...f }));

      // cleanup interpolated players not present in snapshot (lazy removal)
      const presentIds = new Set((snapshot.players || []).map(p => p.id));
      for (const [id, entry] of this.interpolatedPlayers) {
        if (!presentIds.has(id)) {
          // allow a grace period
          if (Date.now() - (entry.next?.ts || 0) > this.INTERP_MAX_AGE) {
            this.interpolatedPlayers.delete(id);
          }
        }
      }

      // update playerCount quickly
      this.playerCount = snapshot.totalPlayers || this.players.length;
    },

    updateLeaderboardFromSnapshot(snapshot) {
      // snapshot may contain partial players; we use players map to sort
      const merged = [];
      for (const [id, entry] of this.interpolatedPlayers) {
        merged.push({
          id,
          name: entry.name || 'Unknown',
          mass: entry.next?.mass || entry.prev?.mass || 0
        });
      }
      this.leaderboard = merged.sort((a, b) => b.mass - a.mass).slice(0, 10);
    },

    startGame() {
      if (!this.playerName.trim()) {
        this.playerName = 'Anonymous';
      }

      console.log('Starting game with name:', this.playerName);
      this.gameStarted = true;
      this.gameOver = false;
      this.finalMass = 0;
      this.finalPosition = 0;
      this.eatenBy = '';
      this.playerInitialized = false;
      this.interpolatedPlayers.clear();
      this.players = [];
      this.food = [];

      this.socket.emit('join', this.playerName);
    },

    restartGame() {
      console.log('Restarting game');
      this.gameOver = false;
      this.startGame();
    },

    backToMenu() {
      console.log('Returning to main menu');

      this.gameStarted = false;
      this.gameOver = false;
      this.currentPlayer = null;
      this.players = [];
      this.food = [];
      this.playerCount = 0;
      this.leaderboard = [];
      this.interpolatedPlayers.clear();
      this.finalMass = 0;
      this.finalPosition = 0;
      this.eatenBy = '';
      this.playerInitialized = false;

      if (this.canvas && this.ctx) {
        this.ctx.fillStyle = '#222';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }

      console.log('Successfully returned to main menu');
    },

    initCanvas() {
      this.canvas = document.getElementById('gameCanvas');
      this.ctx = this.canvas.getContext('2d');
      this.resizeCanvas();

      window.addEventListener('resize', () => this.resizeCanvas());

      this.canvas.addEventListener('mousemove', (e) => {
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = e.clientX - rect.left;
        this.mouse.y = e.clientY - rect.top;
      });

      this.canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const touch = e.touches[0];
        this.mouse.x = touch.clientX - rect.left;
        this.mouse.y = touch.clientY - rect.top;
      }, { passive: false });
    },

    resizeCanvas() {
      if (!this.canvas) return;
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    },

    startGameLoop() {
      const loop = (timestamp) => {
        if (!this.lastRender) this.lastRender = timestamp;
        const delta = timestamp - this.lastRender;
        this.frameCount++;

        // update and render at ~30fps minimum by throttling render delta to 33ms
        if (delta >= 16) {
          this.update(delta);
          this.render();
          this.lastRender = timestamp;
        }

        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },

    update(delta) {
      if (!this.currentPlayer || this.gameOver || !this.gameStarted) return;

      // target is mouse in world coords
      const targetX = this.camera.x + this.mouse.x;
      const targetY = this.camera.y + this.mouse.y;

      // send move at MOVE_SEND_MS
      const now = Date.now();
      if (now - this.lastMoveSend > this.MOVE_SEND_MS) {
        this.socket.emit('move', { x: Math.round(targetX), y: Math.round(targetY) });
        this.lastMoveSend = now;
      }

      // smooth camera towards currentPlayer
      const targetCameraX = (this.currentPlayer.x || 0) - this.canvas.width / 2;
      const targetCameraY = (this.currentPlayer.y || 0) - this.canvas.height / 2;

      this.camera.x += (targetCameraX - this.camera.x) * this.cameraLerp;
      this.camera.y += (targetCameraY - this.camera.y) * this.cameraLerp;
    },

    // helper to interpolate position between prev and next based on time
    interpolateEntry(entry) {
      if (!entry) return null;
      const now = Date.now();
      const prev = entry.prev;
      const next = entry.next;

      if (!prev || !next) return null;

      const dt = next.ts - prev.ts;
      // if timestamps equal (first frame), return next
      if (dt <= 0) {
        return { x: next.x, y: next.y, r: next.r };
      }

      // compute t in [0,1]
      const t = (now - prev.ts) / dt;
      // clamp softness and allow mild extrapolation
      const clampedT = Math.max(-0.2, Math.min(1.2, t));

      const lerp = (a, b, tt) => a + (b - a) * tt;
      const x = lerp(prev.x, next.x, clampedT);
      const y = lerp(prev.y, next.y, clampedT);
      const r = lerp(prev.r, next.r, clampedT);
      return { x, y, r };
    },

    render() {
      if (!this.ctx) return;

      // clear
      this.ctx.fillStyle = '#222';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      if (!this.currentPlayer || this.gameOver || !this.gameStarted) return;

      this.ctx.save();
      this.ctx.translate(-this.camera.x, -this.camera.y);

      // occasionally draw grid for light detail
      if (this.frameCount % 2 === 0) {
        this.drawGrid();
      }

      const viewBounds = {
        left: this.camera.x - 200,
        right: this.camera.x + this.canvas.width + 200,
        top: this.camera.y - 200,
        bottom: this.camera.y + this.canvas.height + 200,
      };

      // draw food (from snapshot)
      this.drawFood(viewBounds);

      // draw players using interpolated positions
      this.drawPlayers(viewBounds);

      this.ctx.restore();
    },

    drawGrid() {
      const gridSize = 50;
      const startX = Math.floor(this.camera.x / gridSize) * gridSize;
      const startY = Math.floor(this.camera.y / gridSize) * gridSize;
      const endX = startX + this.canvas.width + gridSize;
      const endY = startY + this.canvas.height + gridSize;

      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();

      for (let x = startX; x < endX; x += gridSize) {
        this.ctx.moveTo(x, this.camera.y);
        this.ctx.lineTo(x, this.camera.y + this.canvas.height);
      }

      for (let y = startY; y < endY; y += gridSize) {
        this.ctx.moveTo(this.camera.x, y);
        this.ctx.lineTo(this.camera.x + this.canvas.width, y);
      }

      this.ctx.stroke();
    },

    drawFood(bounds) {
      // cull and draw
      for (const f of this.food) {
        if (f.x < bounds.left || f.x > bounds.right || f.y < bounds.top || f.y > bounds.bottom) continue;

        this.ctx.fillStyle = f.color;
        this.ctx.beginPath();
        this.ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        this.ctx.fill();
      }
    },

    drawPlayers(bounds) {
      // build a small array of interpolated players for sorting/drawing
      const drawList = [];

      for (const [id, entry] of this.interpolatedPlayers) {
        const interp = this.interpolateEntry(entry);
        if (!interp) continue;

        const x = interp.x;
        const y = interp.y;
        const radius = interp.r;

        // culling
        if (x - radius > bounds.right || x + radius < bounds.left ||
            y - radius > bounds.bottom || y + radius < bounds.top) {
          continue;
        }

        drawList.push({
          id,
          x, y, radius,
          name: entry.name,
          color: entry.color,
          isBot: entry.isBot,
          isSelf: id === this.currentPlayer.id,
          mass: entry.next?.mass || entry.prev?.mass || 0
        });
      }

      // sort by radius ascending so smaller drawn first
      drawList.sort((a, b) => a.radius - b.radius);

      for (const p of drawList) {
        this.ctx.fillStyle = p.color;
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        this.ctx.lineWidth = 3;
        this.ctx.stroke();

        if (p.isSelf) {
          this.ctx.strokeStyle = '#fff';
          this.ctx.lineWidth = 5;
          this.ctx.stroke();
        }

        // draw name when large enough
        if (p.radius > 15) {
          this.ctx.fillStyle = '#fff';
          this.ctx.strokeStyle = '#000';
          this.ctx.lineWidth = 3;
          const fontSize = Math.max(12, p.radius / 3);
          this.ctx.font = `bold ${fontSize}px Arial`;
          this.ctx.textAlign = 'center';
          this.ctx.textBaseline = 'middle';

          // stroke then fill for readability
          this.ctx.strokeText(p.name, p.x, p.y);
          this.ctx.fillText(p.name, p.x, p.y);

          if (p.isBot) {
            this.ctx.font = `${fontSize * 0.6}px Arial`;
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            this.ctx.fillText('BOT', p.x, p.y + fontSize + 5);
          }
        }
      }
    },

    updateLeaderboard() {
      // not used; leaderboard updated from snapshots
    }
  };
}

// bootstrap
const app = gameApp();
window.addEventListener('load', () => {
  app.init();

  // attach UI elements if they exist
  const startBtn = document.getElementById('startBtn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      const nameInput = document.getElementById('nameInput');
      if (nameInput) app.playerName = nameInput.value || 'Anonymous';
      app.startGame();
    });
  }

  // simple debug toggle
  window.addEventListener('keydown', (e) => {
    if (e.key === '`') app.debug = !app.debug;
  });
});
