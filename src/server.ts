import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { engine } from 'express-handlebars';
import type { DeathData, Food, GameState, HandlebarsContext, InitData, MoveData, Player } from './types/serverTypes';
import { GameServer } from './gameServer';

const app = express();
const httpServer = createServer(app);
export const io = new Server(httpServer, {
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
    json: (context: HandlebarsContext) => JSON.stringify(context)
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
    gameName: 'Agar.io',
    description: 'Multiplayer agar.io game built with Pixi.js and Socket.io'
  });
});

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