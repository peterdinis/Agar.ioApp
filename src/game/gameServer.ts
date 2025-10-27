import { Server, Socket } from 'socket.io';

interface Player {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  name: string;
  mass: number;
  vx: number;
  vy: number;
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
  private players = new Map<string, Player>();
  private food = new Map<string, Food>();
  private WORLD_WIDTH = 5000;
  private WORLD_HEIGHT = 5000;
  private FOOD_COUNT = 1200;
  private MIN_FOOD_RADIUS = 5;
  private MAX_FOOD_RADIUS = 8;
  private BASE_RADIUS = 20;

  private SERVER_TICK_MS = 16;
  private EMIT_MS = 50; // Zvýšené pre stabilnejšie updaty
  private lastEmit = 0;

  constructor(io: Server) {
    this.io = io;
    this.initializeFood();
    this.setupSocketHandlers();
    this.startGameLoop();
  }

  private initializeFood() {
    for (let i = 0; i < this.FOOD_COUNT; i++) this.spawnFood();
  }

  private spawnFood() {
    const f: Food = {
      id: `food_${Date.now()}_${Math.random()}`,
      x: Math.random() * this.WORLD_WIDTH,
      y: Math.random() * this.WORLD_HEIGHT,
      radius: this.MIN_FOOD_RADIUS + Math.random() * (this.MAX_FOOD_RADIUS - this.MIN_FOOD_RADIUS),
      color: this.getRandomColor()
    };
    this.food.set(f.id, f);
  }

  private getRandomColor() {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  private massToRadius(m: number) {
    return Math.sqrt(m) * 2;
  }

  private setupSocketHandlers() {
    this.io.on('connection', (socket: Socket) => {
      socket.on('join', (name: string) => {
        const player: Player = {
          id: socket.id,
          x: Math.random() * this.WORLD_WIDTH,
          y: Math.random() * this.WORLD_HEIGHT,
          radius: this.BASE_RADIUS,
          mass: this.BASE_RADIUS,
          color: this.getRandomColor(),
          name: name || 'Anonymous',
          vx: 0,
          vy: 0
        };
        this.players.set(socket.id, player);
        socket.emit('init', { player, worldWidth: this.WORLD_WIDTH, worldHeight: this.WORLD_HEIGHT });
      });

      socket.on('move', (data: { x: number; y: number }) => {
        const p = this.players.get(socket.id);
        if (!p) return;

        const dx = data.x - p.x;
        const dy = data.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Plynulejšia rýchlosť pohybu
        const speed = Math.max(3, 10 - p.mass / 50);
        
        if (dist > 0) {
          const move = Math.min(speed, dist);
          p.vx = (dx / dist) * move;
          p.vy = (dy / dist) * move;
        } else {
          p.vx = 0;
          p.vy = 0;
        }
      });

      socket.on('disconnect', () => {
        this.players.delete(socket.id);
      });
    });
  }

  private updatePlayers() {
    for (const p of this.players.values()) {
      // Aplikovanie pohybu
      p.x += p.vx;
      p.y += p.vy;
      
      // Obmedzenie pohybu v rámci sveta
      p.x = Math.max(p.radius, Math.min(this.WORLD_WIDTH - p.radius, p.x));
      p.y = Math.max(p.radius, Math.min(this.WORLD_HEIGHT - p.radius, p.y));
    }
  }

  private checkCollisions() {
    for (const p of this.players.values()) {
      for (const [fid, f] of this.food) {
        const dx = p.x - f.x;
        const dy = p.y - f.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < p.radius) {
          p.mass += f.radius * 0.5;
          p.radius = this.massToRadius(p.mass);
          this.food.delete(fid);
          this.spawnFood();
        }
      }
      
      for (const other of this.players.values()) {
        if (p.id === other.id) continue;
        const dx = p.x - other.x;
        const dy = p.y - other.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < p.radius + other.radius) {
          if (p.mass > other.mass * 1.15) {
            p.mass += other.mass * 0.8;
            p.radius = this.massToRadius(p.mass);
            this.io.to(other.id).emit('playerDeath', { playerId: other.id, eatenBy: p.name });
            this.players.delete(other.id);
          }
        }
      }
    }
  }

  private broadcastGameState() {
    const snapshot = {
      ts: Date.now(),
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        x: p.x,
        y: p.y,
        radius: p.radius,
        mass: p.mass,
        name: p.name,
        color: p.color,
        vx: p.vx,
        vy: p.vy
      })),
      food: Array.from(this.food.values()),
      totalPlayers: this.players.size
    };
    this.io.emit('gameUpdate', snapshot);
  }

  private startGameLoop() {
    const loop = () => {
      this.updatePlayers();
      this.checkCollisions();
      
      const now = Date.now();
      if (now - this.lastEmit > this.EMIT_MS) {
        this.broadcastGameState();
        this.lastEmit = now;
      }
      setTimeout(loop, this.SERVER_TICK_MS);
    };
    loop();
  }
}