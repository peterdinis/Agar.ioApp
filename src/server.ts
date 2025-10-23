import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { engine } from 'express-handlebars';
import path from 'path';
import { GameServer } from './game/gameServer';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// Handlebars setup
app.engine('handlebars', engine({
  defaultLayout: false,
  extname: '.handlebars'
}));
app.set('view engine', 'handlebars');

// Fix views path for both dev (ts-node) and production (compiled js)
const isProduction = __dirname.includes('dist');
const viewsPath = isProduction
  ? path.join(__dirname, '../views')
  : path.join(__dirname, './views');
const publicPath = isProduction
  ? path.join(__dirname, '../public')
  : path.join(__dirname, './public');

app.set('views', viewsPath);

// Static files
app.use(express.static(publicPath));

// Routes
app.get('/', (req, res) => {
  res.render('index');
});

// Game server
const gameServer = new GameServer(io);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});