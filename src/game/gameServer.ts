import { Server, Socket } from 'socket.io';

interface Player {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  name: string;
  mass: number;
  isBot: boolean;
  targetX?: number;
  targetY?: number;
  lastTargetChange?: number;
  behavior: 'hunter' | 'prey' | 'neutral';
  aggression: number;
  lastUpdate?: number;
  updateFrame?: number;
}

interface Food {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
}

interface GridCell {
  players: Set<string>;
  food: Set<string>;
}

export class GameServer {
  private io: Server;
  private players: Map<string, Player> = new Map();
  private food: Map<string, Food> = new Map();
  private readonly WORLD_WIDTH = 5000;
  private readonly WORLD_HEIGHT = 5000;
  private readonly FOOD_COUNT = 1200;
  private readonly MIN_FOOD_RADIUS = 5;
  private readonly MAX_FOOD_RADIUS = 8;
  private readonly BOT_COUNT = 100;
  private readonly BASE_RADIUS = 20;
  private readonly GRID_SIZE = 300;
  private readonly GRID_COLS: number;
  private readonly GRID_ROWS: number;
  private spatialGrid: GridCell[][];
  
  private botNames = [
    'BotMaster', 'ProBot', 'CellDestroyer', 'MegaEater', 'SpeedDemon',
    'TinyTerror', 'GiantSlayer', 'QuickSilver', 'CellHunter', 'BlobKing',
    'NanoBot', 'CircleChamp', 'PelletPro', 'MassMonster', 'AgileBot',
    'PowerCell', 'SwiftSphere', 'DotMaster', 'OrbWarrior', 'CellSensei'
  ];

  private frameCount = 0;
  private lastStatsLog = Date.now();

  constructor(io: Server) {
    this.io = io;
    this.GRID_COLS = Math.ceil(this.WORLD_WIDTH / this.GRID_SIZE);
    this.GRID_ROWS = Math.ceil(this.WORLD_HEIGHT / this.GRID_SIZE);
    this.spatialGrid = this.createGrid();
    
    this.initializeFood();
    this.spawnBots();
    this.setupSocketHandlers();
    this.startGameLoop();
  }

  private createGrid(): GridCell[][] {
    const grid = [] as any;
    for (let x = 0; x < this.GRID_COLS; x++) {
      grid[x] = [];
      for (let y = 0; y < this.GRID_ROWS; y++) {
        grid[x][y] = { players: new Set(), food: new Set() };
      }
    }
    return grid;
  }

  private getGridCell(x: number, y: number): { col: number; row: number } {
    return {
      col: Math.floor(x / this.GRID_SIZE),
      row: Math.floor(y / this.GRID_SIZE)
    };
  }

  private updateSpatialGrid(): void {
    // Reset grid
    for (let x = 0; x < this.GRID_COLS; x++) {
      for (let y = 0; y < this.GRID_ROWS; y++) {
        this.spatialGrid[x][y].players.clear();
        this.spatialGrid[x][y].food.clear();
      }
    }

    // Update players
    for (const [id, player] of this.players) {
      const cell = this.getGridCell(player.x, player.y);
      if (cell.col >= 0 && cell.col < this.GRID_COLS && cell.row >= 0 && cell.row < this.GRID_ROWS) {
        this.spatialGrid[cell.col][cell.row].players.add(id);
      }
    }

    // Update food
    for (const [id, foodItem] of this.food) {
      const cell = this.getGridCell(foodItem.x, foodItem.y);
      if (cell.col >= 0 && cell.col < this.GRID_COLS && cell.row >= 0 && cell.row < this.GRID_ROWS) {
        this.spatialGrid[cell.col][cell.row].food.add(id);
      }
    }
  }

