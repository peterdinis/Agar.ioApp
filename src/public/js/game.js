function gameApp() {
	return {
		socket: null,
		gameStarted: false,
		gameOver: false,
		playerName: "",
		currentPlayer: null,
		players: [],
		food: [],
		playerCount: 0,
		leaderboard: [],
		canvas: null,
		ctx: null,
		camera: { x: 0, y: 0 },
		mouse: { x: 0, y: 0 },
		worldWidth: 5000,
		worldHeight: 5000,
		lastRender: 0,

		// Nový systém interpolácie
		playerStates: new Map(), // Ukladá stavy všetkých hráčov pre interpoláciu
		serverUpdateTime: 0,
		lastServerTimestamp: 0,

		finalMass: 0,
		finalPosition: 0,
		eatenBy: "",

		// Nastavenia
		SERVER_UPDATE_RATE: 50, // 20 updatov za sekundu
		MOVE_SEND_RATE: 16, // ~60 fps pre pohyb
		CAMERA_SMOOTHING: 0.08, // Znížené pre plynulejšiu kameru

		// Opravené - pridaná premenná pre sledovanie času odosielania
		lastMoveSend: 0,

		init() {
			this.socket = io({ transports: ["websocket"], upgrade: false });
			this.setupSocketListeners();
		},

		setupSocketListeners() {
			this.socket.on("init", (data) => {
				this.currentPlayer = data.player;
				this.worldWidth = data.worldWidth;
				this.worldHeight = data.worldHeight;

				// Inicializácia interpolácie pre vlastného hráča
				this.initPlayerInterpolation(this.currentPlayer.id, this.currentPlayer);

				this.initCanvas();
				this.startGameLoop();
			});

			this.socket.on("gameUpdate", (gameState) => {
				if (this.gameOver || !this.gameStarted) return;

				this.serverUpdateTime = Date.now();
				this.lastServerTimestamp = gameState.ts;
				this.processServerUpdate(gameState);
			});

			this.socket.on("playerDeath", (data) => {
				if (data.playerId === this.currentPlayer?.id)
					this.handlePlayerDeath(data);
			});
		},

		// Nový systém interpolácie
		initPlayerInterpolation(playerId, initialData) {
			this.playerStates.set(playerId, {
				current: { ...initialData },
				target: { ...initialData },
				lastUpdate: Date.now(),
				interpolationTime: this.SERVER_UPDATE_RATE,
			});
		},

		processServerUpdate(gameState) {
			const now = Date.now();

			// Spracovanie hráčov
			for (const serverPlayer of gameState.players || []) {
				let playerState = this.playerStates.get(serverPlayer.id);

				if (!playerState) {
					// Nový hráč
					this.initPlayerInterpolation(serverPlayer.id, serverPlayer);

					// Pridanie do zoznamu hráčov
					this.players.push({
						id: serverPlayer.id,
						name: serverPlayer.name,
						color: serverPlayer.color,
						mass: serverPlayer.mass,
						radius: serverPlayer.radius,
					});
					continue;
				}

				// Aktualizácia cieľovej pozície pre interpoláciu
				playerState.target = { ...serverPlayer };
				playerState.lastUpdate = now;
				playerState.interpolationTime = this.SERVER_UPDATE_RATE;

				// Okamžitá aktualizácia vlastností okrem pozície
				playerState.current.mass = serverPlayer.mass;
				playerState.current.radius = serverPlayer.radius;
				playerState.current.color = serverPlayer.color;
				playerState.current.name = serverPlayer.name;

				// Aktualizácia v zozname hráčov
				const existingPlayer = this.players.find(
					(p) => p.id === serverPlayer.id,
				);
				if (existingPlayer) {
					existingPlayer.mass = serverPlayer.mass;
					existingPlayer.radius = serverPlayer.radius;
					existingPlayer.color = serverPlayer.color;
					existingPlayer.name = serverPlayer.name;
				}
			}

			// Spracovanie jedla
			this.food = (gameState.food || []).map((f) => ({ ...f }));

			// Aktualizácia počtu hráčov
			this.playerCount = gameState.totalPlayers || this.playerStates.size;

			// Leaderboard
			this.updateLeaderboard(gameState);

			// Odstránenie odpojených hráčov
			const currentPlayerIds = new Set(
				gameState.players?.map((p) => p.id) || [],
			);
			for (const [playerId] of this.playerStates) {
				if (
					!currentPlayerIds.has(playerId) &&
					playerId !== this.currentPlayer?.id
				) {
					this.playerStates.delete(playerId);
					this.players = this.players.filter((p) => p.id !== playerId);
				}
			}
		},

		updateLeaderboard(gameState) {
			const players = Array.from(this.playerStates.values())
				.map((state) => ({
					id: state.current.id,
					name: state.current.name,
					mass: state.current.mass,
				}))
				.sort((a, b) => b.mass - a.mass)
				.slice(0, 10);

			this.leaderboard = players;
		},

		handlePlayerDeath(data = {}) {
			if (this.gameOver) return;
			this.gameOver = true;
			this.gameStarted = false;
			this.finalMass = this.currentPlayer?.mass || 0;
			this.eatenBy = data.eatenBy || "Another player";

			const sorted = [...this.leaderboard].sort((a, b) => b.mass - a.mass);
			const pos = sorted.findIndex((p) => p.id === this.currentPlayer?.id) + 1;
			this.finalPosition = pos > 0 ? `#${pos}` : "Unknown";
		},

		startGame() {
			if (!this.playerName.trim()) this.playerName = "Anonymous";
			this.gameStarted = true;
			this.gameOver = false;
			this.finalMass = 0;
			this.finalPosition = 0;
			this.eatenBy = "";
			this.playerStates.clear();
			this.players = [];
			this.food = [];
			this.camera = { x: 0, y: 0 };
			this.lastMoveSend = 0;
			this.socket.emit("join", this.playerName);
		},

		restartGame() {
			this.startGame();
		},

		backToMenu() {
			this.gameStarted = false;
			this.gameOver = false;
			this.currentPlayer = null;
			this.players = [];
			this.food = [];
			this.playerCount = 0;
			this.leaderboard = [];
			this.playerStates.clear();
			this.camera = { x: 0, y: 0 };
		},

		initCanvas() {
			this.canvas = document.getElementById("gameCanvas");
			this.ctx = this.canvas.getContext("2d");
			this.resizeCanvas();
			window.addEventListener("resize", () => this.resizeCanvas());

			// Plynulejšie sledovanie myši
			this.canvas.addEventListener("mousemove", (e) => {
				const rect = this.canvas.getBoundingClientRect();
				this.mouse.x = e.clientX - rect.left;
				this.mouse.y = e.clientY - rect.top;
			});
		},

		resizeCanvas() {
			this.canvas.width = window.innerWidth;
			this.canvas.height = window.innerHeight;
		},

		startGameLoop() {
			const loop = (timestamp) => {
				if (!this.lastRender) this.lastRender = timestamp;
				const delta = timestamp - this.lastRender;

				if (delta >= 16) {
					// ~60 FPS
					this.update(delta);
					this.render();
					this.lastRender = timestamp;
				}

				requestAnimationFrame(loop);
			};

			requestAnimationFrame(loop);
		},

		update(delta) {
			if (!this.currentPlayer || this.gameOver || !this.gameStarted) return;

			// Interpolácia všetkých hráčov
			this.interpolatePlayers();

			// Odoslanie pohybu myši
			this.sendMousePosition();

			// Aktualizácia kamery
			this.updateCamera();
		},

		interpolatePlayers() {
			const now = Date.now();

			for (const [playerId, state] of this.playerStates) {
				const timeSinceUpdate = now - state.lastUpdate;
				const interpolationFactor = Math.min(
					1,
					timeSinceUpdate / state.interpolationTime,
				);

				// Plynulá interpolácia pozície
				state.current.x = this.lerp(
					state.current.x,
					state.target.x,
					interpolationFactor,
				);
				state.current.y = this.lerp(
					state.current.y,
					state.target.y,
					interpolationFactor,
				);

				// Plynulá interpolácia veľkosti
				state.current.radius = this.lerp(
					state.current.radius,
					state.target.radius,
					interpolationFactor * 0.5,
				);

				// Aktualizácia aktuálneho hráča
				if (playerId === this.currentPlayer.id) {
					this.currentPlayer.x = state.current.x;
					this.currentPlayer.y = state.current.y;
					this.currentPlayer.radius = state.current.radius;
					this.currentPlayer.mass = state.current.mass;
				}
			}
		},

		lerp(start, end, factor) {
			return start + (end - start) * factor;
		},

		sendMousePosition() {
			const now = Date.now();

			if (now - this.lastMoveSend >= this.MOVE_SEND_RATE) {
				const targetX = this.camera.x + this.mouse.x;
				const targetY = this.camera.y + this.mouse.y;

				this.socket.emit("move", {
					x: Math.round(targetX),
					y: Math.round(targetY),
				});

				this.lastMoveSend = now;
			}
		},

		updateCamera() {
			if (!this.currentPlayer) return;

			const targetX = this.currentPlayer.x - this.canvas.width / 2;
			const targetY = this.currentPlayer.y - this.canvas.height / 2;

			// Veľmi plynulé sledovanie kamery
			this.camera.x += (targetX - this.camera.x) * this.CAMERA_SMOOTHING;
			this.camera.y += (targetY - this.camera.y) * this.CAMERA_SMOOTHING;
		},

		render() {
			// Clear canvas
			this.ctx.fillStyle = "#1a1a1a";
			this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

			if (!this.currentPlayer || this.gameOver || !this.gameStarted) return;

			this.ctx.save();
			this.ctx.translate(-this.camera.x, -this.camera.y);

			this.drawGrid();
			this.drawFood();
			this.drawPlayers();

			this.ctx.restore();
		},

		drawGrid() {
			const gridSize = 100;
			const startX = Math.floor(this.camera.x / gridSize) * gridSize;
			const startY = Math.floor(this.camera.y / gridSize) * gridSize;

			this.ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
			this.ctx.lineWidth = 1;
			this.ctx.beginPath();

			for (
				let x = startX;
				x < this.camera.x + this.canvas.width + gridSize;
				x += gridSize
			) {
				this.ctx.moveTo(x, this.camera.y);
				this.ctx.lineTo(x, this.camera.y + this.canvas.height);
			}
			for (
				let y = startY;
				y < this.camera.y + this.canvas.height + gridSize;
				y += gridSize
			) {
				this.ctx.moveTo(this.camera.x, y);
				this.ctx.lineTo(this.camera.x + this.canvas.width, y);
			}

			this.ctx.stroke();
		},

		drawFood() {
			for (const f of this.food) {
				// Jednoduchšie vykreslenie jedla pre lepší výkon
				this.ctx.fillStyle = f.color;
				this.ctx.beginPath();
				this.ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
				this.ctx.fill();
			}
		},

		drawPlayers() {
			const playersToDraw = [];

			// Zber všetkých hráčov na vykreslenie
			for (const [playerId, state] of this.playerStates) {
				playersToDraw.push({
					...state.current,
					isSelf: playerId === this.currentPlayer.id,
				});
			}

			// Zoradenie podľa veľkosti pre správne prekrytie
			playersToDraw.sort((a, b) => a.radius - b.radius);

			// Vykreslenie všetkých hráčov
			for (const player of playersToDraw) {
				this.drawPlayer(player);
			}
		},

		drawPlayer(player) {
			// Telo hráča
			this.ctx.fillStyle = player.color;
			this.ctx.beginPath();
			this.ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
			this.ctx.fill();

			// Okraj
			this.ctx.strokeStyle = player.isSelf ? "#ffffff" : "rgba(0, 0, 0, 0.4)";
			this.ctx.lineWidth = player.isSelf ? 4 : 2;
			this.ctx.stroke();

			// Meno (iba pre väčších hráčov)
			if (player.radius >= 20) {
				this.ctx.fillStyle = "#ffffff";
				this.ctx.strokeStyle = "#000000";
				this.ctx.lineWidth = 2;
				this.ctx.textAlign = "center";
				this.ctx.textBaseline = "middle";

				const fontSize = Math.max(12, Math.min(24, player.radius / 2));
				this.ctx.font = `bold ${fontSize}px Arial`;

				// Tien textu
				this.ctx.strokeText(player.name, player.x, player.y);
				// Hlavný text
				this.ctx.fillText(player.name, player.x, player.y);
			}
		},
	};
}

// Inicializácia aplikácie
const app = gameApp();
window.addEventListener("load", () => {
	app.init();

	const startBtn = document.getElementById("startBtn");
	const nameInput = document.getElementById("nameInput");

	if (startBtn && nameInput) {
		startBtn.addEventListener("click", () => {
			app.playerName = nameInput.value.trim() || "Anonymous";
			app.startGame();
		});

		// Možnosť štartovať hru pomocou Enter
		nameInput.addEventListener("keypress", (e) => {
			if (e.key === "Enter") {
				app.playerName = nameInput.value.trim() || "Anonymous";
				app.startGame();
			}
		});
	}
});
