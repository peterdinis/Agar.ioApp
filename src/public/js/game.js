function gameApp() {
  return {
    // Game state
    gameStarted: false,
    gameOver: false,
    playerName: '',
    currentPlayer: null,
    leaderboard: [],
    playerCount: 0,
    finalMass: 0,
    finalPosition: 0,
    eatenBy: '',
    
    // Socket and game variables
    socket: null,
    canvas: null,
    ctx: null,
    players: {},
    foods: {},
    viruses: {},
    camera: { x: 0, y: 0 },
    
    init() {
      this.canvas = document.getElementById('gameCanvas');
      this.ctx = this.canvas.getContext('2d');
      this.resizeCanvas();
      window.addEventListener('resize', () => this.resizeCanvas());
    },
    
    resizeCanvas() {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    },
    
    startGame() {
      if (!this.playerName.trim()) {
        this.playerName = 'Player' + Math.floor(Math.random() * 1000);
      }
      
      this.socket = io();
      this.setupSocketEvents();
      
      this.gameStarted = true;
      this.gameOver = false;
      
      this.socket.emit('joinGame', {
        name: this.playerName,
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight
      });
      
      this.gameLoop();
    },
    
    setupSocketEvents() {
      this.socket.on('gameState', (data) => {
        this.players = data.players;
        this.foods = data.foods;
        this.viruses = data.viruses;
        
        // Update current player
        if (data.players[this.socket.id]) {
          this.currentPlayer = data.players[this.socket.id];
          
          // Update camera position
          this.camera.x = this.currentPlayer.x - this.canvas.width / 2;
          this.camera.y = this.currentPlayer.y - this.canvas.height / 2;
        }
      });
      
      this.socket.on('leaderboardUpdate', (leaderboard) => {
        this.leaderboard = leaderboard;
      });
      
      this.socket.on('playerCountUpdate', (count) => {
        this.playerCount = count;
      });
      
      this.socket.on('gameOver', (data) => {
        this.finalMass = data.mass;
        this.finalPosition = data.position;
        this.eatenBy = data.eatenBy;
        this.gameOver = true;
        this.gameStarted = false;
        
        // Disconnect socket when returning to menu
        if (this.socket) {
          this.socket.disconnect();
          this.socket = null;
        }
      });
      
      this.socket.on('playerDisconnected', (playerId) => {
        // Player disconnected - server should handle this, but we can remove locally
        if (this.players[playerId]) {
          delete this.players[playerId];
        }
      });
      
      // Handle mouse movement
      this.canvas.addEventListener('mousemove', (e) => {
        if (this.socket && this.currentPlayer) {
          const rect = this.canvas.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;
          
          const targetX = this.camera.x + mouseX;
          const targetY = this.camera.y + mouseY;
          
          this.socket.emit('mouseMove', { x: targetX, y: targetY });
        }
      });
      
      // Handle space bar for splitting
      document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && this.socket) {
          e.preventDefault();
          this.socket.emit('split');
        }
      });
    },
    
    gameLoop() {
      if (!this.gameStarted) return;
      
      this.ctx.fillStyle = '#f0f0f0';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      
      // Draw grid
      this.drawGrid();
      
      // Draw all game objects relative to camera
      this.ctx.save();
      this.ctx.translate(-this.camera.x, -this.camera.y);
      
      // Draw foods
      this.drawFoods();
      
      // Draw viruses
      this.drawViruses();
      
      // Draw players
      this.drawPlayers();
      
      this.ctx.restore();
      
      requestAnimationFrame(() => this.gameLoop());
    },
    
    drawGrid() {
      const gridSize = 100;
      
      this.ctx.strokeStyle = '#e0e0e0';
      this.ctx.lineWidth = 1;
      
      // Calculate visible area in world coordinates
      const startX = this.camera.x;
      const startY = this.camera.y;
      const endX = this.camera.x + this.canvas.width;
      const endY = this.camera.y + this.canvas.height;
      
      // Vertical lines
      for (let x = Math.floor(startX / gridSize) * gridSize; x <= endX; x += gridSize) {
        const screenX = x - this.camera.x;
        this.ctx.beginPath();
        this.ctx.moveTo(screenX, 0);
        this.ctx.lineTo(screenX, this.canvas.height);
        this.ctx.stroke();
      }
      
      // Horizontal lines
      for (let y = Math.floor(startY / gridSize) * gridSize; y <= endY; y += gridSize) {
        const screenY = y - this.camera.y;
        this.ctx.beginPath();
        this.ctx.moveTo(0, screenY);
        this.ctx.lineTo(this.canvas.width, screenY);
        this.ctx.stroke();
      }
    },
    
    drawFoods() {
      Object.values(this.foods).forEach(food => {
        this.ctx.fillStyle = food.color;
        this.ctx.beginPath();
        this.ctx.arc(food.x, food.y, food.radius, 0, Math.PI * 2);
        this.ctx.fill();
      });
    },
    
    drawViruses() {
      Object.values(this.viruses).forEach(virus => {
        this.ctx.fillStyle = virus.color;
        this.ctx.beginPath();
        this.ctx.arc(virus.x, virus.y, virus.radius, 0, Math.PI * 2);
        this.ctx.fill();
        
        // Draw virus spikes
        this.ctx.strokeStyle = virus.color;
        this.ctx.lineWidth = 2;
        const spikes = 8;
        for (let i = 0; i < spikes; i++) {
          const angle = (i / spikes) * Math.PI * 2;
          const spikeLength = virus.radius * 1.5;
          const startX = virus.x + Math.cos(angle) * virus.radius;
          const startY = virus.y + Math.sin(angle) * virus.radius;
          const endX = virus.x + Math.cos(angle) * spikeLength;
          const endY = virus.y + Math.sin(angle) * spikeLength;
          
          this.ctx.beginPath();
          this.ctx.moveTo(startX, startY);
          this.ctx.lineTo(endX, endY);
          this.ctx.stroke();
        }
      });
    },
    
    drawPlayers() {
      Object.values(this.players).forEach(player => {
        // Draw player cell(s)
        player.cells.forEach(cell => {
          this.ctx.fillStyle = player.color;
          this.ctx.beginPath();
          this.ctx.arc(cell.x, cell.y, cell.radius, 0, Math.PI * 2);
          this.ctx.fill();
          
          // Draw player name
          this.ctx.fillStyle = '#fff';
          this.ctx.font = `${Math.max(12, cell.radius / 3)}px Arial`;
          this.ctx.textAlign = 'center';
          this.ctx.textBaseline = 'middle';
          this.ctx.fillText(player.name, cell.x, cell.y);
        });
      });
    },
    
    restartGame() {
      this.gameOver = false;
      this.startGame();
    },
    
    backToMenu() {
      this.gameStarted = false;
      this.gameOver = false;
      this.currentPlayer = null;
      this.leaderboard = [];
      this.playerCount = 0;
      
      // Ensure socket is disconnected
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }
    }
  };
}