import { Server, Socket } from 'socket.io';

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

export class GameServer {
  private io: Server;
  private players: Map<string, Player> = new Map();
  private food: Map<string, Food> = new Map();
  private readonly WORLD_WIDTH = 5000;
  private readonly WORLD_HEIGHT = 5000;
  private readonly FOOD_COUNT = 500;
  private readonly MIN_FOOD_RADIUS = 5;
  private readonly MAX_FOOD_RADIUS = 8;

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

  private getRandomColor(): string {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
      '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      console.log(`Player connected: ${socket.id}`);

      socket.on('join', (name: string) => {
        const player: Player = {
          id: socket.id,
          x: Math.random() * this.WORLD_WIDTH,
          y: Math.random() * this.WORLD_HEIGHT,
          radius: 20,
          mass: 20,
          color: this.getRandomColor(),
          name: name || 'Anonymous',
        };
        this.players.set(socket.id, player);

        socket.emit('init', {
          player,
          worldWidth: this.WORLD_WIDTH,
          worldHeight: this.WORLD_HEIGHT,
        });
      });

      socket.on('move', (data: { x: number; y: number }) => {
        const player = this.players.get(socket.id);
        if (!player) return;

        const dx = data.x - player.x;
        const dy = data.y - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 0) {
          const speed = Math.max(2, 10 - player.mass / 50);
          const moveDistance = Math.min(speed, distance);
          player.x += (dx / distance) * moveDistance;
          player.y += (dy / distance) * moveDistance;

          player.x = Math.max(player.radius, Math.min(this.WORLD_WIDTH - player.radius, player.x));
          player.y = Math.max(player.radius, Math.min(this.WORLD_HEIGHT - player.radius, player.y));
        }
      });

      socket.on('disconnect', () => {
        this.players.delete(socket.id);
        console.log(`Player disconnected: ${socket.id}`);
      });
    });
  }

  private checkCollisions(): void {
    // Check player-food collisions
    for (const [playerId, player] of this.players) {
      for (const [foodId, foodItem] of this.food) {
        const dx = player.x - foodItem.x;
        const dy = player.y - foodItem.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < player.radius) {
          this.food.delete(foodId);
          player.mass += foodItem.radius / 2;
          player.radius = Math.sqrt(player.mass / Math.PI) * 3;
          this.spawnFood();
        }
      }

      // Check player-player collisions
      for (const [otherPlayerId, otherPlayer] of this.players) {
        if (playerId === otherPlayerId) continue;

        const dx = player.x - otherPlayer.x;
        const dy = player.y - otherPlayer.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < Math.abs(player.radius - otherPlayer.radius) * 0.8) {
          if (player.mass > otherPlayer.mass * 1.1) {
            player.mass += otherPlayer.mass;
            player.radius = Math.sqrt(player.mass / Math.PI) * 3;
            
            // Respawn eaten player
            otherPlayer.x = Math.random() * this.WORLD_WIDTH;
            otherPlayer.y = Math.random() * this.WORLD_HEIGHT;
            otherPlayer.mass = 20;
            otherPlayer.radius = 20;
          }
        }
      }
    }
  }

  private startGameLoop(): void {
    setInterval(() => {
      this.checkCollisions();

      const gameState = {
        players: Array.from(this.players.values()),
        food: Array.from(this.food.values()),
      };

      this.io.emit('update', gameState);
    }, 1000 / 30); // 30 FPS
  }
}