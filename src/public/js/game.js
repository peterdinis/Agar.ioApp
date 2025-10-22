function gameApp() {
  return {
    socket: null,
    gameStarted: false,
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

    init() {
      this.socket = io();
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
        this.players = gameState.players;
        this.food = gameState.food;
        this.playerCount = this.players.length;

        const current = this.players.find(p => p.id === this.currentPlayer?.id);
        if (current) {
          this.currentPlayer = current;
        }

        this.updateLeaderboard();
      });
    },

    startGame() {
      if (!this.playerName.trim()) {
        this.playerName = 'Anonymous';
      }
      this.gameStarted = true;
      this.socket.emit('join', this.playerName);
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
      const loop = () => {
        this.update();
        this.render();
        requestAnimationFrame(loop);
      };
      loop();
    },

    update() {
      if (!this.currentPlayer) return;

      const targetX = this.camera.x + this.mouse.x;
      const targetY = this.camera.y + this.mouse.y;

      this.socket.emit('move', { x: targetX, y: targetY });

      this.camera.x = this.currentPlayer.x - this.canvas.width / 2;
      this.camera.y = this.currentPlayer.y - this.canvas.height / 2;
    },

    render() {
      if (!this.ctx || !this.currentPlayer) return;

      this.ctx.fillStyle = '#222';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

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
      const endX = startX + this.canvas.width + gridSize;
      const endY = startY + this.canvas.height + gridSize;

      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      this.ctx.lineWidth = 1;

      for (let x = startX; x < endX; x += gridSize) {
        this.ctx.beginPath();
        this.ctx.moveTo(x, this.camera.y);
        this.ctx.lineTo(x, this.camera.y + this.canvas.height);
        this.ctx.stroke();
      }

      for (let y = startY; y < endY; y += gridSize) {
        this.ctx.beginPath();
        this.ctx.moveTo(this.camera.x, y);
        this.ctx.lineTo(this.camera.x + this.canvas.width, y);
        this.ctx.stroke();
      }
    },

    drawFood() {
      this.food.forEach(f => {
        this.ctx.fillStyle = f.color;
        this.ctx.beginPath();
        this.ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        this.ctx.fill();
      });
    },

    drawPlayers() {
      this.players.forEach(p => {
        this.ctx.fillStyle = p.color;
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        this.ctx.lineWidth = 3;
        this.ctx.stroke();

        if (p.id === this.currentPlayer.id) {
          this.ctx.strokeStyle = '#fff';
          this.ctx.lineWidth = 4;
          this.ctx.stroke();
        }

        this.ctx.fillStyle = '#fff';
        this.ctx.font = `bold ${Math.max(12, p.radius / 3)}px Arial`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(p.name, p.x, p.y);
      });
    },

    updateLeaderboard() {
      this.leaderboard = [...this.players]
        .sort((a, b) => b.mass - a.mass)
        .slice(0, 10);
    }
  };
}