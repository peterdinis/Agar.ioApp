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
    playerInitialized: false, // Nová premenná na sledovanie inicializácie

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
        this.playerInitialized = true; // Hráč je inicializovaný
        this.initCanvas();
        this.startGameLoop();
      });

      this.socket.on('gameUpdate', (gameState) => {
        if (this.gameOver || !this.gameStarted) return;

        this.lastServerUpdate = Date.now();
        this.players = gameState.players;
        this.food = gameState.food;
        this.playerCount = this.players.length;

        // DÔLEŽITÉ: Hľadať hráča len ak je inicializovaný
        if (this.playerInitialized && this.currentPlayer) {
          const current = this.players.find(p => p.id === this.currentPlayer.id);
          if (current) {
            this.currentPlayer = current;
          }
          // Ak hráč nie je v zozname, NEspúšťať game-over
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

    handlePlayerDeath(data = {}) {
      if (this.gameOver) return;

      console.log('Handling player death');
      this.gameOver = true;
      this.gameStarted = false;
      this.finalMass = this.currentPlayer?.mass || 0;
      this.eatenBy = data.eatenBy || 'Another player';
      
      // Calculate final position
      const sortedPlayers = [...this.players]
        .sort((a, b) => b.mass - a.mass);
      const position = sortedPlayers.findIndex(p => p.id === this.currentPlayer?.id) + 1;
      this.finalPosition = position > 0 ? `#${position}` : 'Unknown';

      // Add death animation to canvas
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
      this.players.forEach(p => {
        if (!this.interpolatedPlayers.has(p.id)) {
          this.interpolatedPlayers.set(p.id, { 
            x: p.x, 
            y: p.y, 
            radius: p.radius,
            lastUpdate: now 
          });
        } else {
          const interp = this.interpolatedPlayers.get(p.id);
          interp.lastUpdate = now;
        }
      });

      // Cleanup starých interpolácií
      for (const [id, interp] of this.interpolatedPlayers) {
        if (now - interp.lastUpdate > 5000) {
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
      this.playerInitialized = false; // Resetovať pred novou hrou
      this.interpolatedPlayers.clear();
      this.socket.emit('join', this.playerName);
    },

    restartGame() {
      console.log('Restarting game');
      this.gameOver = false;
      this.startGame();
    },

    backToMenu() {
      console.log('Returning to main menu');
      
      // Reset všetkých stavových premenných
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
      
      // Vyčistiť canvas
      if (this.canvas && this.ctx) {
        this.ctx.fillStyle = '#222';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }
      
      console.log('Successfully returned to main menu');
    },

    // ... (zvyšok kódu zostáva rovnaký)
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

      // Touch support for mobile
      this.canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const touch = e.touches[0];
        this.mouse.x = touch.clientX - rect.left;
        this.mouse.y = touch.clientY - rect.top;
      }, { passive: false });
    },

    resizeCanvas() {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    },

    startGameLoop() {
      const loop = (timestamp) => {
        if (!this.lastRender) this.lastRender = timestamp;
        const delta = timestamp - this.lastRender;
        
        this.frameCount++;
        
        // Render len na 30 FPS pre lepšiu výkonnosť
        if (delta >= 33) {
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

      // Optimalizácia: posielaj pohyb len každých 100ms
      const now = Date.now();
      if (now - this.lastMoveSend > 100) {
        this.socket.emit('move', { x: targetX, y: targetY });
        this.lastMoveSend = now;
      }

      // Spomalená interpolácia kamery
      const lerpFactor = 0.08;
      const targetCameraX = this.currentPlayer.x - this.canvas.width / 2;
      const targetCameraY = this.currentPlayer.y - this.canvas.height / 2;
      
      this.camera.x += (targetCameraX - this.camera.x) * lerpFactor;
      this.camera.y += (targetCameraY - this.camera.y) * lerpFactor;

      // Plynulá interpolácia pozícií hráčov
      this.players.forEach(p => {
        const interp = this.interpolatedPlayers.get(p.id);
        if (interp) {
          const interpFactor = 0.2;
          interp.x += (p.x - interp.x) * interpFactor;
          interp.y += (p.y - interp.y) * interpFactor;
          interp.radius += (p.radius - interp.radius) * interpFactor;
        }
      });
    },

    render() {
      if (!this.ctx) return;
      
      // Jednoduché pozadie
      this.ctx.fillStyle = '#222';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      if (!this.currentPlayer || this.gameOver || !this.gameStarted) return;

      this.ctx.save();
      this.ctx.translate(-this.camera.x, -this.camera.y);

      // Kresli mriežku len každý druhý frame
      if (this.frameCount % 2 === 0) {
        this.drawGrid();
      }
      
      const viewBounds = {
        left: this.camera.x - 200,
        right: this.camera.x + this.canvas.width + 200,
        top: this.camera.y - 200,
        bottom: this.camera.y + this.canvas.height + 200,
      };

      this.drawFood(viewBounds);
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
      for (const f of this.food) {
        if (f.x < bounds.left || f.x > bounds.right || 
            f.y < bounds.top || f.y > bounds.bottom) continue;

        this.ctx.fillStyle = f.color;
        this.ctx.beginPath();
        this.ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        this.ctx.fill();
      }
    },

    drawPlayers(bounds) {
      const sortedPlayers = [...this.players].sort((a, b) => a.radius - b.radius);

      for (const p of sortedPlayers) {
        const interp = this.interpolatedPlayers.get(p.id);
        const x = interp ? interp.x : p.x;
        const y = interp ? interp.y : p.y;
        const radius = interp ? interp.radius : p.radius;

        if (x - radius > bounds.right || x + radius < bounds.left ||
            y - radius > bounds.bottom || y + radius < bounds.top) continue;

        this.ctx.fillStyle = p.color;
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        this.ctx.lineWidth = 3;
        this.ctx.stroke();

        if (p.id === this.currentPlayer.id) {
          this.ctx.strokeStyle = '#fff';
          this.ctx.lineWidth = 5;
          this.ctx.stroke();
        }

        if (radius > 15) {
          this.ctx.fillStyle = '#fff';
          this.ctx.strokeStyle = '#000';
          this.ctx.lineWidth = 3;
          const fontSize = Math.max(12, radius / 3);
          this.ctx.font = `bold ${fontSize}px Arial`;
          this.ctx.textAlign = 'center';
          this.ctx.textBaseline = 'middle';
          
          this.ctx.strokeText(p.name, x, y);
          this.ctx.fillText(p.name, x, y);

          if (p.isBot) {
            this.ctx.font = `${fontSize * 0.6}px Arial`;
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            this.ctx.fillText('BOT', x, y + fontSize + 5);
          }
        }
      }
    },

    updateLeaderboard() {
      this.leaderboard = [...this.players]
        .sort((a, b) => b.mass - a.mass)
        .slice(0, 10);
    }
  };
}