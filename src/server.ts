import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { engine } from 'express-handlebars';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Handlebars setup
app.engine('handlebars', engine({
  defaultLayout: false,
  extname: 'handlebars',
  helpers: {
    json: function(context: any) {
      return JSON.stringify(context);
    }
  }
}));
app.set('view engine', 'handlebars');
app.set('views', path.join(__dirname, './views'));

// Serve static files
app.use(express.static(path.join(__dirname, './public')));

// Serve HTML with Handlebars
app.get('/', (req, res) => {
  res.render('index', {
    title: 'Agar.io Clone',
    gameName: 'Agar.io with Pixi.js',
    description: 'Multiplayer agar.io game built with Pixi.js and Socket.io'
  });
});

// Interfaces
interface Player {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  name: string;
  mass: number;
  speed: number;
}

interface Food {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  mass: number;
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

interface MoveData {
  x: number;
  y: number;
}

interface DeathData {
  playerId: string;
  eatenBy: string;
  finalMass: number;
}

// Game Server Class
class GameServer {
  private players: Map<string, Player>;
  private food: Food[];
  private readonly worldWidth: number;
  private readonly worldHeight: number;
  private readonly foodCount: number;

  constructor() {
    this.players = new Map();
    this.food = [];
    this.worldWidth = 5000;
    this.worldHeight = 5000;
    this.foodCount = 1000;
    
    this.initFood();
  }

  private initFood(): void {
    this.food = [];
    for (let i = 0; i < this.foodCount; i++) {
      this.food.push(this.createFood());
    }
  }

  private getRandomColor(): string {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
      '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
      '#F8C471', '#82E0AA', '#F1948A', '#85C1E9', '#D7BDE2'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  public addPlayer(socketId: string, playerName: string): Player {
    const player: Player = {
      id: socketId,
      x: Math.random() * this.worldWidth,
      y: Math.random() * this.worldHeight,
      radius: 20,
      color: this.getRandomColor(),
      name: playerName,
      mass: 100,
      speed: 5
    };

    this.players.set(socketId, player);
    return player;
  }

  public removePlayer(socketId: string): void {
    this.players.delete(socketId);
  }

  public movePlayer(socketId: string, targetX: number, targetY: number): void {
    const player = this.players.get(socketId);
    if (!player) return;

    // Calculate direction vector
    const dx = targetX - player.x;
    const dy = targetY - player.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 0) {
      // Normalize direction
      const dirX = dx / distance;
      const dirY = dy / distance;

      // Calculate speed based on mass (bigger = slower)
      const speed = Math.max(2, player.speed * (100 / player.mass));
      
      // Move player with smoothing
      player.x += dirX * speed;
      player.y += dirY * speed;

      // Keep player within world bounds
      player.x = Math.max(player.radius, Math.min(this.worldWidth - player.radius, player.x));
      player.y = Math.max(player.radius, Math.min(this.worldHeight - player.radius, player.y));
    }
  }

  public checkCollisions(): void {
    // Check player-food collisions
    for (const player of this.players.values()) {
      for (let i = this.food.length - 1; i >= 0; i--) {
        const food = this.food[i];
        const dx = player.x - food.x;
        const dy = player.y - food.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < player.radius + food.radius) {
          // Player eats food
          player.mass += food.mass;
          player.radius = this.massToRadius(player.mass);
          
          // Remove food and add new one
          this.food.splice(i, 1);
          this.food.push(this.createFood());
        }
      }
    }

    // Check player-player collisions
    const playersArray = Array.from(this.players.values());
    for (let i = 0; i < playersArray.length; i++) {
      for (let j = i + 1; j < playersArray.length; j++) {
        const player1 = playersArray[i];
        const player2 = playersArray[j];

        const dx = player1.x - player2.x;
        const dy = player1.y - player2.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < player1.radius + player2.radius) {
          // Collision detected
          if (player1.mass > player2.mass * 1.1) {
            // Player1 eats Player2
            player1.mass += player2.mass;
            player1.radius = this.massToRadius(player1.mass);
            this.handlePlayerDeath(player2.id, player1.name);
          } else if (player2.mass > player1.mass * 1.1) {
            // Player2 eats Player1
            player2.mass += player1.mass;
            player2.radius = this.massToRadius(player2.mass);
            this.handlePlayerDeath(player1.id, player2.name);
          }
        }
      }
    }
  }

  private createFood(): Food {
    return {
      id: `food_${Date.now()}_${Math.random()}`,
      x: Math.random() * this.worldWidth,
      y: Math.random() * this.worldHeight,
      radius: 5,
      color: this.getRandomColor(),
      mass: 1
    };
  }

  private massToRadius(mass: number): number {
    return Math.sqrt(mass) * 2;
  }

  private handlePlayerDeath(playerId: string, eatenBy: string): void {
    const player = this.players.get(playerId);
    if (player) {
      const deathData: DeathData = {
        playerId,
        eatenBy,
        finalMass: player.mass
      };
      io.to(playerId).emit('playerDeath', deathData);
      this.players.delete(playerId);
    }
  }

  public getGameState(): GameState {
    return {
      ts: Date.now(),
      players: Array.from(this.players.values()),
      food: this.food,
      totalPlayers: this.players.size
    };
  }

  public getWorldDimensions(): { width: number; height: number } {
    return {
      width: this.worldWidth,
      height: this.worldHeight
    };
  }
}

const gameServer = new GameServer();

// Socket.IO handlers
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('join', (playerName: string) => {
    console.log(`Player ${playerName} joined with ID: ${socket.id}`);
    
    const player = gameServer.addPlayer(socket.id, playerName);
    const worldDimensions = gameServer.getWorldDimensions();

    const initData: InitData = {
      player,
      worldWidth: worldDimensions.width,
      worldHeight: worldDimensions.height
    };

    socket.emit('init', initData);
  });

  socket.on('move', (data: MoveData) => {
    gameServer.movePlayer(socket.id, data.x, data.y);
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    gameServer.removePlayer(socket.id);
  });
});

// Game loop - 20 updates per second
setInterval(() => {
  gameServer.checkCollisions();
  const gameState = gameServer.getGameState();
  io.emit('gameUpdate', gameState);
}, 50);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});