  private getNearbyPlayers(player: Player, range: number): Player[] {
    const centerCell = this.getGridCell(player.x, player.y);
    const nearby: Player[] = [];
    const searchRadius = Math.ceil(range / this.GRID_SIZE);

    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        const col = centerCell.col + dx;
        const row = centerCell.row + dy;
        
        if (col >= 0 && col < this.GRID_COLS && row >= 0 && row < this.GRID_ROWS) {
          for (const playerId of this.spatialGrid[col][row].players) {
            if (playerId === player.id) continue;
            const otherPlayer = this.players.get(playerId);
            if (otherPlayer && this.distance(player.x, player.y, otherPlayer.x, otherPlayer.y) <= range) {
              nearby.push(otherPlayer);
            }
          }
        }
      }
    }
    return nearby;
  }

  private getNearbyFood(player: Player, range: number): Food[] {
    const centerCell = this.getGridCell(player.x, player.y);
    const nearby: Food[] = [];
    const searchRadius = Math.ceil(range / this.GRID_SIZE);

    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        const col = centerCell.col + dx;
        const row = centerCell.row + dy;
        
        if (col >= 0 && col < this.GRID_COLS && row >= 0 && row < this.GRID_ROWS) {
          for (const foodId of this.spatialGrid[col][row].food) {
            const foodItem = this.food.get(foodId);
            if (foodItem && this.distance(player.x, player.y, foodItem.x, foodItem.y) <= range) {
              nearby.push(foodItem);
            }
          }
        }
      }
    }
    return nearby;
  }

  private initializeFood(): void {
    for (let i = 0; i < this.FOOD_COUNT; i++) {
      this.spawnFood();
    }
  }

  private spawnFood(): void {
    const food: Food = {
      id: `food_${Date.now()}_${Math.random()}`,
      x: Math.random() * this.WORLD_WIDTH,
      y: Math.random() * this.WORLD_HEIGHT,
      radius: this.MIN_FOOD_RADIUS + Math.random() * (this.MAX_FOOD_RADIUS - this.MIN_FOOD_RADIUS),
      color: this.getRandomColor(),
    };
    this.food.set(food.id, food);
  }

  private spawnBots(): void {
    for (let i = 0; i < this.BOT_COUNT; i++) {
      const botId = `bot_${i}`;
      const aggression = Math.random();
      const bot: Player = {
        id: botId,
        x: Math.random() * this.WORLD_WIDTH,
        y: Math.random() * this.WORLD_HEIGHT,
        radius: this.BASE_RADIUS,
        mass: this.BASE_RADIUS,
        color: this.getRandomColor(),
        name: `${this.botNames[i % this.botNames.length]}_${i + 1}`,
        isBot: true,
        targetX: Math.random() * this.WORLD_WIDTH,
        targetY: Math.random() * this.WORLD_HEIGHT,
        lastTargetChange: Date.now(),
        lastUpdate: Date.now(),
        updateFrame: 0,
        behavior: aggression > 0.7 ? 'hunter' : aggression > 0.3 ? 'neutral' : 'prey',
        aggression: aggression,
      };
      this.players.set(botId, bot);
    }
  }

  private updateBots(): void {
    const currentTime = Date.now();
    this.frameCount++;
    
    for (const [id, bot] of this.players) {
      if (!bot.isBot) continue;

      // ROZLOŽENÉ AKTUALIZÁCIE BOTOV - každý bot sa aktualizuje každých 3-5 snímok
      const updateFrequency = 3 + (bot.id.charCodeAt(0) % 3); // 3-5 frames
      if (this.frameCount % updateFrequency !== (bot.id.charCodeAt(0) % updateFrequency)) {
        continue;
      }

      // Zmena správania podľa veľkosti
      this.updateBotBehavior(bot);

      // Nájdi cieľ
      let target = this.findBestTarget(bot);
      
      if (target) {
        bot.targetX = target.x;
        bot.targetY = target.y;
        bot.lastTargetChange = currentTime;
      } else if (
        !bot.targetX || 
        !bot.targetY || 
        currentTime - (bot.lastTargetChange || 0) > 8000 ||
        this.distance(bot.x, bot.y, bot.targetX!, bot.targetY!) < 50
      ) {
        // Náhodný cieľ ak žiadny dobrý cieľ neexistuje
        bot.targetX = Math.random() * this.WORLD_WIDTH;
        bot.targetY = Math.random() * this.WORLD_HEIGHT;
        bot.lastTargetChange = currentTime;
      }

      // Pohyb k cieľu
      this.moveBotTowardsTarget(bot);
    }
  }

  private updateBotBehavior(bot: Player): void {
    if (bot.mass > 100) {
      bot.behavior = 'hunter';
      bot.aggression = Math.min(1, bot.aggression + 0.05);
    } else if (bot.mass < 30) {
      bot.behavior = 'prey';
    }
  }

  private findBestTarget(bot: Player): { x: number; y: number; priority: number } | null {
    let bestTarget: { x: number; y: number; priority: number } | null = null;
    let currentPriority = 0;

    const visionRange = bot.behavior === 'hunter' ? 600 : 400;

    // Hľadaj hráčov
    const nearbyPlayers = this.getNearbyPlayers(bot, visionRange);
    for (const player of nearbyPlayers) {
      const dist = this.distance(bot.x, bot.y, player.x, player.y);
      const massRatio = player.mass / bot.mass;

      let priority = 0;
      
      if (massRatio < 0.8) {
        priority = 100 - (dist / 6) + (0.8 - massRatio) * 50;
        if (bot.behavior === 'hunter') priority += 50;
        if (player.isBot) priority -= 30;
      } else if (massRatio > 1.2) {
        priority = 5; // Veľmi nízka priorita pre útek
      }

      if (priority > currentPriority && priority > 40) {
        bestTarget = { x: player.x, y: player.y, priority };
        currentPriority = priority;
      }
    }

    // Hľadaj jedlo
    if (!bestTarget || currentPriority < 70) {
      const foodVisionRange = 300;
      const nearbyFood = this.getNearbyFood(bot, foodVisionRange);
      
      for (const food of nearbyFood) {
        const dist = this.distance(bot.x, bot.y, food.x, food.y);
        const priority = 60 - (dist / 8) + food.radius;
        
        if (priority > currentPriority) {
          bestTarget = { x: food.x, y: food.y, priority };
          currentPriority = priority;
        }
      }
    }

    return bestTarget;
  }

  private moveBotTowardsTarget(bot: Player): void {
    if (!bot.targetX || !bot.targetY) return;

    const dx = bot.targetX - bot.x;
    const dy = bot.targetY - bot.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 10) {
      const baseSpeed = Math.max(1.2, 5 - bot.mass / 60);
      const moveX = (dx / distance) * baseSpeed;
      const moveY = (dy / distance) * baseSpeed;

      bot.x += moveX;
      bot.y += moveY;

      // Hranice sveta
      bot.x = Math.max(bot.radius, Math.min(this.WORLD_WIDTH - bot.radius, bot.x));
      bot.y = Math.max(bot.radius, Math.min(this.WORLD_HEIGHT - bot.radius, bot.y));
    }
  }

  private distance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private getRandomColor(): string {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
      '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  private massToRadius(mass: number): number {
    return Math.sqrt(mass) * 2;
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      console.log(`Player connected: ${socket.id}`);

      socket.on('join', (name: string) => {
        if (this.players.has(socket.id)) {
          this.players.delete(socket.id);
        }

        const player: Player = {
          id: socket.id,
          x: Math.random() * this.WORLD_WIDTH,
          y: Math.random() * this.WORLD_HEIGHT,
          radius: this.BASE_RADIUS,
          mass: this.BASE_RADIUS,
          color: this.getRandomColor(),
          name: name || 'Anonymous',
          isBot: false,
          behavior: 'neutral',
          aggression: 0.5,
        };
        this.players.set(socket.id, player);

        socket.emit('init', {
          player,
          worldWidth: this.WORLD_WIDTH,
          worldHeight: this.WORLD_HEIGHT,
        });

        console.log(`Player ${name} joined. Total players: ${this.players.size}`);
      });

      socket.on('move', (data: { x: number; y: number }) => {
        const player = this.players.get(socket.id);
        if (!player || player.isBot) return;

        const dx = data.x - player.x;
        const dy = data.y - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 0) {
          const speed = Math.max(4, 12 - player.mass / 40);
          const moveDistance = Math.min(speed, distance);
          player.x += (dx / distance) * moveDistance;
          player.y += (dy / distance) * moveDistance;

          player.x = Math.max(player.radius, Math.min(this.WORLD_WIDTH - player.radius, player.x));
          player.y = Math.max(player.radius, Math.min(this.WORLD_HEIGHT - player.radius, player.y));
        }
      });

      socket.on('disconnect', () => {
        const player = this.players.get(socket.id);
        if (player && !player.isBot) {
          this.players.delete(socket.id);
          console.log(`Player disconnected: ${socket.id}. Total players: ${this.players.size}`);
        }
      });
    });
  }

  private checkCollisions(): void {
    const playersArray = Array.from(this.players.values());
    
    for (let i = 0; i < playersArray.length; i++) {
      const player = playersArray[i];
      
      // Player-food kolízie
      const nearbyFood = this.getNearbyFood(player, player.radius + 10);
      for (const foodItem of nearbyFood) {
        const dx = player.x - foodItem.x;
        const dy = player.y - foodItem.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < player.radius) {
          this.food.delete(foodItem.id);
          player.mass += foodItem.radius * 0.5;
          player.radius = this.massToRadius(player.mass);
          this.spawnFood();
        }
      }

      // Player-player kolízie
      const nearbyPlayers = this.getNearbyPlayers(player, player.radius + 100);
      for (const otherPlayer of nearbyPlayers) {
        if (player.id === otherPlayer.id) continue;
        
        const dx = player.x - otherPlayer.x;
        const dy = player.y - otherPlayer.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < player.radius + otherPlayer.radius) {
          const canPlayerEatOther = player.mass > otherPlayer.mass * 1.15;
          const canOtherEatPlayer = otherPlayer.mass > player.mass * 1.15;

          if (canPlayerEatOther) {
            player.mass += otherPlayer.mass * 0.8;
            player.radius = this.massToRadius(player.mass);
            
            if (!otherPlayer.isBot) {
              this.io.to(otherPlayer.id).emit('playerDeath', {
                playerId: otherPlayer.id,
                eatenBy: player.name,
                finalMass: otherPlayer.mass
              });
            }

            // Respawn
            otherPlayer.x = Math.random() * this.WORLD_WIDTH;
            otherPlayer.y = Math.random() * this.WORLD_HEIGHT;
            otherPlayer.mass = this.BASE_RADIUS;
            otherPlayer.radius = this.BASE_RADIUS;

          } else if (canOtherEatPlayer) {
            otherPlayer.mass += player.mass * 0.8;
            otherPlayer.radius = this.massToRadius(otherPlayer.mass);
            
            if (!player.isBot) {
              this.io.to(player.id).emit('playerDeath', {
                playerId: player.id,
                eatenBy: otherPlayer.name,
                finalMass: player.mass
              });
            }

            // Respawn
            player.x = Math.random() * this.WORLD_WIDTH;
            player.y = Math.random() * this.WORLD_HEIGHT;
            player.mass = this.BASE_RADIUS;
            player.radius = this.BASE_RADIUS;
          }
        }
      }
    }
  }

  private startGameLoop(): void {
    const targetFPS = 60;
    const targetFrameTime = 1000 / targetFPS;
    let lastTime = Date.now();

    const gameLoop = () => {
      const currentTime = Date.now();
      const deltaTime = currentTime - lastTime;
      lastTime = currentTime;

      // Aktualizuj spatial grid každý frame
      this.updateSpatialGrid();

      // Aktualizácia botov - rozložená na rôzne framy
      this.updateBots();
      
      // Kolízie len každý druhý frame
      if (this.frameCount % 2 === 0) {
        this.checkCollisions();
      }

      // Log stats každých 10 sekúnd
      if (currentTime - this.lastStatsLog > 10000) {
        console.log(`Game stats - Players: ${this.players.size}, Food: ${this.food.size}, FPS: ${Math.round(1000/deltaTime)}`);
        this.lastStatsLog = currentTime;
      }

      // Optimalizované odosielanie dát
      const gameState = {
        players: Array.from(this.players.values()).map(p => ({
          id: p.id,
          x: Math.round(p.x),
          y: Math.round(p.y),
          radius: Math.round(p.radius),
          mass: Math.round(p.mass),
          color: p.color,
          name: p.name,
          isBot: p.isBot,
        })),
        food: Array.from(this.food.values()).map(f => ({
          id: f.id,
          x: Math.round(f.x),
          y: Math.round(f.y),
          radius: Math.round(f.radius),
          color: f.color,
        })),
      };

      this.io.volatile.emit('gameUpdate', gameState);

      const processingTime = Date.now() - currentTime;
      const waitTime = Math.max(0, targetFrameTime - processingTime);
      
      setTimeout(gameLoop, waitTime);
    };

    gameLoop();
  }
}