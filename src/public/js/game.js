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
			this.setupEventListeners(); // Pridané - nastavenie event listenerov
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
				this.updateUI(); // Pridané - update UI po inicializácii
			});

			this.socket.on("gameUpdate", (gameState) => {
				if (this.gameOver || !this.gameStarted) return;

				this.serverUpdateTime = Date.now();
				this.lastServerTimestamp = gameState.ts;
				this.processServerUpdate(gameState);
				this.updateUI(); // Pridané - update UI po každom game update
			});

			this.socket.on("playerDeath", (data) => {
				if (data.playerId === this.currentPlayer?.id) {
					this.handlePlayerDeath(data);
					this.updateUI(); // Pridané - update UI po smrti hráča
				}
			});

			// Pridané - connection listeners pre debug
			this.socket.on("connect", () => {
				console.log("Connected to server");
			});

			this.socket.on("connect_error", (error) => {
				console.error("Connection error:", error);
			});
		},

		// Pridané - nastavenie event listenerov pre tlačidlá
		setupEventListeners() {
			const startBtn = document.getElementById("startBtn");
			const nameInput = document.getElementById("nameInput");
			const restartBtn = document.getElementById("restartBtn");
			const backToMenuBtn = document.getElementById("backToMenuBtn");

			if (startBtn && nameInput) {
				startBtn.addEventListener("click", () => {
					console.log("Start button clicked");
					this.playerName = nameInput.value.trim() || "Anonymous";
					this.startGame();
				});

				nameInput.addEventListener("keypress", (e) => {
					if (e.key === "Enter") {
						console.log("Enter pressed in name input");
						this.playerName = nameInput.value.trim() || "Anonymous";
						this.startGame();
					}
				});
			}

			if (restartBtn) {
				restartBtn.addEventListener("click", () => {
					console.log("Restart button clicked");
					this.restartGame();
				});
			}

			if (backToMenuBtn) {
				backToMenuBtn.addEventListener("click", () => {
					console.log("Back to menu button clicked");
					this.backToMenu();
				});
			}
		},

		// Pridané - update UI metóda
		updateUI() {
			// Update mass display
			const massElement = document.getElementById("massValue");
			if (massElement) {
				massElement.textContent = Math.floor(this.currentPlayer?.mass || 0).toString();
			}

			// Update player count
			const playerCountElement = document.getElementById("playerCountValue");
			if (playerCountElement) {
				playerCountElement.textContent = this.playerCount.toString();
			}

			// Update leaderboard
			this.updateLeaderboardUI();

			// Update game over screen
			if (this.gameOver) {
				this.updateGameOverUI();
			}

			// Show/hide screens based on game state
			this.updateScreenVisibility();
		},

		// Pridané - update leaderboard UI
		updateLeaderboardUI() {
			const leaderboardContainer = document.getElementById("leaderboardContainer");
			if (!leaderboardContainer) return;

			leaderboardContainer.innerHTML = '';
			
			this.leaderboard.slice(0, 10).forEach((player, index) => {
				const item = document.createElement('div');
				const isCurrentPlayer = player.id === this.currentPlayer?.id;
				item.className = `leaderboard-item ${isCurrentPlayer ? 'current-player' : ''}`;
				
				item.innerHTML = `
					<span class="leaderboard-name">${index + 1}. ${player.name}</span>
					<span class="leaderboard-mass">${Math.floor(player.mass)}</span>
				`;
				
				leaderboardContainer.appendChild(item);
			});
		},

		// Pridané - update game over UI
		updateGameOverUI() {
			const finalMassElement = document.getElementById("finalMassValue");
			if (finalMassElement) {
				finalMassElement.textContent = Math.floor(this.finalMass).toString();
			}

			const finalPositionElement = document.getElementById("finalPositionValue");
			if (finalPositionElement) {
				finalPositionElement.textContent = this.finalPosition.toString();
			}

			const eatenByElement = document.getElementById("eatenByValue");
			if (eatenByElement) {
				eatenByElement.textContent = this.eatenBy || 'Unknown';
			}
		},

		// Pridané - update visibility obrazoviek
		updateScreenVisibility() {
			const menuScreen = document.getElementById("menuScreen");
			const gameScreen = document.getElementById("gameScreen");
			const gameOverScreen = document.getElementById("gameOverScreen");

			if (menuScreen) {
				menuScreen.style.display = (!this.gameStarted && !this.gameOver) ? 'flex' : 'none';
			}
			if (gameScreen) {
				gameScreen.style.display = (this.gameStarted && !this.gameOver) ? 'block' : 'none';
			}
			if (gameOverScreen) {
				gameOverScreen.style.display = this.gameOver ? 'flex' : 'none';
			}
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
			this.finalPosition = pos > 0 ? pos : 0; // Zmenené z `#${pos}` na číslo
			
			this.updateUI(); // Pridané - update UI po smrti
		},

		startGame() {
			console.log("startGame called");
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
			
			console.log("Emitting join event with name:", this.playerName);
			this.socket.emit("join", this.playerName);
			
			this.updateUI(); // Pridané - update UI po štarte hry
		},

		restartGame() {
			console.log("restartGame called");
			this.startGame();
		},

		backToMenu() {
			console.log("backToMenu called");
			this.gameStarted = false;
			this.gameOver = false;
			this.currentPlayer = null;
			this.players = [];
			this.food = [];
			this.playerCount = 0;
			this.leaderboard = [];
			this.playerStates.clear();
			this.camera = { x: 0, y: 0 };
			
			this.updateUI(); // Pridané - update UI po návrate do menu
		},

		initCanvas() {
			this.canvas = document.getElementById("gameCanvas");
			if (!this.canvas) {
				console.error("Canvas element not found!");
				return;
			}
			
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
			if (!this.canvas) return;
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
			if (!this.currentPlayer || !this.canvas) return;

			const targetX = this.currentPlayer.x - this.canvas.width / 2;
			const targetY = this.currentPlayer.y - this.canvas.height / 2;

			// Veľmi plynulé sledovanie kamery
			this.camera.x += (targetX - this.camera.x) * this.CAMERA_SMOOTHING;
			this.camera.y += (targetY - this.camera.y) * this.CAMERA_SMOOTHING;
		},

		render() {
			if (!this.ctx || !this.canvas) return;
			
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
	console.log("Window loaded, initializing app");
	app.init();
});