import * as PIXI from 'pixi.js';
import { io, Socket } from 'socket.io-client';

// Interfaces
interface Player {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  name: string;
  mass: number;
}

interface Food {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
}

interface PlayerState {
  current: Player;
  target: Player;
  lastUpdate: number;
  interpolationTime: number;
}

interface GameState {
  ts: number;
  players: Player[];
  food: Food[];
  totalPlayers: number;
}

interface InitData {
  player: Player;
  worldWidth: number;
  worldHeight: number;
}

interface DeathData {
  playerId: string;
  eatenBy: string;
}

interface MoveData {
  x: number;
  y: number;
}

// Alpine.js data interface
interface AlpineGameData {
  gameStarted: boolean;
  gameOver: boolean;
  playerName: string;
  currentPlayer: Player | null;
  playerCount: number;
  leaderboard: Player[];
  finalMass: number;
  finalPosition: number;
  eatenBy: string;
}

export class GameApp {
  private socket: Socket | null = null;
  private gameStarted: boolean = false;
  private gameOver: boolean = false;
  private playerName: string = "";
  private currentPlayer: Player | null = null;
  private players: Player[] = [];
  private food: Food[] = [];
  private playerCount: number = 0;
  private leaderboard: Player[] = [];
  
  // Pixi.js
  private app: PIXI.Application | null = null;
  private playerContainer: PIXI.Container | null = null;
  private foodContainer: PIXI.Container | null = null;
  private gridContainer: PIXI.Container | null = null;
  private playerSprites: Map<string, PIXI.Graphics> = new Map();
  private foodSprites: Map<string, PIXI.Graphics> = new Map();
  
  // Camera
  private camera: { x: number; y: number } = { x: 0, y: 0 };
  private mouse: { x: number; y: number } = { x: 0, y: 0 };
  
  // World
  private worldWidth: number = 5000;
  private worldHeight: number = 5000;
  
  // Interpolation
  private playerStates: Map<string, PlayerState> = new Map();
  private serverUpdateTime: number = 0;
  private lastServerTimestamp: number = 0;
  
  // Game state
  private finalMass: number = 0;
  private finalPosition: number = 0;
  private eatenBy: string = "";
  
  // Settings
  private readonly SERVER_UPDATE_RATE: number = 50;
  private readonly MOVE_SEND_RATE: number = 16;
  private readonly CAMERA_SMOOTHING: number = 0.08;
  
  // Timing
  private lastMoveSend: number = 0;

  constructor() {
    this.init();
  }

  public init(): void {
    // Initialize Socket.IO with proper typing
    this.socket = io({
      transports: ["websocket"],
      upgrade: false
    });
    
    this.setupSocketListeners();
    this.initPixi();
    this.setupEventListeners();
    this.initializeAlpineData();
  }

  private initializeAlpineData(): void {
    // Initialize Alpine.js data structure
    const alpineData: AlpineGameData = {
      gameStarted: this.gameStarted,
      gameOver: this.gameOver,
      playerName: this.playerName,
      currentPlayer: this.currentPlayer,
      playerCount: this.playerCount,
      leaderboard: this.leaderboard,
      finalMass: this.finalMass,
      finalPosition: this.finalPosition,
      eatenBy: this.eatenBy
    };
    
    (window as any).alpineGameData = alpineData;
  }

  private updateAlpineData(): void {
    if (!(window as any).alpineGameData) return;
    
    const alpineData = (window as any).alpineGameData as AlpineGameData;
    alpineData.gameStarted = this.gameStarted;
    alpineData.gameOver = this.gameOver;
    alpineData.playerName = this.playerName;
    alpineData.currentPlayer = this.currentPlayer;
    alpineData.playerCount = this.playerCount;
    alpineData.leaderboard = this.leaderboard;
    alpineData.finalMass = this.finalMass;
    alpineData.finalPosition = this.finalPosition;
    alpineData.eatenBy = this.eatenBy;
  }

