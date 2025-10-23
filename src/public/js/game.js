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
    
    // OPTIMALIZAČNÉ PREMENNÉ
    visiblePlayers: new Set(),
    visibleFood: new Set(),
    lastBoundsCheck: 0,
    boundsCheckInterval: 500, // Kontrola viditeľnosti každých 500ms
    renderScale: 1,
    performanceMode: false,
    debugInfo: {
      visiblePlayers: 0,
      visibleFood: 0,
      fps: 0,
      lastFpsUpdate: 0,
      frameCount: 0
    },

    init() {
      this.socket = io({
        transports: ['websocket'],
        upgrade: false,
      });
      this.setupSocketListeners();
      this.detectPerformanceMode();
    },

    detectPerformanceMode() {
      // Detekcia pomalých zariadení
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const isLowEnd = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
      
      this.performanceMode = isMobile || isLowEnd;
      if (this.performanceMode) {
        console.log('Performance mode activated for low-end device');
        this.boundsCheckInterval = 1000;
        this.renderScale = 0.8;
      }
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

      this.socket.on('gameUpdate', (gameState) => {
        if (this.gameOver || !this.gameStarted) return;

        this.lastServerUpdate = Date.now();
        
        // OPTIMALIZOVANÝ UPDATE - len zmeny
        this.updateGameState(gameState);
        
        this.playerCount = this.players.length;

        if (this.playerInitialized && this.currentPlayer) {
          const current = this.players.find(p => p.id === this.currentPlayer.id);
          if (current) {
            this.currentPlayer = current;
          }
        }

        this.updateLeaderboard();
        this.updateInterpolation();
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

    // OPTIMALIZOVANÝ UPDATE STAŠE
    updateGameState(gameState) {
      // Rýchly update hráčov - pomocou Map pre lepšiu výkonnosť
      const playersMap = new Map();
      gameState.players.forEach(player => {
        playersMap.set(player.id, player);
      });
      
      // Update existujúcich hráčov a pridanie nových
      this.players = gameState.players;
      
      // Food update - len zmeny
      this.food = gameState.food;
    },

    handlePlayerDeath(data = {}) {
      if (this.gameOver) return;

      console.log('Handling player death');
      this.gameOver = true;
      this.gameStarted = false;
      this.finalMass = this.currentPlayer?.mass || 0;
      this.eatenBy = data.eatenBy || 'Another player';
      
      const sortedPlayers = [...this.players]
        .sort((a, b) => b.mass - a.mass);
      const position = sortedPlayers.findIndex(p => p.id === this.currentPlayer?.id) + 1;
      this.finalPosition = position > 0 ? `#${position}` : 'Unknown';

      if (this.canvas) {
        this.canvas.classList.add('death-animation');
        setTimeout(() => {
          this.canvas.classList.remove('death-animation');
        }, 1000);
      }

      console.log('Player died! Final mass:', this.finalMass);
    },

    updateInterpolation() {
      const now = Date.now();
      
      // OPTIMALIZOVANÁ INTERPOLÁCIA - len pre viditeľných hráčov
      for (const player of this.players) {
        if (!this.interpolatedPlayers.has(player.id)) {
          this.interpolatedPlayers.set(player.id, { 
            x: player.x, 
            y: player.y, 
            radius: player.radius,
            lastUpdate: now 
          });
        } else {
          const interp = this.interpolatedPlayers.get(player.id);
          
          // RÝCHLA INTERPOLÁCIA - priamy update pre blízkych hráčov, pomalšia pre vzdialených
          const dist = this.distance(interp.x, interp.y, player.x, player.y);
          const interpFactor = dist > 100 ? 0.2 : 0.5;
          
          interp.x += (player.x - interp.x) * interpFactor;
          interp.y += (player.y - interp.y) * interpFactor;
          interp.radius = player.radius;
          interp.lastUpdate = now;
        }
      }

      // Cleanup - odstrániť hráčov, ktorí už nie sú v hre
      for (const [id, interp] of this.interpolatedPlayers) {
        if (!this.players.find(p => p.id === id) || now - interp.lastUpdate > 5000) {
          this.interpolatedPlayers.delete(id);
        }
      }
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
      this.visiblePlayers.clear();
      this.visibleFood.clear();
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
      this.visiblePlayers.clear();
      this.visibleFood.clear();
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
      this.ctx = this.canvas.getContext('2d', { 
        alpha: false, // Vypnúť alpha pre lepšiu výkonnosť
        desynchronized: true // Zapnúť desynchronized pre lepšiu výkonnosť
      });
      
      this.resizeCanvas();

      // Debounced resize
      let resizeTimeout;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => this.resizeCanvas(), 250);
      });
      
      // Optimalizované event listenery
      this.canvas.addEventListener('mousemove', (e) => {
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = e.clientX - rect.left;
        this.mouse.y = e.clientY - rect.top;
      }, { passive: true });

      this.canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const touch = e.touches[0];
        this.mouse.x = touch.clientX - rect.left;
        this.mouse.y = touch.clientY - rect.top;
      }, { passive: false });
    },

    resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = window.innerWidth * dpr * this.renderScale;
      this.canvas.height = window.innerHeight * dpr * this.renderScale;
      this.canvas.style.width = window.innerWidth + 'px';
      this.canvas.style.height = window.innerHeight + 'px';
      
      if (this.ctx) {
        this.ctx.scale(dpr * this.renderScale, dpr * this.renderScale);
      }
    },

    startGameLoop() {
      const loop = (timestamp) => {
        if (!this.lastRender) this.lastRender = timestamp;
        const delta = timestamp - this.lastRender;
        
        this.frameCount++;
        this.debugInfo.frameCount++;
        
        // Update FPS counter
        if (timestamp - this.debugInfo.lastFpsUpdate > 1000) {
          this.debugInfo.fps = Math.round((this.debugInfo.frameCount * 1000) / (timestamp - this.debugInfo.lastFpsUpdate));
          this.debugInfo.frameCount = 0;
          this.debugInfo.lastFpsUpdate = timestamp;
        }
        
        if (delta >= 33) { // ~30 FPS je dostatočných
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

      const targetX = this.camera.x + this.mouse.x;
      const targetY = this.camera.y + this.mouse.y;

      // OPTIMALIZOVANÉ POSIELANIE POHYBU
      const now = Date.now();
      if (now - this.lastMoveSend > 50) { // Znížené na 50ms
        this.socket.emit('move', { x: targetX, y: targetY });
        this.lastMoveSend = now;
      }

      // RÝCHLA KAMERA
      const targetCameraX = this.currentPlayer.x - this.canvas.width / 2;
      const targetCameraY = this.currentPlayer.y - this.canvas.height / 2;
      
      // Priamy pohyb kamery bez plynulého prechodu pre lepšiu výkonnosť
      this.camera.x = targetCameraX;
      this.camera.y = targetCameraY;

      // Kontrola viditeľnosti menej často
      if (now - this.lastBoundsCheck > this.boundsCheckInterval) {
        this.updateVisibleObjects();
        this.lastBoundsCheck = now;
      }
    },

    // OPTIMALIZOVANÁ KONTROLA VIDITEĽNOSTI
    updateVisibleObjects() {
      this.visiblePlayers.clear();
      this.visibleFood.clear();

      const bounds = this.getViewBounds();
      
      // Rýchla kontrola hráčov
      for (const player of this.players) {
        if (this.isInView(player, bounds)) {
          this.visiblePlayers.add(player.id);
        }
      }
      
      // Rýchla kontrola jedla
      for (const food of this.food) {
        if (this.isInView(food, bounds)) {
          this.visibleFood.add(food.id);
        }
      }
      
      this.debugInfo.visiblePlayers = this.visiblePlayers.size;
      this.debugInfo.visibleFood = this.visibleFood.size;
    },

    isInView(obj, bounds) {
      return obj.x + obj.radius >= bounds.left && 
             obj.x - obj.radius <= bounds.right && 
             obj.y + obj.radius >= bounds.top && 
             obj.y - obj.radius <= bounds.bottom;
    },

    getViewBounds() {
      const padding = 300; // Znížené padding pre lepšiu výkonnosť
      return {
        left: this.camera.x - padding,
        right: this.camera.x + this.canvas.width + padding,
        top: this.camera.y - padding,
        bottom: this.camera.y + this.canvas.height + padding,
      };
    },

    distance(x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      return Math.sqrt(dx * dx + dy * dy);
    },

    render() {
      if (!this.ctx) return;
      
      // RÝCHLE VYMAZANIE CANVASU
      this.ctx.fillStyle = '#222';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      if (!this.currentPlayer || this.gameOver || !this.gameStarted) return;

      this.ctx.save();
      this.ctx.translate(-this.camera.x, -this.camera.y);

      // Kresli grid len každý 4. frame
      if (this.frameCount % 4 === 0) {
        this.drawGrid();
      }
      
      this.drawFood();
      this.drawPlayers();

      this.ctx.restore();
      
      // Debug info
      if (this.debugInfo.fps < 45) {
        this.drawDebugInfo();
      }
    },

    drawGrid() {
      const gridSize = 100; // Väčší grid pre lepšiu výkonnosť
      const startX = Math.floor(this.camera.x / gridSize) * gridSize;
      const startY = Math.floor(this.camera.y / gridSize) * gridSize;
      const endX = startX + this.canvas.width + gridSize;
      const endY = startY + this.canvas.height + gridSize;

      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)'; // Ešte priehľadnejšie
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

    drawFood() {
      this.ctx.fillStyle = '#FF6B6B'; // Jedna farba pre všetko jedlo pre lepšiu výkonnosť
      
      for (const f of this.food) {
        if (!this.visibleFood.has(f.id)) continue;

        this.ctx.beginPath();
        this.ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        this.ctx.fill();
      }
    },

    drawPlayers() {
      // Zoradiť podľa veľkosti pre správne prekrytie
      const playersToDraw = this.players
        .filter(p => this.visiblePlayers.has(p.id))
        .sort((a, b) => a.radius - b.radius);

      for (const p of playersToDraw) {
        const interp = this.interpolatedPlayers.get(p.id);
        const x = interp ? interp.x : p.x;
        const y = interp ? interp.y : p.y;
        const radius = interp ? interp.radius : p.radius;

        this.ctx.fillStyle = p.color;
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, 0, Math.PI * 2);
        this.ctx.fill();

        // Zjednodušené okraje
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        if (p.id === this.currentPlayer.id) {
          this.ctx.strokeStyle = '#fff';
          this.ctx.lineWidth = 3;
          this.ctx.stroke();
        }

        // Kresli meno len pre väčších hráčov
        if (radius > 20) {
          this.ctx.fillStyle = '#fff';
          this.ctx.strokeStyle = '#000';
          this.ctx.lineWidth = 2;
          const fontSize = Math.max(10, radius / 4); // Menšie písmo
          this.ctx.font = `bold ${fontSize}px Arial`;
          this.ctx.textAlign = 'center';
          this.ctx.textBaseline = 'middle';
          
          this.ctx.strokeText(p.name, x, y);
          this.ctx.fillText(p.name, x, y);

          if (p.isBot && radius > 30) {
            this.ctx.font = `${fontSize * 0.5}px Arial`;
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            this.ctx.fillText('BOT', x, y + fontSize + 3);
          }
        }
      }
    },

    drawDebugInfo() {
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
      this.ctx.font = '12px Arial';
      this.ctx.fillText(`FPS: ${this.debugInfo.fps} | Players: ${this.debugInfo.visiblePlayers}/${this.players.length} | Food: ${this.debugInfo.visibleFood}/${this.food.length}`, 10, 20);
      this.ctx.restore();
    },

    updateLeaderboard() {
      // Optimalizovaný leaderboard - len top 5 namiesto 10
      this.leaderboard = [...this.players]
        .sort((a, b) => b.mass - a.mass)
        .slice(0, 5);
    }
  };
}