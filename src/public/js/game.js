class GameApp {
  constructor() {
    this.socket = null;
    this.gameStarted = false;
    this.gameOver = false;
    this.playerName = "";
    this.currentPlayer = null;
    this.players = [];
    this.food = [];
    this.playerCount = 0;
    this.leaderboard = [];
    
    // Pixi.js
    this.app = null;
    this.playerContainer = null;
    this.foodContainer = null;
    this.gridContainer = null;
    this.playerSprites = new Map();
    this.foodSprites = new Map();
    
    // Camera
    this.camera = { x: 0, y: 0 };
    this.mouse = { x: 0, y: 0 };
    
    // World
    this.worldWidth = 5000;
    this.worldHeight = 5000;
    
    // Interpolation
    this.playerStates = new Map();
    this.serverUpdateTime = 0;
    this.lastServerTimestamp = 0;
    
    // Game state
    this.finalMass = 0;
    this.finalPosition = 0;
    this.eatenBy = "";
    
    // Settings
    this.SERVER_UPDATE_RATE = 50;
    this.MOVE_SEND_RATE = 16;
    this.CAMERA_SMOOTHING = 0.08;
    
    // Timing
    this.lastMoveSend = 0;

    this.init();
  }

  init() {
    console.log('Initializing GameApp...');
    
    // Initialize Socket.IO
    this.socket = io({
      transports: ["websocket"],
      upgrade: false
    });
    
    this.setupSocketListeners();
    this.setupEventListeners();
    
    // Initialize Pixi.js immediately
    this.initPixi();
  }

  initPixi() {
    try {
      // Create Pixi application
      this.app = new PIXI.Application({
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundColor: 0x1a1a1a,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true
      });

      // Add canvas to DOM
      const gameContainer = document.getElementById('gameCanvasContainer');
      if (gameContainer) {
        gameContainer.appendChild(this.app.view);
        console.log('Pixi.js canvas added to DOM');
      } else {
        console.error('Game container not found');
        return;
      }

      // Create containers
      this.gridContainer = new PIXI.Container();
      this.foodContainer = new PIXI.Container();
      this.playerContainer = new PIXI.Container();

      // Add containers to stage
      this.app.stage.addChild(this.gridContainer);
      this.app.stage.addChild(this.foodContainer);
      this.app.stage.addChild(this.playerContainer);

      // Draw initial grid
      this.drawGrid();

      // Handle window resize
      window.addEventListener('resize', () => this.resizeCanvas());
      
      // Mouse movement
      this.app.view.addEventListener('mousemove', (e) => {
        const rect = this.app.view.getBoundingClientRect();
        this.mouse.x = e.clientX - rect.left;
        this.mouse.y = e.clientY - rect.top;
      });

      // Touch support for mobile devices
      this.app.view.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const rect = this.app.view.getBoundingClientRect();
        if (e.touches[0]) {
          this.mouse.x = e.touches[0].clientX - rect.left;
          this.mouse.y = e.touches[0].clientY - rect.top;
        }
      }, { passive: false });

    } catch (error) {
      console.error('Error initializing Pixi.js:', error);
    }
  }

  drawGrid() {
    if (!this.gridContainer || !this.app) return;

    const gridSize = 100;
    const gridColor = 0x333333;
    const gridAlpha = 0.2;

    // Clear previous grid
    this.gridContainer.removeChildren();

    // Calculate visible grid area based on camera
    const startX = Math.floor(this.camera.x / gridSize) * gridSize;
    const startY = Math.floor(this.camera.y / gridSize) * gridSize;
    const endX = startX + this.app.screen.width + gridSize * 2;
    const endY = startY + this.app.screen.height + gridSize * 2;

    // Draw vertical lines
    for (let x = startX; x < endX; x += gridSize) {
      const line = new PIXI.Graphics();
      line.lineStyle(1, gridColor, gridAlpha);
      line.moveTo(x, startY);
      line.lineTo(x, endY);
      this.gridContainer.addChild(line);
    }

    // Draw horizontal lines
    for (let y = startY; y < endY; y += gridSize) {
      const line = new PIXI.Graphics();
      line.lineStyle(1, gridColor, gridAlpha);
      line.moveTo(startX, y);
      line.lineTo(endX, y);
      this.gridContainer.addChild(line);
    }
  }

  resizeCanvas() {
    if (!this.app) return;
    this.app.renderer.resize(window.innerWidth, window.innerHeight);
    this.drawGrid();
  }

  setupEventListeners() {
    // Start game button
    const startBtn = document.getElementById('startBtn');
    const nameInput = document.getElementById('nameInput');

    if (startBtn && nameInput) {
      startBtn.addEventListener('click', () => {
        console.log('Start button clicked');
        this.playerName = nameInput.value.trim() || "Anonymous";
        this.startGame();
      });

      nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          console.log('Enter pressed in name input');
          this.playerName = nameInput.value.trim() || "Anonymous";
          this.startGame();
        }
      });
    }

    // Game over buttons
    const restartBtn = document.getElementById('restartBtn');
    const backToMenuBtn = document.getElementById('backToMenuBtn');

    if (restartBtn) {
      restartBtn.addEventListener('click', () => {
        console.log('Restart button clicked');
        this.restartGame();
      });
    }

    if (backToMenuBtn) {
      backToMenuBtn.addEventListener('click', () => {
        console.log('Back to menu button clicked');
        this.backToMenu();
      });
    }
  }

  setupSocketListeners() {
    if (!this.socket) {
      console.error('Socket is not initialized!');
      return;
    }

    this.socket.on("connect", () => {
      console.log("Connected to server");
    });

    this.socket.on("connect_error", (error) => {
      console.error("Connection error:", error);
    });

    this.socket.on("init", (data) => {
      console.log("Received init data from server");
      this.currentPlayer = data.player;
      this.worldWidth = data.worldWidth;
      this.worldHeight = data.worldHeight;

      this.initPlayerInterpolation(this.currentPlayer.id, this.currentPlayer);
      this.startGameLoop();
      this.updateUI();
    });

    this.socket.on("gameUpdate", (gameState) => {
      if (this.gameOver || !this.gameStarted) return;

      this.serverUpdateTime = Date.now();
      this.lastServerTimestamp = gameState.ts;
      this.processServerUpdate(gameState);
      this.updateUI();
    });

    this.socket.on("playerDeath", (data) => {
      console.log("Player death received:", data);
      if (data.playerId === this.currentPlayer?.id) {
        this.handlePlayerDeath(data);
        this.updateUI();
      }
    });

    this.socket.on("disconnect", () => {
      console.log("Disconnected from server");
    });
  }

  initPlayerInterpolation(playerId, initialData) {
    this.playerStates.set(playerId, {
      current: { ...initialData },
      target: { ...initialData },
      lastUpdate: Date.now(),
      interpolationTime: this.SERVER_UPDATE_RATE,
    });
  }

  processServerUpdate(gameState) {
    const now = Date.now();

    // Process players
    for (const serverPlayer of gameState.players || []) {
      let playerState = this.playerStates.get(serverPlayer.id);

      if (!playerState) {
        // New player
        this.initPlayerInterpolation(serverPlayer.id, serverPlayer);
        this.players.push({ ...serverPlayer });
        continue;
      }

      // Update target position for interpolation
      playerState.target = { ...serverPlayer };
      playerState.lastUpdate = now;
      playerState.interpolationTime = this.SERVER_UPDATE_RATE;

      // Immediate update of properties except position
      playerState.current.mass = serverPlayer.mass;
      playerState.current.radius = serverPlayer.radius;
      playerState.current.color = serverPlayer.color;
      playerState.current.name = serverPlayer.name;

      // Update in players list
      const existingPlayer = this.players.find((p) => p.id === serverPlayer.id);
      if (existingPlayer) {
        existingPlayer.mass = serverPlayer.mass;
        existingPlayer.radius = serverPlayer.radius;
        existingPlayer.color = serverPlayer.color;
        existingPlayer.name = serverPlayer.name;
      }
    }

    // Process food
    this.food = gameState.food || [];

    // Update player count
    this.playerCount = gameState.totalPlayers || this.playerStates.size;

    // Leaderboard
    this.updateLeaderboard();

    // Remove disconnected players
    const currentPlayerIds = new Set((gameState.players || []).map((p) => p.id));
    for (const [playerId] of this.playerStates) {
      if (!currentPlayerIds.has(playerId) && playerId !== this.currentPlayer?.id) {
        this.playerStates.delete(playerId);
        this.players = this.players.filter((p) => p.id !== playerId);
        this.removePlayerSprite(playerId);
      }
    }
  }

  updateLeaderboard() {
    const players = Array.from(this.playerStates.values())
      .map((state) => state.current)
      .sort((a, b) => b.mass - a.mass)
      .slice(0, 10);

    this.leaderboard = players;
  }

  handlePlayerDeath(data = {}) {
    if (this.gameOver) return;
    
    this.gameOver = true;
    this.gameStarted = false;
    this.finalMass = data.finalMass || this.currentPlayer?.mass || 0;
    this.eatenBy = data.eatenBy || "Another player";

    const sorted = [...this.leaderboard].sort((a, b) => b.mass - a.mass);
    const pos = sorted.findIndex((p) => p.id === this.currentPlayer?.id) + 1;
    this.finalPosition = pos > 0 ? pos : 0;
    
    this.updateUI();
  }

  updateUI() {
    // Update mass display
    const massElement = document.getElementById('massValue');
    if (massElement) {
      massElement.textContent = Math.floor(this.currentPlayer?.mass || 0).toString();
    }

    // Update player count
    const playerCountElement = document.getElementById('playerCountValue');
    if (playerCountElement) {
      playerCountElement.textContent = this.playerCount.toString();
    }

    // Update leaderboard
    this.updateLeaderboardUI();

    // Update game over screen
    if (this.gameOver) {
      this.updateGameOverUI();
    }

    // Show/hide screens based on game state
    this.updateScreenVisibility();
  }

  updateLeaderboardUI() {
    const leaderboardContainer = document.getElementById('leaderboardContainer');
    if (!leaderboardContainer) return;

    leaderboardContainer.innerHTML = '';
    
    this.leaderboard.slice(0, 10).forEach((player, index) => {
      const item = document.createElement('div');
      const isCurrentPlayer = player.id === this.currentPlayer?.id;
      item.className = `leaderboard-item ${isCurrentPlayer ? 'current-player' : ''}`;
      
      item.innerHTML = `
        <span class="leaderboard-name">${index + 1}. ${player.name}</span>
        <span class="leaderboard-mass">${Math.floor(player.mass)}</span>
      `;
      
      leaderboardContainer.appendChild(item);
    });
  }

  updateGameOverUI() {
    const finalMassElement = document.getElementById('finalMassValue');
    if (finalMassElement) {
      finalMassElement.textContent = Math.floor(this.finalMass).toString();
    }

    const finalPositionElement = document.getElementById('finalPositionValue');
    if (finalPositionElement) {
      finalPositionElement.textContent = this.finalPosition.toString();
    }

    const eatenByElement = document.getElementById('eatenByValue');
    if (eatenByElement) {
      eatenByElement.textContent = this.eatenBy || 'Unknown';
    }
  }

  updateScreenVisibility() {
    const menuScreen = document.getElementById('menuScreen');
    const gameScreen = document.getElementById('gameScreen');
    const gameOverScreen = document.getElementById('gameOverScreen');

    if (menuScreen) {
      menuScreen.style.display = (!this.gameStarted && !this.gameOver) ? 'flex' : 'none';
    }
    if (gameScreen) {
      gameScreen.style.display = (this.gameStarted && !this.gameOver) ? 'block' : 'none';
    }
    if (gameOverScreen) {
      gameOverScreen.style.display = this.gameOver ? 'flex' : 'none';
    }
  }

  startGame() {
    console.log('startGame() called');
    
    if (!this.playerName.trim()) {
      this.playerName = "Anonymous";
    }
    
    console.log('Player name:', this.playerName);
    console.log('Socket connected:', this.socket?.connected);
    
    this.gameStarted = true;
    this.gameOver = false;
    this.finalMass = 0;
    this.finalPosition = 0;
    this.eatenBy = "";
    this.playerStates.clear();
    this.players = [];
    this.food = [];
    this.camera = { x: 0, y: 0 };
    this.lastMoveSend = 0;
    
    // Clear all sprites
    this.playerSprites.clear();
    this.foodSprites.clear();
    
    if (this.playerContainer) {
      this.playerContainer.removeChildren();
    }
    
    if (this.foodContainer) {
      this.foodContainer.removeChildren();
    }
    
    if (this.socket) {
      console.log('Emitting join event with name:', this.playerName);
      this.socket.emit("join", this.playerName);
    } else {
      console.error('Socket is not initialized!');
    }

    this.updateUI();
    console.log('Game started with name:', this.playerName);
  }

  restartGame() {
    console.log('restartGame() called');
    this.startGame();
  }

  backToMenu() {
    console.log('backToMenu() called');
    this.gameStarted = false;
    this.gameOver = false;
    this.currentPlayer = null;
    this.players = [];
    this.food = [];
    this.playerCount = 0;
    this.leaderboard = [];
    this.playerStates.clear();
    this.camera = { x: 0, y: 0 };
    
    // Clear all sprites
    this.playerSprites.clear();
    this.foodSprites.clear();
    
    if (this.playerContainer) {
      this.playerContainer.removeChildren();
    }
    
    if (this.foodContainer) {
      this.foodContainer.removeChildren();
    }

    this.updateUI();
  }

  startGameLoop() {
    if (!this.app) return;

    console.log('Starting game loop');
    
    // Start Pixi.js ticker
    this.app.ticker.add(() => {
      this.update();
      this.render();
    });
  }

  update() {
    if (!this.currentPlayer || this.gameOver || !this.gameStarted) return;

    // Interpolate all players
    this.interpolatePlayers();

    // Send mouse position
    this.sendMousePosition();

    // Update camera
    this.updateCamera();
  }

  interpolatePlayers() {
    const now = Date.now();

    for (const [playerId, state] of this.playerStates) {
      const timeSinceUpdate = now - state.lastUpdate;
      const interpolationFactor = Math.min(
        1,
        timeSinceUpdate / state.interpolationTime,
      );

      // Smooth position interpolation
      state.current.x = this.lerp(state.current.x, state.target.x, interpolationFactor);
      state.current.y = this.lerp(state.current.y, state.target.y, interpolationFactor);

      // Smooth size interpolation
      state.current.radius = this.lerp(state.current.radius, state.target.radius, interpolationFactor * 0.5);

      // Update current player
      if (playerId === this.currentPlayer.id) {
        this.currentPlayer.x = state.current.x;
        this.currentPlayer.y = state.current.y;
        this.currentPlayer.radius = state.current.radius;
        this.currentPlayer.mass = state.current.mass;
      }
    }
  }

  lerp(start, end, factor) {
    return start + (end - start) * factor;
  }

  sendMousePosition() {
    const now = Date.now();

    if (now - this.lastMoveSend >= this.MOVE_SEND_RATE && this.socket) {
      const targetX = this.camera.x + this.mouse.x;
      const targetY = this.camera.y + this.mouse.y;

      this.socket.emit("move", {
        x: Math.round(targetX),
        y: Math.round(targetY),
      });

      this.lastMoveSend = now;
    }
  }

  updateCamera() {
    if (!this.currentPlayer || !this.app) return;

    const targetX = this.currentPlayer.x - this.app.screen.width / 2;
    const targetY = this.currentPlayer.y - this.app.screen.height / 2;

    // Smooth camera following
    this.camera.x += (targetX - this.camera.x) * this.CAMERA_SMOOTHING;
    this.camera.y += (targetY - this.camera.y) * this.CAMERA_SMOOTHING;

    // Update container positions
    if (this.gridContainer) {
      this.gridContainer.x = -this.camera.x;
      this.gridContainer.y = -this.camera.y;
    }
    
    if (this.foodContainer) {
      this.foodContainer.x = -this.camera.x;
      this.foodContainer.y = -this.camera.y;
    }
    
    if (this.playerContainer) {
      this.playerContainer.x = -this.camera.x;
      this.playerContainer.y = -this.camera.y;
    }

    // Redraw grid when camera moves significantly
    if (this.gridContainer && (Math.abs(this.camera.x) > 50 || Math.abs(this.camera.y) > 50)) {
      this.drawGrid();
    }
  }

  render() {
    if (!this.app || !this.currentPlayer || this.gameOver || !this.gameStarted) return;

    this.drawFood();
    this.drawPlayers();
  }

  drawFood() {
    if (!this.foodContainer) return;

    // Update existing food sprites and create new ones
    for (const foodItem of this.food) {
      let foodSprite = this.foodSprites.get(foodItem.id);

      if (!foodSprite) {
        // Create new food sprite
        foodSprite = new PIXI.Graphics();
        foodSprite.beginFill(this.hexToNumber(foodItem.color));
        foodSprite.drawCircle(0, 0, foodItem.radius);
        foodSprite.endFill();
        
        this.foodContainer.addChild(foodSprite);
        this.foodSprites.set(foodItem.id, foodSprite);
      }

      // Update position
      foodSprite.x = foodItem.x;
      foodSprite.y = foodItem.y;
    }

    // Remove food that no longer exists
    const currentFoodIds = new Set(this.food.map(f => f.id));
    for (const [foodId, sprite] of this.foodSprites) {
      if (!currentFoodIds.has(foodId)) {
        this.foodContainer.removeChild(sprite);
        this.foodSprites.delete(foodId);
      }
    }
  }

  drawPlayers() {
    if (!this.playerContainer) return;

    // Update existing player sprites and create new ones
    for (const [playerId, state] of this.playerStates) {
      const player = state.current;
      let playerSprite = this.playerSprites.get(playerId);

      if (!playerSprite) {
        // Create new player sprite
        playerSprite = new PIXI.Graphics();
        this.playerContainer.addChild(playerSprite);
        this.playerSprites.set(playerId, playerSprite);
      }

      // Clear and redraw player
      playerSprite.clear();
      
      // Draw player body
      playerSprite.beginFill(this.hexToNumber(player.color));
      playerSprite.drawCircle(0, 0, player.radius);
      playerSprite.endFill();
      
      // Draw border
      const isSelf = playerId === this.currentPlayer?.id;
      playerSprite.lineStyle(isSelf ? 4 : 2, isSelf ? 0xFFFFFF : 0x000000, isSelf ? 1 : 0.4);
      playerSprite.drawCircle(0, 0, player.radius);
      
      // Update position
      playerSprite.x = player.x;
      playerSprite.y = player.y;

      // Draw player name for larger players
      if (player.radius >= 20) {
        // For names, we'd need to use PIXI.Text, but for simplicity we'll skip it here
      }
    }

    // Remove players that no longer exist
    const currentPlayerIds = new Set(Array.from(this.playerStates.keys()));
    for (const [playerId, sprite] of this.playerSprites) {
      if (!currentPlayerIds.has(playerId)) {
        this.playerContainer.removeChild(sprite);
        this.playerSprites.delete(playerId);
      }
    }
  }

  removePlayerSprite(playerId) {
    const sprite = this.playerSprites.get(playerId);
    if (sprite && this.playerContainer) {
      this.playerContainer.removeChild(sprite);
      this.playerSprites.delete(playerId);
    }
  }

  hexToNumber(hex) {
    return parseInt(hex.replace('#', ''), 16);
  }
}

// Initialize game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing game');
  window.gameApp = new GameApp();
});