  private initPixi(): void {
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
        gameContainer.appendChild(this.app.view as HTMLCanvasElement);
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
    } catch (error) {
      console.error('Error initializing Pixi.js:', error);
    }
  }

  private drawGrid(): void {
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

  private resizeCanvas(): void {
    if (!this.app) return;

    this.app.renderer.resize(window.innerWidth, window.innerHeight);
    this.drawGrid();
  }

  private setupEventListeners(): void {
    // Mouse movement
    if (this.app) {
      this.app.view.addEventListener('mousemove', (e: MouseEvent) => {
        const rect = this.app!.view.getBoundingClientRect();
        this.mouse.x = e.clientX - rect.left;
        this.mouse.y = e.clientY - rect.top;
      });

      // Touch support for mobile devices
      this.app.view.addEventListener('touchmove', (e: TouchEvent) => {
        e.preventDefault();
        const rect = this.app!.view.getBoundingClientRect();
        this.mouse.x = e.touches[0].clientX - rect.left;
        this.mouse.y = e.touches[0].clientY - rect.top;
      }, { passive: false });
    }

    // Start game button
    const startBtn = document.getElementById('startBtn');
    const nameInput = document.getElementById('nameInput') as HTMLInputElement;

    if (startBtn && nameInput) {
      startBtn.addEventListener('click', () => {
        this.playerName = nameInput.value.trim() || "Anonymous";
        this.startGame();
      });

      nameInput.addEventListener('keypress', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          this.playerName = nameInput.value.trim() || "Anonymous";
          this.startGame();
        }
      });
    }
  }

  private setupSocketListeners(): void {
    if (!this.socket) return;

    this.socket.on("init", (data: InitData) => {
      this.currentPlayer = data.player;
      this.worldWidth = data.worldWidth;
      this.worldHeight = data.worldHeight;

      this.initPlayerInterpolation(this.currentPlayer.id, this.currentPlayer);
      this.startGameLoop();
      this.updateAlpineData();
    });

    this.socket.on("gameUpdate", (gameState: GameState) => {
      if (this.gameOver || !this.gameStarted) return;

      this.serverUpdateTime = Date.now();
      this.lastServerTimestamp = gameState.ts;
      this.processServerUpdate(gameState);
      this.updateAlpineData();
    });

    this.socket.on("playerDeath", (data: DeathData) => {
      if (data.playerId === this.currentPlayer?.id) {
        this.handlePlayerDeath(data);
        this.updateAlpineData();
      }
    });

    this.socket.on("disconnect", () => {
      console.log("Disconnected from server");
    });

    this.socket.on("connect", () => {
      console.log("Connected to server");
    });
  }

  private initPlayerInterpolation(playerId: string, initialData: Player): void {
    this.playerStates.set(playerId, {
      current: { ...initialData },
      target: { ...initialData },
      lastUpdate: Date.now(),
      interpolationTime: this.SERVER_UPDATE_RATE,
    });
  }

  private processServerUpdate(gameState: GameState): void {
    const now = Date.now();

    // Process players
    for (const serverPlayer of gameState.players) {
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
    this.food = [...gameState.food];

    // Update player count
    this.playerCount = gameState.totalPlayers;

    // Leaderboard
    this.updateLeaderboard();

    // Remove disconnected players
    const currentPlayerIds = new Set(gameState.players.map((p: Player) => p.id));
    for (const [playerId] of this.playerStates) {
      if (!currentPlayerIds.has(playerId) && playerId !== this.currentPlayer?.id) {
        this.playerStates.delete(playerId);
        this.players = this.players.filter((p) => p.id !== playerId);
        this.removePlayerSprite(playerId);
      }
    }
  }

  private updateLeaderboard(): void {
    const players = Array.from(this.playerStates.values())
      .map((state) => state.current)
      .sort((a, b) => b.mass - a.mass)
      .slice(0, 10);

    this.leaderboard = players;
  }

  private handlePlayerDeath(data: DeathData): void {
    if (this.gameOver) return;
    
    this.gameOver = true;
    this.gameStarted = false;
    this.finalMass = this.currentPlayer?.mass || 0;
    this.eatenBy = data.eatenBy || "Another player";

    const sorted = [...this.leaderboard].sort((a, b) => b.mass - a.mass);
    const pos = sorted.findIndex((p) => p.id === this.currentPlayer?.id) + 1;
    this.finalPosition = pos > 0 ? pos : 0;
  }

  public startGame(): void {
    if (!this.playerName.trim()) {
      this.playerName = "Anonymous";
    }
    
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
      this.socket.emit("join", this.playerName);
    }

    this.updateAlpineData();
  }

  public restartGame(): void {
    this.startGame();
  }

  public backToMenu(): void {
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

    this.updateAlpineData();
  }

  private startGameLoop(): void {
    if (!this.app) return;

    // Start Pixi.js ticker
    this.app.ticker.add(() => {
      this.update();
      this.render();
    });
  }

  private update(): void {
    if (!this.currentPlayer || this.gameOver || !this.gameStarted) return;

    // Interpolate all players
    this.interpolatePlayers();

    // Send mouse position
    this.sendMousePosition();

    // Update camera
    this.updateCamera();
  }

  private interpolatePlayers(): void {
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
      if (playerId === this.currentPlayer!.id) {
        this.currentPlayer!.x = state.current.x;
        this.currentPlayer!.y = state.current.y;
        this.currentPlayer!.radius = state.current.radius;
        this.currentPlayer!.mass = state.current.mass;
      }
    }
  }

  private lerp(start: number, end: number, factor: number): number {
    return start + (end - start) * factor;
  }

  private sendMousePosition(): void {
    const now = Date.now();

    if (now - this.lastMoveSend >= this.MOVE_SEND_RATE && this.socket) {
      const targetX = this.camera.x + this.mouse.x;
      const targetY = this.camera.y + this.mouse.y;

      const moveData: MoveData = {
        x: Math.round(targetX),
        y: Math.round(targetY),
      };

      this.socket.emit("move", moveData);
      this.lastMoveSend = now;
    }
  }

  private updateCamera(): void {
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

  private render(): void {
    if (!this.app || !this.currentPlayer || this.gameOver || !this.gameStarted) return;

    this.drawFood();
    this.drawPlayers();
  }

  private drawFood(): void {
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
        
        this.foodContainer!.addChild(foodSprite);
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
        this.foodContainer!.removeChild(sprite);
        this.foodSprites.delete(foodId);
      }
    }
  }

  private drawPlayers(): void {
    if (!this.playerContainer) return;

    // Update existing player sprites and create new ones
    for (const [playerId, state] of this.playerStates) {
      const player = state.current;
      let playerSprite = this.playerSprites.get(playerId);

      if (!playerSprite) {
        // Create new player sprite
        playerSprite = new PIXI.Graphics();
        this.playerContainer!.addChild(playerSprite);
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
    }

    // Remove players that no longer exist
    const currentPlayerIds = new Set(Array.from(this.playerStates.keys()));
    for (const [playerId, sprite] of this.playerSprites) {
      if (!currentPlayerIds.has(playerId)) {
        this.playerContainer!.removeChild(sprite);
        this.playerSprites.delete(playerId);
      }
    }
  }

  private removePlayerSprite(playerId: string): void {
    const sprite = this.playerSprites.get(playerId);
    if (sprite && this.playerContainer) {
      this.playerContainer.removeChild(sprite);
      this.playerSprites.delete(playerId);
    }
  }

  private hexToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
  }
}

// Initialize game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const game = new GameApp();
  
  // Make game available globally for Alpine.js
  (window as any).gameApp = game;
});