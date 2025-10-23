function gameApp() {
	return {
		// Game state
		gameStarted: false,
		gameOver: false,
		playerName: "",
		currentPlayer: null,
		leaderboard: [],
		playerCount: 0,
		finalMass: 0,
		finalPosition: 0,
		eatenBy: "",

		// Socket and game variables
		socket: null,
		canvas: null,
		ctx: null,
		players: {},
		foods: {},
		viruses: {},
		camera: { x: 0, y: 0 },

		// Optimalizácie
		lastFrameTime: 0,
		frameCount: 0,
		fps: 0,
		visibleObjects: {
			players: new Set(),
			foods: new Set(),
			viruses: new Set(),
		},
		objectCache: new Map(),
		renderDistance: 2000,
		debugMode: false,

		init() {
			this.canvas = document.getElementById("gameCanvas");
			this.ctx = this.canvas.getContext("2d");
			this.resizeCanvas();
			window.addEventListener("resize", () => this.resizeCanvas());

			// Debug panel
			if (this.debugMode) {
				this.setupDebugPanel();
			}
		},

		resizeCanvas() {
			this.canvas.width = window.innerWidth;
			this.canvas.height = window.innerHeight;
		},

		setupDebugPanel() {
			const debugDiv = document.createElement("div");
			debugDiv.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 10px;
        font-family: monospace;
        z-index: 1000;
        border-radius: 5px;
      `;
			debugDiv.innerHTML = `
        <div>FPS: <span id="fpsCounter">0</span></div>
        <div>Players: <span id="playerCounter">0</span></div>
        <div>Food: <span id="foodCounter">0</span></div>
        <div>Visible: <span id="visibleCounter">0</span></div>
      `;
			document.body.appendChild(debugDiv);
		},

		startGame() {
			if (!this.playerName.trim()) {
				this.playerName = "Player" + Math.floor(Math.random() * 1000);
			}

			this.socket = io();
			this.setupSocketEvents();

			this.gameStarted = true;
			this.gameOver = false;

			this.socket.emit("joinGame", {
				name: this.playerName,
				screenWidth: window.innerWidth,
				screenHeight: window.innerHeight,
			});

			this.lastFrameTime = performance.now();
			this.gameLoop();
		},

		setupSocketEvents() {
			// Throttle mouse events
			let lastMouseEmit = 0;
			const mouseThrottle = 16; // ~60fps

			this.socket.on("gameState", (data) => {
				// Batch update objects
				this.batchUpdateObjects(data);

				// Update current player
				if (data.players[this.socket.id]) {
					this.currentPlayer = data.players[this.socket.id];

					// Smooth camera movement
					const targetX = this.currentPlayer.x - this.canvas.width / 2;
					const targetY = this.currentPlayer.y - this.canvas.height / 2;

					this.camera.x += (targetX - this.camera.x) * 0.1;
					this.camera.y += (targetY - this.camera.y) * 0.1;
				}
			});

			this.socket.on("leaderboardUpdate", (leaderboard) => {
				this.leaderboard = leaderboard.slice(0, 10); // Limit to top 10
			});

			this.socket.on("playerCountUpdate", (count) => {
				this.playerCount = count;
			});

			this.socket.on("gameOver", (data) => {
				this.finalMass = data.mass;
				this.finalPosition = data.position;
				this.eatenBy = data.eatenBy;
				this.gameOver = true;
				this.gameStarted = false;

				if (this.socket) {
					this.socket.disconnect();
					this.socket = null;
				}

				// Clear caches
				this.objectCache.clear();
				this.visibleObjects.players.clear();
				this.visibleObjects.foods.clear();
				this.visibleObjects.viruses.clear();
			});

			this.socket.on("playerDisconnected", (playerId) => {
				if (this.players[playerId]) {
					delete this.players[playerId];
					this.visibleObjects.players.delete(playerId);
					this.objectCache.delete(`player_${playerId}`);
				}
			});

			// Optimized mouse movement with throttling
			this.canvas.addEventListener("mousemove", (e) => {
				const now = performance.now();
				if (
					now - lastMouseEmit < mouseThrottle ||
					!this.socket ||
					!this.currentPlayer
				) {
					return;
				}

				lastMouseEmit = now;

				const rect = this.canvas.getBoundingClientRect();
				const mouseX = e.clientX - rect.left;
				const mouseY = e.clientY - rect.top;

				const targetX = this.camera.x + mouseX;
				const targetY = this.camera.y + mouseY;

				this.socket.emit("mouseMove", { x: targetX, y: targetY });
			});

			// Space bar for splitting with cooldown
			let lastSplitTime = 0;
			const splitCooldown = 500;

			document.addEventListener("keydown", (e) => {
				if (e.code === "Space" && this.socket) {
					e.preventDefault();

					const now = Date.now();
					if (now - lastSplitTime > splitCooldown) {
						lastSplitTime = now;
						this.socket.emit("split");
					}
				}
			});
		},

		batchUpdateObjects(data) {
			// Batch update players
			Object.keys(data.players).forEach((playerId) => {
				const player = data.players[playerId];
				this.players[playerId] = player;
				this.objectCache.set(`player_${playerId}`, player);
			});

			// Batch update foods
			Object.keys(data.foods).forEach((foodId) => {
				const food = data.foods[foodId];
				this.foods[foodId] = food;
				this.objectCache.set(`food_${foodId}`, food);
			});

			// Batch update viruses
			if (data.viruses) {
				Object.keys(data.viruses).forEach((virusId) => {
					const virus = data.viruses[virusId];
					this.viruses[virusId] = virus;
					this.objectCache.set(`virus_${virusId}`, virus);
				});
			}
		},

		gameLoop(currentTime = performance.now()) {
			if (!this.gameStarted) return;

			// Calculate FPS
			this.frameCount++;
			if (currentTime - this.lastFrameTime >= 1000) {
				this.fps = Math.round(
					(this.frameCount * 1000) / (currentTime - this.lastFrameTime),
				);
				this.frameCount = 0;
				this.lastFrameTime = currentTime;

				if (this.debugMode) {
					this.updateDebugInfo();
				}
			}

			this.ctx.fillStyle = "#f0f0f0";
			this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

			// Draw grid (menej často pri nízkom FPS)
			if (this.fps > 30 || this.frameCount % 2 === 0) {
				this.drawGrid();
			}

			this.ctx.save();
			this.ctx.translate(-this.camera.x, -this.camera.y);

			// Calculate visible area for culling
			this.calculateVisibleObjects();

			// Draw only visible objects
			this.drawVisibleFoods();
			this.drawVisibleViruses();
			this.drawVisiblePlayers();

			this.ctx.restore();

			requestAnimationFrame((time) => this.gameLoop(time));
		},

		calculateVisibleObjects() {
			this.visibleObjects.players.clear();
			this.visibleObjects.foods.clear();
			this.visibleObjects.viruses.clear();

			const viewport = {
				left: this.camera.x - this.renderDistance,
				right: this.camera.x + this.canvas.width + this.renderDistance,
				top: this.camera.y - this.renderDistance,
				bottom: this.camera.y + this.canvas.height + this.renderDistance,
			};

			// Check players visibility
			Object.keys(this.players).forEach((playerId) => {
				const player = this.players[playerId];
				if (this.isObjectVisible(player, viewport)) {
					this.visibleObjects.players.add(playerId);
				}
			});

			// Check foods visibility
			Object.keys(this.foods).forEach((foodId) => {
				const food = this.foods[foodId];
				if (this.isObjectVisible(food, viewport)) {
					this.visibleObjects.foods.add(foodId);
				}
			});

			// Check viruses visibility
			Object.keys(this.viruses).forEach((virusId) => {
				const virus = this.viruses[virusId];
				if (this.isObjectVisible(virus, viewport)) {
					this.visibleObjects.viruses.add(virusId);
				}
			});
		},

		isObjectVisible(obj, viewport) {
			return (
				obj.x + obj.radius >= viewport.left &&
				obj.x - obj.radius <= viewport.right &&
				obj.y + obj.radius >= viewport.top &&
				obj.y - obj.radius <= viewport.bottom
			);
		},

		drawGrid() {
			const gridSize = 100;

			this.ctx.strokeStyle = "#e0e0e0";
			this.ctx.lineWidth = 1;

			const startX = this.camera.x;
			const startY = this.camera.y;
			const endX = this.camera.x + this.canvas.width;
			const endY = this.camera.y + this.canvas.height;

			// Vertical lines
			for (
				let x = Math.floor(startX / gridSize) * gridSize;
				x <= endX;
				x += gridSize
			) {
				const screenX = x - this.camera.x;
				this.ctx.beginPath();
				this.ctx.moveTo(screenX, 0);
				this.ctx.lineTo(screenX, this.canvas.height);
				this.ctx.stroke();
			}

			// Horizontal lines
			for (
				let y = Math.floor(startY / gridSize) * gridSize;
				y <= endY;
				y += gridSize
			) {
				const screenY = y - this.camera.y;
				this.ctx.beginPath();
				this.ctx.moveTo(0, screenY);
				this.ctx.lineTo(this.canvas.width, screenY);
				this.ctx.stroke();
			}
		},

		drawVisibleFoods() {
			this.visibleObjects.foods.forEach((foodId) => {
				const food = this.foods[foodId];
				if (!food) return;

				this.ctx.fillStyle = food.color;
				this.ctx.beginPath();
				this.ctx.arc(food.x, food.y, food.radius, 0, Math.PI * 2);
				this.ctx.fill();
			});
		},

		drawVisibleViruses() {
			this.visibleObjects.viruses.forEach((virusId) => {
				const virus = this.viruses[virusId];
				if (!virus) return;

				this.ctx.fillStyle = virus.color;
				this.ctx.beginPath();
				this.ctx.arc(virus.x, virus.y, virus.radius, 0, Math.PI * 2);
				this.ctx.fill();

				// Draw virus spikes (len ak je virus dostatočne veľký)
				if (virus.radius > 10) {
					this.ctx.strokeStyle = virus.color;
					this.ctx.lineWidth = 2;
					const spikes = 8;
					for (let i = 0; i < spikes; i++) {
						const angle = (i / spikes) * Math.PI * 2;
						const spikeLength = virus.radius * 1.5;
						const startX = virus.x + Math.cos(angle) * virus.radius;
						const startY = virus.y + Math.sin(angle) * virus.radius;
						const endX = virus.x + Math.cos(angle) * spikeLength;
						const endY = virus.y + Math.sin(angle) * spikeLength;

						this.ctx.beginPath();
						this.ctx.moveTo(startX, startY);
						this.ctx.lineTo(endX, endY);
						this.ctx.stroke();
					}
				}
			});
		},

		drawVisiblePlayers() {
			this.visibleObjects.players.forEach((playerId) => {
				const player = this.players[playerId];
				if (!player) return;

				// Draw player cell(s) - optimalizované pre multi-cell hráčov
				if (player.cells && Array.isArray(player.cells)) {
					player.cells.forEach((cell) => {
						this.ctx.fillStyle = player.color;
						this.ctx.beginPath();
						this.ctx.arc(cell.x, cell.y, cell.radius, 0, Math.PI * 2);
						this.ctx.fill();

						// Draw player name (len ak je cell dostatočne veľká)
						if (cell.radius > 15) {
							this.ctx.fillStyle = "#fff";
							this.ctx.font = `${Math.max(12, Math.min(20, cell.radius / 3))}px Arial`;
							this.ctx.textAlign = "center";
							this.ctx.textBaseline = "middle";
							this.ctx.fillText(player.name, cell.x, cell.y);
						}
					});
				} else {
					// Single cell player
					this.ctx.fillStyle = player.color;
					this.ctx.beginPath();
					this.ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
					this.ctx.fill();

					if (player.radius > 15) {
						this.ctx.fillStyle = "#fff";
						this.ctx.font = `${Math.max(12, Math.min(20, player.radius / 3))}px Arial`;
						this.ctx.textAlign = "center";
						this.ctx.textBaseline = "middle";
						this.ctx.fillText(player.name, player.x, player.y);
					}
				}
			});
		},

		updateDebugInfo() {
			const fpsCounter = document.getElementById("fpsCounter");
			const playerCounter = document.getElementById("playerCounter");
			const foodCounter = document.getElementById("foodCounter");
			const visibleCounter = document.getElementById("visibleCounter");

			if (fpsCounter) fpsCounter.textContent = this.fps;
			if (playerCounter)
				playerCounter.textContent = Object.keys(this.players).length;
			if (foodCounter) foodCounter.textContent = Object.keys(this.foods).length;
			if (visibleCounter) {
				const totalVisible =
					this.visibleObjects.players.size +
					this.visibleObjects.foods.size +
					this.visibleObjects.viruses.size;
				visibleCounter.textContent = totalVisible;
			}
		},

		restartGame() {
			this.gameOver = false;

			// Clear caches before restart
			this.objectCache.clear();
			this.visibleObjects.players.clear();
			this.visibleObjects.foods.clear();
			this.visibleObjects.viruses.clear();

			this.startGame();
		},

		backToMenu() {
			this.gameStarted = false;
			this.gameOver = false;
			this.currentPlayer = null;
			this.leaderboard = [];
			this.playerCount = 0;

			// Clear all caches
			this.objectCache.clear();
			this.visibleObjects.players.clear();
			this.visibleObjects.foods.clear();
			this.visibleObjects.viruses.clear();

			if (this.socket) {
				this.socket.disconnect();
				this.socket = null;
			}
		},
	};
}
