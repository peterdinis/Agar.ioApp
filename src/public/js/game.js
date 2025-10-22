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

    init() {
      this.socket = io({
        transports: ['websocket'],
        upgrade: false,
      });
      this.setupSocketListeners();
    },

    setupSocketListeners() {
      this.socket.on('init', (data) => {
        this.currentPlayer = data.player;
        this.worldWidth = data.worldWidth;
        this.worldHeight = data.worldHeight;
        this.initCanvas();
        this.startGameLoop();
      });

      this.socket.on('update', (gameState) => {
        if (this.gameOver) return;

        this.players = gameState.players;
        this.food = gameState.food;
        this.playerCount = this.players.length;

        const current = this.players.find(p => p.id === this.currentPlayer?.id);
        if (current) {
          this.currentPlayer = current;
        } else {
          // Player was eaten
          this.handlePlayerDeath();
        }

        this.updateLeaderboard();
        this.updateInterpolation();
      });

      this.socket.on('eaten', (data) => {
        this.handlePlayerDeath(data);
      });

      this.socket.on('playerDeath', (data) => {
        if (data.playerId === this.currentPlayer?.id) {
          this.handlePlayerDeath(data);
        }
      });
    },

    handlePlayerDeath(data = {}) {
      if (this.gameOver) return;

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
      this.players.forEach(p => {
        if (!this.interpolatedPlayers.has(p.id)) {
          this.interpolatedPlayers.set(p.id, { x: p.x, y: p.y, radius: p.radius });
        }
      });
    },

    startGame() {
      if (!this.playerName.trim()) {
        this.playerName = 'Anonymous';
      }
      this.gameStarted = true;
      this.gameOver = false;
      this.finalMass = 0;
      this.finalPosition = 0;
      this.eatenBy = '';
      this.socket.emit('join', this.playerName);
    },

    restartGame() {
      this.gameOver = false;
      this.startGame();
    },

    backToMenu() {
      this.gameOver = false;
      this.gameStarted = false;
      this.currentPlayer = null;
      this.players = [];
      this.food = [];
      this.interpolatedPlayers.clear();
      
      if (this.canvas) {
        const ctx = this.canvas.getContext('2d');
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }
    },

    // ... (zvyšok funkcií zostáva rovnaký: initCanvas, resizeCanvas, startGameLoop, update, render, drawGrid, drawFood, drawPlayers, updateLeaderboard)
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
        
        this.update(delta);
        this.render();
        
        this.lastRender = timestamp;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },

    update(delta) {
      if (!this.currentPlayer || this.gameOver) return;

      const targetX = this.camera.x + this.mouse.x;
      const targetY = this.camera.y + this.mouse.y;

      this.socket.emit('move', { x: targetX, y: targetY });

      const lerpFactor = 0.1;
      const targetCameraX = this.currentPlayer.x - this.canvas.width / 2;
      const targetCameraY = this.currentPlayer.y - this.canvas.height / 2;
      
      this.camera.x += (targetCameraX - this.camera.x) * lerpFactor;
      this.camera.y += (targetCameraY - this.camera.y) * lerpFactor;

      this.players.forEach(p => {
        const interp = this.interpolatedPlayers.get(p.id);
        if (interp) {
          interp.x += (p.x - interp.x) * 0.3;
          interp.y += (p.y - interp.y) * 0.3;
          interp.radius += (p.radius - interp.radius) * 0.2;
        }
      });
    },

    render() {
      if (!this.ctx) return;

      this.ctx.fillStyle = '#222';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      if (!this.currentPlayer || this.gameOver) return;

      this.ctx.save();
      this.ctx.translate(-this.camera.x, -this.camera.y);

      this.drawGrid();
      
      const viewBounds = {
        left: this.camera.x - 100,
        right: this.camera.x + this.canvas.width + 100,
        top: this.camera.y - 100,
        bottom: this.camera.y + this.canvas.height + 100,
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
      this.food.forEach(f => {
        if (f.x < bounds.left || f.x > bounds.right || 
            f.y < bounds.top || f.y > bounds.bottom) return;

        this.ctx.fillStyle = f.color;
        this.ctx.beginPath();
        this.ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        this.ctx.fill();
      });
    },

    drawPlayers(bounds) {
      const sortedPlayers = [...this.players].sort((a, b) => a.radius - b.radius);

      sortedPlayers.forEach(p => {
        const interp = this.interpolatedPlayers.get(p.id);
        const x = interp ? interp.x : p.x;
        const y = interp ? interp.y : p.y;
        const radius = interp ? interp.radius : p.radius;

        if (x - radius > bounds.right || x + radius < bounds.left ||
            y - radius > bounds.bottom || y + radius < bounds.top) return;

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

        this.ctx.fillStyle = '#fff';
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = 3;
        const fontSize = Math.max(14, radius / 2.5);
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
      });
    },

    updateLeaderboard() {
      this.leaderboard = [...this.players]
        .sort((a, b) => b.mass - a.mass)
        .slice(0, 10);
    }
  };
}