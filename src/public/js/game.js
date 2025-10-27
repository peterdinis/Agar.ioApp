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
    interpolatedPlayers: new Map(),
    finalMass: 0,
    finalPosition: 0,
    eatenBy: '',
    lastServerUpdate: 0,
    frameCount: 0,
    lastMoveSend: 0,
    playerInitialized: false,

    SERVER_TICK_MS: 50,
    MOVE_SEND_MS: 16, // Znížené pre plynulejší pohyb
    INTERP_MAX_AGE: 3000,
    cameraLerp: 0.08, // Znížené pre plynulejšiu kameru
    debug: false,

    // Pridané pre interpoláciu vlastného hráča
    targetPosition: { x: 0, y: 0 },
    lastServerPosition: { x: 0, y: 0 },

    init() {
      this.socket = io({ transports: ['websocket'], upgrade: false });
      this.setupSocketListeners();
    },

    setupSocketListeners() {
      this.socket.on('init', (data) => {
        this.currentPlayer = data.player;
        this.worldWidth = data.worldWidth;
        this.worldHeight = data.worldHeight;
        this.playerInitialized = true;
        
        // Inicializácia pozícií
        this.lastServerPosition = { x: data.player.x, y: data.player.y };
        this.targetPosition = { x: data.player.x, y: data.player.y };
        
        this.initCanvas();
        this.startGameLoop();
      });

      this.socket.on('gameUpdate', (gameState) => {
        if (this.gameOver || !this.gameStarted) return;
        this.lastServerUpdate = Date.now();
        this.applyServerSnapshot(gameState);
        this.updateLeaderboardFromSnapshot(gameState);
      });

      this.socket.on('playerDeath', (data) => {
        if (data.playerId === this.currentPlayer?.id) this.handlePlayerDeath(data);
      });
    },

    handlePlayerDeath(data = {}) {
      if (this.gameOver) return;
      this.gameOver = true;
      this.gameStarted = false;
      this.finalMass = this.currentPlayer?.mass || 0;
      this.eatenBy = data.eatenBy || 'Another player';

      const sorted = [...this.leaderboard].sort((a, b) => b.mass - a.mass);
      const pos = sorted.findIndex(p => p.id === this.currentPlayer?.id) + 1;
      this.finalPosition = pos > 0 ? `#${pos}` : 'Unknown';
    },

    applyServerSnapshot(snapshot) {
      const ts = snapshot.ts || Date.now();
      
      // Aktualizácia vlastného hráča s interpoláciou
      if (this.currentPlayer) {
        const serverPlayer = snapshot.players?.find(p => p.id === this.currentPlayer.id);
        if (serverPlayer) {
          this.lastServerPosition.x = this.currentPlayer.x;
          this.lastServerPosition.y = this.currentPlayer.y;
          this.targetPosition.x = serverPlayer.x;
          this.targetPosition.y = serverPlayer.y;
          this.currentPlayer.mass = serverPlayer.mass;
          this.currentPlayer.radius = serverPlayer.radius;
        }
      }

      // Interpolácia ostatných hráčov
      for (const p of snapshot.players || []) {
        const entry = this.interpolatedPlayers.get(p.id);
        const snap = { 
          x: p.x, 
          y: p.y, 
          r: p.radius, 
          mass: p.mass, 
          ts,
          vx: p.vx || 0,
          vy: p.vy || 0
        };

        if (!entry) {
          this.interpolatedPlayers.set(p.id, { 
            prev: { ...snap }, 
            next: { ...snap }, 
            name: p.name, 
            color: p.color 
          });
        } else {
          entry.prev = { ...entry.next };
          entry.next = snap;
          entry.name = p.name;
          entry.color = p.color;
        }

        // Aktualizácia zoznamu hráčov
        const existing = this.players.find(x => x.id === p.id);
        if (!existing) {
          this.players.push({ 
            id: p.id, 
            name: p.name, 
            color: p.color, 
            mass: p.mass, 
            radius: p.radius 
          });
        } else {
          existing.mass = p.mass;
          existing.radius = p.radius;
        }
      }

      this.food = (snapshot.food || []).map(f => ({ ...f }));

      // Čistenie starých hráčov
      const presentIds = new Set((snapshot.players || []).map(p => p.id));
      for (const [id, entry] of this.interpolatedPlayers) {
        if (!presentIds.has(id)) {
          if (Date.now() - (entry.next?.ts || 0) > this.INTERP_MAX_AGE) {
            this.interpolatedPlayers.delete(id);
          }
        }
      }

      this.playerCount = snapshot.totalPlayers || this.players.length;
    },

    updateLeaderboardFromSnapshot(snapshot) {
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
      if (!this.playerName.trim()) this.playerName = 'Anonymous';
      this.gameStarted = true;
      this.gameOver = false;
      this.finalMass = 0;
      this.finalPosition = 0;
      this.eatenBy = '';
      this.playerInitialized = false;
      this.interpolatedPlayers.clear();
      this.players = [];
      this.food = [];
      this.lastServerPosition = { x: 0, y: 0 };
      this.targetPosition = { x: 0, y: 0 };
      this.socket.emit('join', this.playerName);
    },

    restartGame() { this.startGame(); },
    
    backToMenu() {
      this.gameStarted = false;
      this.gameOver = false;
      this.currentPlayer = null;
      this.players = [];
      this.food = [];
      this.playerCount = 0;
      this.leaderboard = [];
      this.interpolatedPlayers.clear();
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
    },

    resizeCanvas() {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    },

    startGameLoop() {
      const loop = (timestamp) => {
        if (!this.lastRender) this.lastRender = timestamp;
        const delta = timestamp - this.lastRender;
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
      
      // Interpolácia vlastného hráča
      this.interpolateSelfPlayer();
      
      // Odoslanie pohybu na server
      const now = Date.now();
      if (now - this.lastMoveSend > this.MOVE_SEND_MS) {
        const targetX = this.camera.x + this.mouse.x;
        const targetY = this.camera.y + this.mouse.y;
        this.socket.emit('move', { x: Math.round(targetX), y: Math.round(targetY) });
        this.lastMoveSend = now;
      }

      // Plynulejšie sledovanie kamery
      const targetCameraX = (this.currentPlayer.x || 0) - this.canvas.width / 2;
      const targetCameraY = (this.currentPlayer.y || 0) - this.canvas.height / 2;
      this.camera.x += (targetCameraX - this.camera.x) * this.cameraLerp;
      this.camera.y += (targetCameraY - this.camera.y) * this.cameraLerp;
    },

    interpolateSelfPlayer() {
      if (!this.currentPlayer) return;
      
      const timeSinceUpdate = Date.now() - this.lastServerUpdate;
      const interpFactor = Math.min(1, timeSinceUpdate / this.SERVER_TICK_MS);
      
      // Interpolácia medzi poslednou serverovou pozíciou a cieľovou pozíciou
      this.currentPlayer.x = this.lerp(
        this.lastServerPosition.x, 
        this.targetPosition.x, 
        interpFactor
      );
      this.currentPlayer.y = this.lerp(
        this.lastServerPosition.y, 
        this.targetPosition.y, 
        interpFactor
      );
    },

    lerp(start, end, factor) {
      return start + (end - start) * factor;
    },

    interpolateEntry(entry) {
      const now = Date.now();
      const prev = entry.prev, next = entry.next;
      const dt = next.ts - prev.ts;
      if (dt <= 0) return next;
      
      const t = (now - prev.ts) / dt;
      const clampedT = Math.max(0, Math.min(1, t));
      
      return {
        x: this.lerp(prev.x, next.x, clampedT),
        y: this.lerp(prev.y, next.y, clampedT),
        r: this.lerp(prev.r, next.r, clampedT)
      };
    },

    render() {
      this.ctx.fillStyle = '#222';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      if (!this.currentPlayer || this.gameOver || !this.gameStarted) return;
      
      this.ctx.save();
      this.ctx.translate(-this.camera.x, -this.camera.y);
      this.drawGrid();
      this.drawFood();
      this.drawPlayers();
      this.ctx.restore();
    },

    drawGrid() {
      const gridSize = 50;
      const startX = Math.floor(this.camera.x / gridSize) * gridSize;
      const startY = Math.floor(this.camera.y / gridSize) * gridSize;
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      for (let x = startX; x < startX + this.canvas.width + gridSize; x += gridSize) {
        this.ctx.moveTo(x, this.camera.y);
        this.ctx.lineTo(x, this.camera.y + this.canvas.height);
      }
      for (let y = startY; y < startY + this.canvas.height + gridSize; y += gridSize) {
        this.ctx.moveTo(this.camera.x, y);
        this.ctx.lineTo(this.camera.x + this.canvas.width, y);
      }
      this.ctx.stroke();
    },

    drawFood() {
      for (const f of this.food) {
        this.ctx.fillStyle = f.color;
        this.ctx.beginPath();
        this.ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        this.ctx.fill();
      }
    },

    drawPlayers() {
      const drawList = [];
      
      // Vlastný hráč
      if (this.currentPlayer) {
        drawList.push({
          ...this.currentPlayer,
          radius: this.currentPlayer.radius,
          name: this.currentPlayer.name,
          color: this.currentPlayer.color,
          isSelf: true,
          mass: this.currentPlayer.mass
        });
      }
      
      // Ostatní hráči
      for (const [id, entry] of this.interpolatedPlayers) {
        if (id === this.currentPlayer?.id) continue; // Preskočiť vlastného hráča
        
        const interp = this.interpolateEntry(entry);
        if (!interp) continue;
        
        drawList.push({
          id,
          ...interp,
          radius: interp.r,
          name: entry.name,
          color: entry.color,
          isSelf: false,
          mass: entry.next?.mass || entry.prev?.mass || 0
        });
      }
      
      // Zoradenie podľa veľkosti pre správne prekrytie
      drawList.sort((a, b) => a.radius - b.radius);
      
      for (const p of drawList) {
        this.ctx.fillStyle = p.color;
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        this.ctx.fill();
        
        this.ctx.strokeStyle = p.isSelf ? '#fff' : 'rgba(0,0,0,0.3)';
        this.ctx.lineWidth = p.isSelf ? 5 : 3;
        this.ctx.stroke();

        if (p.radius > 15) {
          const fontSize = Math.max(12, p.radius / 3);
          this.ctx.fillStyle = '#fff';
          this.ctx.strokeStyle = '#000';
          this.ctx.lineWidth = 3;
          this.ctx.font = `bold ${fontSize}px Arial`;
          this.ctx.textAlign = 'center';
          this.ctx.textBaseline = 'middle';
          this.ctx.strokeText(p.name, p.x, p.y);
          this.ctx.fillText(p.name, p.x, p.y);
        }
      }
    },
  };
}

const app = gameApp();
window.addEventListener('load', () => {
  app.init();
  const startBtn = document.getElementById('startBtn');
  if (startBtn) startBtn.addEventListener('click', () => {
    const nameInput = document.getElementById('nameInput');
    if (nameInput) app.playerName = nameInput.value || 'Anonymous';
    app.startGame();
  });
});