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
  lastMoveTime?: number;
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
  private readonly BASE_RADIUS = 20;
  private readonly BASE_MASS = 400;
  private lastUpdateTime = Date.now();

  private readonly PLAYER_SPEED = 15;

  constructor(io: Server) {
    this.io = io;
    this.initializeFood();
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

  private movePlayerTowardsTarget(player: Player, targetX: number, targetY: number): void {
    const dx = targetX - player.x;
    const dy = targetY - player.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 5) {
      const speed = this.PLAYER_SPEED;
      
      const moveX = (dx / distance) * speed;
      const moveY = (dy / distance) * speed;

      player.x += moveX;
      player.y += moveY;

      // Hranice sveta
      player.x = Math.max(player.radius, Math.min(this.WORLD_WIDTH - player.radius, player.x));
      player.y = Math.max(player.radius, Math.min(this.WORLD_HEIGHT - player.radius, player.y));
      
      player.lastMoveTime = Date.now();
    }
  }

  private distance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
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
    return Math.sqrt(mass) * 1.5;
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
          mass: this.BASE_MASS,
          color: this.getRandomColor(),
          name: name || 'Anonymous',
          isBot: false,
          behavior: 'neutral',
          aggression: 0.5,
          lastMoveTime: Date.now(),
        };
        this.players.set(socket.id, player);

        socket.emit('init', {
          player,
          worldWidth: this.WORLD_WIDTH,
          worldHeight: this.WORLD_HEIGHT,
        });

        console.log(`Player ${name} joined with mass: ${this.BASE_MASS} and radius: ${this.BASE_RADIUS}. Total players: ${this.players.size}`);
      });

      socket.on('move', (data: { x: number; y: number }) => {
        const player = this.players.get(socket.id);
        if (!player || player.isBot) return;

        this.movePlayerTowardsTarget(player, data.x, data.y);
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
    const playersArray = Array.from(this.players.entries());
    
    for (let i = 0; i < playersArray.length; i++) {
      const [playerId, player] = playersArray[i];
      
      // Player-food kolízie
      for (const [foodId, foodItem] of this.food) {
        const dx = player.x - foodItem.x;
        const dy = player.y - foodItem.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < player.radius) {
          this.food.delete(foodId);
          player.mass += foodItem.radius * 2;
          player.radius = this.massToRadius(player.mass);
          this.spawnFood();
        }
      }

      // Player-player kolízie (ak by boli viacerí hráči)
      for (let j = i + 1; j < playersArray.length; j++) {
        const [otherPlayerId, otherPlayer] = playersArray[j];
        
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
              this.io.to(otherPlayerId).emit('playerDeath', {
                playerId: otherPlayerId,
                eatenBy: player.name,
                finalMass: otherPlayer.mass
              });
            }

            // Respawn
            otherPlayer.x = Math.random() * this.WORLD_WIDTH;
            otherPlayer.y = Math.random() * this.WORLD_HEIGHT;
            otherPlayer.mass = this.BASE_MASS;
            otherPlayer.radius = this.BASE_RADIUS;

          } else if (canOtherEatPlayer) {
            otherPlayer.mass += player.mass * 0.8;
            otherPlayer.radius = this.massToRadius(otherPlayer.mass);
            
            if (!player.isBot) {
              this.io.to(playerId).emit('playerDeath', {
                playerId: playerId,
                eatenBy: otherPlayer.name,
                finalMass: player.mass
              });
            }

            // Respawn
            player.x = Math.random() * this.WORLD_WIDTH;
            player.y = Math.random() * this.WORLD_HEIGHT;
            player.mass = this.BASE_MASS;
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

      this.checkCollisions();

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

      this.io.volatile.emit('gameUpdate', gameState);

      const processingTime = Date.now() - currentTime;
      const waitTime = Math.max(0, targetFrameTime - processingTime);
      
      setTimeout(gameLoop, waitTime);
    };

    gameLoop();
  }
}