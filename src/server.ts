import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { engine } from 'express-handlebars';

const app = express();
const httpServer = createServer(app); // Opravené - použite app namiesto httpServer
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Nastavenie Handlebars
app.engine('handlebars', engine({
    defaultLayout: false,
    extname: 'handlebars'
}));
app.set('view engine', 'handlebars');
app.set('views', path.join(__dirname, './views'));

// Serve static files
app.use(express.static(path.join(__dirname, './public')));

// Serve HTML pomocou Handlebars
app.get('/', (req, res) => {
  res.render('index', {
    title: 'Agar.io Game',
    gameName: 'Agar.io Clone'
  });
});

// Simple game server logic
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

const players = new Map<string, Player>();
const food: Food[] = [];
const worldWidth = 5000;
const worldHeight = 5000;

// Generate initial food
for (let i = 0; i < 1000; i++) {
  food.push({
    id: `food_${i}`,
    x: Math.random() * worldWidth,
    y: Math.random() * worldHeight,
    radius: 5,
    color: `#${Math.floor(Math.random()*16777215).toString(16)}`
  });
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('join', (playerName: string) => {
    console.log(`Player ${playerName} joined with ID: ${socket.id}`);
    
    // Create new player
    const player: Player = {
      id: socket.id,
      x: Math.random() * worldWidth,
      y: Math.random() * worldHeight,
      radius: 20,
      color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
      name: playerName,
      mass: 1
    };

    players.set(socket.id, player);

    // Send initial data to client
    socket.emit('init', {
      player,
      worldWidth,
      worldHeight
    });
  });

  socket.on('move', (data: { x: number; y: number }) => {
    const player = players.get(socket.id);
    if (player) {
      // Simple movement - you can add more complex logic here
      player.x = data.x;
      player.y = data.y;
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    players.delete(socket.id);
  });
});

// Game loop - send updates to all clients
setInterval(() => {
  const gameState = {
    ts: Date.now(),
    players: Array.from(players.values()),
    food: food,
    totalPlayers: players.size
  };

  io.emit('gameUpdate', gameState);
}, 50); // 20 updates per second

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});