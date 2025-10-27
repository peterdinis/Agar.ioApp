import { Server, Socket } from "socket.io";

interface Player {
	id: string;
	x: number;
	y: number;
	radius: number;
	color: string;
	name: string;
	mass: number;
	targetX: number;
	targetY: number;
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
	private FOOD_COUNT = 1000;
	private MIN_FOOD_RADIUS = 4;
	private MAX_FOOD_RADIUS = 7;
	private BASE_MASS = 100;

	private TICK_RATE = 60; // 60 FPS server
	private BROADCAST_RATE = 50; // 20 updatov za sekundu pre klientov

	constructor(io: Server) {
		this.io = io;
		this.initializeFood();
		this.setupSocketHandlers();
		this.startGameLoop();
	}

	private initializeFood() {
		for (let i = 0; i < this.FOOD_COUNT; i++) {
			this.spawnFood();
		}
	}

	private spawnFood() {
		const f: Food = {
			id: `food_${Date.now()}_${Math.random()}`,
			x: Math.random() * this.WORLD_WIDTH,
			y: Math.random() * this.WORLD_HEIGHT,
			radius:
				this.MIN_FOOD_RADIUS +
				Math.random() * (this.MAX_FOOD_RADIUS - this.MIN_FOOD_RADIUS),
			color: this.getRandomColor(),
		};
		this.food.set(f.id, f);
	}

	private getRandomColor() {
		const colors = [
			"#FF6B6B",
			"#4ECDC4",
			"#45B7D1",
			"#FFA07A",
			"#98D8C8",
			"#F7DC6F",
			"#BB8FCE",
			"#85C1E9",
		];
		return colors[Math.floor(Math.random() * colors.length)];
	}

	private massToRadius(mass: number) {
		return Math.sqrt(mass) * 2;
	}

	private setupSocketHandlers() {
		this.io.on("connection", (socket: Socket) => {
			console.log("Player connected:", socket.id);

			socket.on("join", (name: string) => {
				const player: Player = {
					id: socket.id,
					x: Math.random() * this.WORLD_WIDTH,
					y: Math.random() * this.WORLD_HEIGHT,
					radius: this.massToRadius(this.BASE_MASS),
					color: this.getRandomColor(),
					name: name?.trim() || "Anonymous",
					mass: this.BASE_MASS,
					targetX: 0,
					targetY: 0,
				};

				player.targetX = player.x;
				player.targetY = player.y;

				this.players.set(socket.id, player);

				socket.emit("init", {
					player: { ...player },
					worldWidth: this.WORLD_WIDTH,
					worldHeight: this.WORLD_HEIGHT,
				});

				console.log(
					`Player ${player.name} joined at (${player.x}, ${player.y})`,
				);
			});

			socket.on("move", (data: { x: number; y: number }) => {
				const player = this.players.get(socket.id);
				if (!player) return;

				// Uloženie cieľovej pozície
				player.targetX = Math.max(0, Math.min(this.WORLD_WIDTH, data.x));
				player.targetY = Math.max(0, Math.min(this.WORLD_HEIGHT, data.y));
			});

			socket.on("disconnect", () => {
				this.players.delete(socket.id);
				console.log("Player disconnected:", socket.id);
			});
		});
	}

	private updatePlayers(deltaTime: number) {
		const baseSpeed = 5;

		for (const player of this.players.values()) {
			const dx = player.targetX - player.x;
			const dy = player.targetY - player.y;
			const distance = Math.sqrt(dx * dx + dy * dy);

			if (distance > 1) {
				// Rýchlosť založená na hmotnosti
				const speed = Math.max(1, baseSpeed - player.mass / 500);
				const moveDistance = Math.min(distance, speed);

				if (distance > 0) {
					player.x += (dx / distance) * moveDistance;
					player.y += (dy / distance) * moveDistance;
				}

				// Udržanie hráča v hracej ploche
				player.x = Math.max(
					player.radius,
					Math.min(this.WORLD_WIDTH - player.radius, player.x),
				);
				player.y = Math.max(
					player.radius,
					Math.min(this.WORLD_HEIGHT - player.radius, player.y),
				);
			}

			// Aktualizácia polomeru na základe hmotnosti
			player.radius = this.massToRadius(player.mass);
		}
	}

	private checkCollisions() {
		// Kolízie s jedlom
		for (const player of this.players.values()) {
			for (const [foodId, food] of this.food) {
				const dx = player.x - food.x;
				const dy = player.y - food.y;
				const distance = Math.sqrt(dx * dx + dy * dy);

				if (distance < player.radius + food.radius) {
					// Hráč zje jedlo
					player.mass += food.radius * 2;
					this.food.delete(foodId);
					this.spawnFood();
					break;
				}
			}
		}

		// Kolízie medzi hráčmi
		const playersArray = Array.from(this.players.values());

		for (let i = 0; i < playersArray.length; i++) {
			for (let j = i + 1; j < playersArray.length; j++) {
				const player1 = playersArray[i];
				const player2 = playersArray[j];

				const dx = player1.x - player2.x;
				const dy = player1.y - player2.y;
				const distance = Math.sqrt(dx * dx + dy * dy);
				const minDistance = player1.radius + player2.radius;

				if (distance < minDistance) {
					// Hráč s väčšou hmotnosťou zje menšieho
					if (player1.mass > player2.mass * 1.2) {
						player1.mass += player2.mass * 0.8;
						this.io.to(player2.id).emit("playerDeath", {
							playerId: player2.id,
							eatenBy: player1.name,
						});
						this.players.delete(player2.id);
					} else if (player2.mass > player1.mass * 1.2) {
						player2.mass += player1.mass * 0.8;
						this.io.to(player1.id).emit("playerDeath", {
							playerId: player1.id,
							eatenBy: player2.name,
						});
						this.players.delete(player1.id);
					}
				}
			}
		}
	}

	private broadcastGameState() {
		const gameState = {
			ts: Date.now(),
			players: Array.from(this.players.values()).map((player) => ({
				id: player.id,
				x: player.x,
				y: player.y,
				radius: player.radius,
				mass: player.mass,
				name: player.name,
				color: player.color,
			})),
			food: Array.from(this.food.values()),
			totalPlayers: this.players.size,
		};

		this.io.emit("gameUpdate", gameState);
	}

	private startGameLoop() {
		let lastTime = Date.now();
		let lastBroadcast = 0;
		const tickInterval = 1000 / this.TICK_RATE;

		const gameLoop = () => {
			const currentTime = Date.now();
			const deltaTime = currentTime - lastTime;

			// Update game logic
			this.updatePlayers(deltaTime);
			this.checkCollisions();

			// Broadcast at specified rate
			if (currentTime - lastBroadcast >= this.BROADCAST_RATE) {
				this.broadcastGameState();
				lastBroadcast = currentTime;
			}

			lastTime = currentTime;

			setTimeout(gameLoop, tickInterval);
		};

		gameLoop();
	}
}
