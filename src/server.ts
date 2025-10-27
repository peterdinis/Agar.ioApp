import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { engine } from "express-handlebars";
import path from "path";
import { GameServer } from "./game/gameServer";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

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

new GameServer(io);

const PORT = 3000;

httpServer.listen(PORT, () => {
	console.log(`Server running on http://localhost:${PORT}`);
});
