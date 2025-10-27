// server.ts
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { engine } from "express-handlebars";
import path from "path";
import { GameApp } from "./game/gameServer";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.engine(
  "handlebars",
  engine({
    defaultLayout: false,
    extname: ".handlebars",
  }),
);
app.set("view engine", "handlebars");

const viewsPath = path.join(__dirname, "./views");
const publicPath = path.join(__dirname, "./public");

app.set("views", viewsPath);
app.use(express.static(publicPath));

// Routes
app.get("/", (_, res) => {
  res.render("index");
});

new GameApp();

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});