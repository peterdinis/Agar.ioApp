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
}

interface Food {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
}

export class GameServer {
  private io: Server;
  private players: Map<string, Player> = new Map();
  private food: Map<string, Food> = new Map();
  private readonly WORLD_WIDTH = 5000;
  private readonly WORLD_HEIGHT = 5000;
  private readonly FOOD_COUNT = 800;
  private readonly MIN_FOOD_RADIUS = 5;
  private readonly MAX_FOOD_RADIUS = 8;
  private readonly BOT_COUNT = 15;
  private readonly BASE_RADIUS = 20;
  private lastUpdateTime = Date.now();
  private botNames = [
    'BotMaster', 'ProBot', 'CellDestroyer', 'MegaEater', 'SpeedDemon',
    'TinyTerror', 'GiantSlayer', 'QuickSilver', 'CellHunter', 'BlobKing',
    'NanoBot', 'CircleChamp', 'PelletPro', 'MassMonster', 'AgileBot',
    'PowerCell', 'SwiftSphere', 'DotMaster', 'OrbWarrior', 'CellSensei'
  ];

  constructor(io: Server) {
    this.io = io;
    this.initializeFood();
    this.spawnBots();
    this.setupSocketHandlers();
    this.startGameLoop();
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
      const botId = `bot_${i}_${Date.now()}`;
      const bot: Player = {
        id: botId,
        x: Math.random() * this.WORLD_WIDTH,
        y: Math.random() * this.WORLD_HEIGHT,
        radius: this.BASE_RADIUS,
        mass: this.BASE_RADIUS,
        color: this.getRandomColor(),
        name: this.botNames[i % this.botNames.length],
        isBot: true,
        targetX: Math.random() * this.WORLD_WIDTH,
        targetY: Math.random() * this.WORLD_HEIGHT,
      };
      this.players.set(botId, bot);
    }
  }

  private updateBots(deltaTime: number): void {
    for (const [id, bot] of this.players) {
      if (!bot.isBot) continue;

      // Nájdi najbližšie jedlo alebo menšieho hráča
      let nearestTarget = this.findNearestTarget(bot);

      if (nearestTarget) {
        bot.targetX = nearestTarget.x;
        bot.targetY = nearestTarget.y;
      } else if (
        !bot.targetX || 
        !bot.targetY || 
        Math.random() < 0.01 ||
        Math.abs(bot.x - bot.targetX) < 50 && Math.abs(bot.y - bot.targetY) < 50
      ) {
        // Náhodný cieľ
        bot.targetX = Math.random() * this.WORLD_WIDTH;
        bot.targetY = Math.random() * this.WORLD_HEIGHT;
      }

      // Pohyb k cieľu
      const dx = bot.targetX - bot.x;
      const dy = bot.targetY - bot.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > 10) {
        const speed = Math.max(3, 12 - bot.mass / 40) * (deltaTime / 16.67);
        const moveX = (dx / distance) * speed;
        const moveY = (dy / distance) * speed;

        bot.x += moveX;
        bot.y += moveY;

        // Границe sveta
        bot.x = Math.max(bot.radius, Math.min(this.WORLD_WIDTH - bot.radius, bot.x));
        bot.y = Math.max(bot.radius, Math.min(this.WORLD_HEIGHT - bot.radius, bot.y));
      }

      // Útek pred väčšími hráčmi
      for (const [otherId, otherPlayer] of this.players) {
        if (otherId === id) continue;
        if (otherPlayer.mass > bot.mass * 1.2) {
          const distX = bot.x - otherPlayer.x;
          const distY = bot.y - otherPlayer.y;
          const dist = Math.sqrt(distX * distX + distY * distY);
          
          if (dist < 200) {
            bot.targetX = bot.x + (distX / dist) * 300;
            bot.targetY = bot.y + (distY / dist) * 300;
            break;
          }
        }
      }
    }
  }

  private findNearestTarget(bot: Player): { x: number; y: number } | null {
    let nearest: { x: number; y: number; distance: number } | null = null;

    // Hľadaj jedlo
    for (const [_, food] of this.food) {
      const dx = food.x - bot.x;
      const dy = food.y - bot.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 300 && (!nearest || distance < nearest.distance)) {
        nearest = { x: food.x, y: food.y, distance };
      }
    }

    // Hľadaj menších hráčov
    for (const [otherId, player] of this.players) {
      if (otherId === bot.id) continue;
      if (player.mass < bot.mass * 0.8) {
        const dx = player.x - bot.x;
        const dy = player.y - bot.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 400 && (!nearest || distance < nearest.distance)) {
          nearest = { x: player.x, y: player.y, distance };
        }
      }
    }

    return nearest;
  }

  private getRandomColor(): string {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
      '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788',
      '#E74C3C', '#3498DB', '#2ECC71', '#F39C12', '#9B59B6',
      '#1ABC9C', '#E67E22', '#95A5A6', '#34495E', '#16A085'
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
        const player: Player = {
          id: socket.id,
          x: Math.random() * this.WORLD_WIDTH,
          y: Math.random() * this.WORLD_HEIGHT,
          radius: this.BASE_RADIUS,
          mass: this.BASE_RADIUS,
          color: this.getRandomColor(),
          name: name || 'Anonymous',
          isBot: false,
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
          const speed = Math.max(3, 12 - player.mass / 40);
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
  // Player-food collisions
  for (const [playerId, player] of this.players) {
    for (const [foodId, foodItem] of this.food) {
      const dx = player.x - foodItem.x;
      const dy = player.y - foodItem.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < player.radius) {
        this.food.delete(foodId);
        player.mass += foodItem.radius * 0.5;
        player.radius = this.massToRadius(player.mass);
        this.spawnFood();
      }
    }

    // Player-player collisions
    for (const [otherPlayerId, otherPlayer] of this.players) {
      if (playerId === otherPlayerId) continue;

      const dx = player.x - otherPlayer.x;
      const dy = player.y - otherPlayer.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const radiusDiff = Math.abs(player.radius - otherPlayer.radius);

      if (distance < radiusDiff * 0.7) {
        if (player.mass > otherPlayer.mass * 1.15) {
          // Player eats other player
          player.mass += otherPlayer.mass * 0.8;
          player.radius = this.massToRadius(player.mass);
          
          // Notify about death
          if (!otherPlayer.isBot) {
            this.io.to(otherPlayerId).emit('playerDeath', {
              playerId: otherPlayerId,
              eatenBy: player.name,
              finalMass: otherPlayer.mass
            });
          }

          // Respawn
          otherPlayer.x = Math.random() * this.WORLD_WIDTH;
          otherPlayer.y = Math.random() * this.WORLD_HEIGHT;
          otherPlayer.mass = this.BASE_RADIUS;
          otherPlayer.radius = this.BASE_RADIUS;
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

      this.updateBots(deltaTime);
      this.checkCollisions();

      // Optimalizované odosielanie len zmien
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
          radius: f.radius,
          color: f.color,
        })),
      };

      this.io.volatile.emit('update', gameState);

      const processingTime = Date.now() - currentTime;
      const waitTime = Math.max(0, targetFrameTime - processingTime);
      
      setTimeout(gameLoop, waitTime);
    };

    gameLoop();
  }
}