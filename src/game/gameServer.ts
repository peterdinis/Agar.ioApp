import { Server, Socket } from "socket.io";

/**
 * Represents a player in the game
 * @interface Player
 */
interface Player {
	id: string;
	x: number;
	y: number;
	radius: number;
	color: string;
	name: string;
	mass: number;
	isBot: boolean;
	targetX?: number;
	targetY?: number;
	lastTargetChange?: number;
	behavior: "hunter" | "prey" | "neutral";
	aggression: number;
	lastMoveTime?: number;
	splitParts?: string[];
	parentId?: string;
	score: number;
	isControlled: boolean;
	lastUpdate: number;
	quadrant?: string;
}

/**
 * Represents food in the game world
 * @interface Food
 */
interface Food {
	id: string;
	x: number;
	y: number;
	radius: number;
	color: string;
	quadrant: string;
}

/**
 * Represents a spatial partitioning quadrant for optimization
 * @interface Quadrant
 */
interface Quadrant {
	x: number;
	y: number;
	width: number;
	height: number;
	players: Set<string>;
	food: Set<string>;
}

/**
 * Main game server class that handles game logic, player management, and real-time communication
 * @class GameServer
 */
export class GameServer {
	private io: Server;
	private players: Map<string, Player> = new Map();
	private food: Map<string, Food> = new Map();
	private readonly WORLD_WIDTH = 5000;
	private readonly WORLD_HEIGHT = 5000;
	private readonly FOOD_COUNT = 800;
	private readonly MIN_FOOD_RADIUS = 5;
	private readonly MAX_FOOD_RADIUS = 8;
	private readonly BASE_RADIUS = 20;
	private readonly BASE_MASS = 100;
	private lastUpdateTime = Date.now();

	private readonly PLAYER_SPEED = 15;
	private readonly MIN_SPLIT_MASS = 50;

	// Optimization: Spatial partitioning
	private readonly QUADRANT_SIZE = 500;
	private quadrants: Map<string, Quadrant> = new Map();
	private readonly MAX_PLAYERS = 1000;
	private readonly UPDATE_RATE = 60; // FPS
	private readonly BROADCAST_RATE = 20; // FPS for clients

	/**
	 * Creates a new GameServer instance
	 * @constructor
	 * @param {Server} io - Socket.IO server instance
	 */
	constructor(io: Server) {
		this.io = io;
		this.initializeQuadrants();
		this.initializeFood();
		this.setupSocketHandlers();
		this.startGameLoop();
	}

	/**
	 * Initializes spatial partitioning quadrants for optimization
	 * @private
	 */
	private initializeQuadrants(): void {
		const cols = Math.ceil(this.WORLD_WIDTH / this.QUADRANT_SIZE);
		const rows = Math.ceil(this.WORLD_HEIGHT / this.QUADRANT_SIZE);

		for (let x = 0; x < cols; x++) {
			for (let y = 0; y < rows; y++) {
				const quadrantId = `${x}_${y}`;
				this.quadrants.set(quadrantId, {
					x: x * this.QUADRANT_SIZE,
					y: y * this.QUADRANT_SIZE,
					width: this.QUADRANT_SIZE,
					height: this.QUADRANT_SIZE,
					players: new Set(),
					food: new Set(),
				});
			}
		}
	}

	/**
	 * Gets the quadrant ID for a given position
	 * @private
	 * @param {number} x - X coordinate
	 * @param {number} y - Y coordinate
	 * @returns {string} Quadrant ID
	 */
	private getQuadrantId(x: number, y: number): string {
		const col = Math.floor(x / this.QUADRANT_SIZE);
		const row = Math.floor(y / this.QUADRANT_SIZE);
		return `${col}_${row}`;
	}

	/**
	 * Updates a player's quadrant position for spatial partitioning
	 * @private
	 * @param {string} playerId - The ID of the player to update
	 * @param {number} [oldX] - Previous X coordinate (optional)
	 * @param {number} [oldY] - Previous Y coordinate (optional)
	 */
	private updatePlayerQuadrant(
		playerId: string,
		oldX?: number,
		oldY?: number,
	): void {
		const player = this.players.get(playerId);
		if (!player) return;

		const newQuadrantId = this.getQuadrantId(player.x, player.y);

		// Remove from old quadrant
		if (oldX !== undefined && oldY !== undefined) {
			const oldQuadrantId = this.getQuadrantId(oldX, oldY);
			if (oldQuadrantId !== newQuadrantId) {
				const oldQuadrant = this.quadrants.get(oldQuadrantId);
				if (oldQuadrant) {
					oldQuadrant.players.delete(playerId);
				}
			}
		}

		// Add to new quadrant
		const newQuadrant = this.quadrants.get(newQuadrantId);
		if (newQuadrant) {
			newQuadrant.players.add(playerId);
		}

		player.quadrant = newQuadrantId;
	}

	/**
	 * Updates a food item's quadrant position
	 * @private
	 * @param {string} foodId - The ID of the food item to update
	 */
	private updateFoodQuadrant(foodId: string): void {
		const food = this.food.get(foodId);
		if (!food) return;

		const quadrantId = this.getQuadrantId(food.x, food.y);
		food.quadrant = quadrantId;

		const quadrant = this.quadrants.get(quadrantId);
		if (quadrant) {
			quadrant.food.add(foodId);
		}
	}

	/**
	 * Initializes the food items in the game world
	 * @private
	 */
	private initializeFood(): void {
		for (let i = 0; i < this.FOOD_COUNT; i++) {
			this.spawnFood();
		}
	}

	/**
	 * Spawns a new food item at a random position
	 * @private
	 */
	private spawnFood(): void {
		const food: Food = {
			id: `food_${Date.now()}_${Math.random()}`,
			x: Math.random() * this.WORLD_WIDTH,
			y: Math.random() * this.WORLD_HEIGHT,
			radius:
				this.MIN_FOOD_RADIUS +
				Math.random() * (this.MAX_FOOD_RADIUS - this.MIN_FOOD_RADIUS),
			color: this.getRandomColor(),
			quadrant: "",
		};

		this.food.set(food.id, food);
		this.updateFoodQuadrant(food.id);
	}

	/**
	 * Moves a player towards a target position
	 * @private
	 * @param {Player} player - The player to move
	 * @param {number} targetX - Target X coordinate
	 * @param {number} targetY - Target Y coordinate
	 */
	private movePlayerTowardsTarget(
		player: Player,
		targetX: number,
		targetY: number,
	): void {
		const oldX = player.x;
		const oldY = player.y;

		const dx = targetX - player.x;
		const dy = targetY - player.y;
		const distance = Math.sqrt(dx * dx + dy * dy);

		if (distance > 5) {
			const speed = this.PLAYER_SPEED;

			const moveX = (dx / distance) * speed;
			const moveY = (dy / distance) * speed;

			player.x += moveX;
			player.y += moveY;

			player.x = Math.max(
				player.radius,
				Math.min(this.WORLD_WIDTH - player.radius, player.x),
			);
			player.y = Math.max(
				player.radius,
				Math.min(this.WORLD_HEIGHT - player.radius, player.y),
			);

			player.lastMoveTime = Date.now();

			// Update quadrant if player moved significantly
			if (Math.abs(oldX - player.x) > 1 || Math.abs(oldY - player.y) > 1) {
				this.updatePlayerQuadrant(player.id, oldX, oldY);
			}
		}
	}

	/**
	 * Moves all parts of a player (including split parts) towards a target
	 * @private
	 * @param {string} playerId - The main player ID
	 * @param {number} targetX - Target X coordinate
	 * @param {number} targetY - Target Y coordinate
	 */
	private moveAllPlayerParts(
		playerId: string,
		targetX: number,
		targetY: number,
	): void {
		const mainPlayer = this.players.get(playerId);
		if (!mainPlayer) return;

		const allParts = this.getAllPlayerParts(playerId);

		this.movePlayerTowardsTarget(mainPlayer, targetX, targetY);

		allParts.forEach((part) => {
			if (part.id !== playerId) {
				const relX = part.x - mainPlayer.x;
				const relY = part.y - mainPlayer.y;

				const partTargetX = targetX + relX;
				const partTargetY = targetY + relY;

				this.movePlayerTowardsTarget(part, partTargetX, partTargetY);
			}
		});
	}

	/**
	 * Gets all parts of a player (main player + split parts)
	 * @private
	 * @param {string} playerId - The main player ID
	 * @returns {Player[]} Array of all player parts
	 */
	private getAllPlayerParts(playerId: string): Player[] {
		const parts: Player[] = [];
		const mainPlayer = this.players.get(playerId);

		if (mainPlayer) {
			parts.push(mainPlayer);

			if (mainPlayer.splitParts) {
				mainPlayer.splitParts.forEach((partId) => {
					const part = this.players.get(partId);
					if (part) {
						parts.push(part);
					}
				});
			}

			// Optimization: Use Map for faster lookup
			for (const [id, player] of this.players) {
				if (player.parentId === playerId) {
					parts.push(player);
				}
			}
		}

		return parts;
	}

	/**
	 * Calculates the distance between two points
	 * @private
	 * @param {number} x1 - First point X coordinate
	 * @param {number} y1 - First point Y coordinate
	 * @param {number} x2 - Second point X coordinate
	 * @param {number} y2 - Second point Y coordinate
	 * @returns {number} Distance between the two points
	 */
	private distance(x1: number, y1: number, x2: number, y2: number): number {
		return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
	}

	/**
	 * Generates a random color for players and food
	 * @private
	 * @returns {string} Hex color code
	 */
	private getRandomColor(): string {
		const colors = [
			"#FF6B6B",
			"#4ECDC4",
			"#45B7D1",
			"#FFA07A",
			"#98D8C8",
			"#F7DC6F",
			"#BB8FCE",
			"#85C1E2",
			"#F8B739",
			"#52B788",
			"#E74C3C",
			"#3498DB",
			"#2ECC71",
			"#F39C12",
			"#9B59B6",
			"#1ABC9C",
			"#E67E22",
			"#95A5A6",
			"#34495E",
			"#16A085",
		];
		return colors[Math.floor(Math.random() * colors.length)];
	}

	/**
	 * Converts mass to radius for players and food
	 * @private
	 * @param {number} mass - The mass value
	 * @returns {number} Calculated radius
	 */
	private massToRadius(mass: number): number {
		return Math.sqrt(mass) * 1.5;
	}

	/**
	 * Sets up Socket.IO event handlers for client connections
	 * @private
	 */
	private setupSocketHandlers(): void {
		this.io.on("connection", (socket: Socket) => {
			console.log(`Player connected: ${socket.id}`);

			// Check maximum player limit
			if (this.players.size >= this.MAX_PLAYERS) {
				socket.emit("serverFull");
				socket.disconnect();
				return;
			}

			/**
			 * Handles player joining the game
			 * @event join
			 * @param {string} name - Player name
			 */
			socket.on("join", (name: string) => {
				if (this.players.has(socket.id)) {
					this.players.delete(socket.id);
				}

				const player: Player = {
					id: socket.id,
					x: Math.random() * this.WORLD_WIDTH,
					y: Math.random() * this.WORLD_HEIGHT,
					radius: this.BASE_RADIUS,
					mass: this.BASE_MASS,
					color: this.getRandomColor(),
					name: (name || "Anonymous").substring(0, 15),
					isBot: false,
					behavior: "neutral",
					aggression: 0.5,
					lastMoveTime: Date.now(),
					splitParts: [],
					score: 0,
					isControlled: true,
					lastUpdate: Date.now(),
				};

				this.players.set(socket.id, player);
				this.updatePlayerQuadrant(socket.id);

				socket.emit("init", {
					player,
					worldWidth: this.WORLD_WIDTH,
					worldHeight: this.WORLD_HEIGHT,
				});

				console.log(
					`Player ${player.name} joined. Total players: ${this.players.size}`,
				);
			});

			/**
			 * Handles player movement
			 * @event move
			 * @param {Object} data - Movement data
			 * @param {number} data.x - Target X coordinate
			 * @param {number} data.y - Target Y coordinate
			 */
			socket.on("move", (data: { x: number; y: number }) => {
				const player = this.players.get(socket.id);
				if (!player || player.isBot) return;

				this.moveAllPlayerParts(socket.id, data.x, data.y);
			});

			/**
			 * Handles player splitting
			 * @event split
			 */
			socket.on("split", () => {
				this.handleSplit(socket.id);
			});

			/**
			 * Handles player disconnection
			 * @event disconnect
			 */
			socket.on("disconnect", () => {
				const player = this.players.get(socket.id);
				if (player && !player.isBot) {
					if (player.splitParts) {
						player.splitParts.forEach((partId) => {
							this.players.delete(partId);
						});
					}
					this.players.delete(socket.id);

					// Remove from quadrant
					if (player.quadrant) {
						const quadrant = this.quadrants.get(player.quadrant);
						if (quadrant) {
							quadrant.players.delete(socket.id);
						}
					}

					console.log(
						`Player disconnected: ${socket.id}. Total players: ${this.players.size}`,
					);
				}
			});
		});
	}

	/**
	 * Handles player splitting logic
	 * @private
	 * @param {string} playerId - The ID of the player to split
	 */
	private handleSplit(playerId: string): void {
		const player = this.players.get(playerId);
		if (!player || player.mass < this.MIN_SPLIT_MASS) return;

		const newMass = player.mass / 2;
		const newRadius = this.massToRadius(newMass);

		player.mass = newMass;
		player.radius = newRadius;

		const newPartId = `${playerId}_part_${Date.now()}`;
		const angle = Math.random() * Math.PI * 2;
		const splitDistance = player.radius * 2;

		const newPart: Player = {
			id: newPartId,
			x: player.x + Math.cos(angle) * splitDistance,
			y: player.y + Math.sin(angle) * splitDistance,
			radius: newRadius,
			mass: newMass,
			color: player.color,
			name: player.name,
			isBot: false,
			behavior: "neutral",
			aggression: 0.5,
			lastMoveTime: Date.now(),
			parentId: playerId,
			splitParts: [],
			score: 0,
			isControlled: true,
			lastUpdate: Date.now(),
		};

		if (!player.splitParts) {
			player.splitParts = [];
		}
		player.splitParts.push(newPartId);

		this.players.set(newPartId, newPart);
		this.updatePlayerQuadrant(newPartId);

		console.log(
			`Player ${playerId} split into two parts. New mass: ${newMass}`,
		);
	}

	/**
	 * Checks for and handles player part merging
	 * @private
	 */
	private checkMerge(): void {
		const playersArray = Array.from(this.players.entries());

		for (let i = 0; i < playersArray.length; i++) {
			const [playerId, player] = playersArray[i];

			if (player.parentId) {
				const parent = this.players.get(player.parentId);
				if (
					parent &&
					this.distance(player.x, player.y, parent.x, parent.y) <
						parent.radius * 2
				) {
					parent.mass += player.mass;
					parent.radius = this.massToRadius(parent.mass);
					parent.score += player.score;

					if (parent.splitParts) {
						parent.splitParts = parent.splitParts.filter(
							(id) => id !== playerId,
						);
					}

					this.players.delete(playerId);

					// Remove from quadrant
					if (player.quadrant) {
						const quadrant = this.quadrants.get(player.quadrant);
						if (quadrant) {
							quadrant.players.delete(playerId);
						}
					}
				}
			}
		}
	}

	/**
	 * Checks for collisions between players and food, and between players
	 * @private
	 */
	private checkCollisions(): void {
		// Optimization: Check collisions only in neighboring quadrants
		const processedPairs = new Set<string>();

		for (const [quadrantId, quadrant] of this.quadrants) {
			const playerIds = Array.from(quadrant.players);

			// Player-food collisions in their quadrant
			for (const playerId of playerIds) {
				const player = this.players.get(playerId);
				if (!player) continue;

				for (const foodId of quadrant.food) {
					const foodItem = this.food.get(foodId);
					if (!foodItem) continue;

					const dx = player.x - foodItem.x;
					const dy = player.y - foodItem.y;
					const distance = Math.sqrt(dx * dx + dy * dy);

					if (distance < player.radius) {
						this.food.delete(foodId);
						quadrant.food.delete(foodId);

						const massGain = foodItem.radius * 2;
						player.mass += massGain;
						player.radius = this.massToRadius(player.mass);
						player.score += Math.round(massGain);
						this.spawnFood();
					}
				}

				// Player-player collisions in the same quadrant
				for (const otherPlayerId of playerIds) {
					if (playerId === otherPlayerId) continue;

					const pairKey = [playerId, otherPlayerId].sort().join("_");
					if (processedPairs.has(pairKey)) continue;

					processedPairs.add(pairKey);

					const otherPlayer = this.players.get(otherPlayerId);
					if (!otherPlayer) continue;

					this.checkPlayerCollision(player, otherPlayer);
				}
			}
		}
	}

	/**
	 * Checks collision between two specific players
	 * @private
	 * @param {Player} player - First player
	 * @param {Player} otherPlayer - Second player
	 */
	private checkPlayerCollision(player: Player, otherPlayer: Player): void {
		const samePlayer =
			(player.parentId &&
				otherPlayer.parentId &&
				player.parentId === otherPlayer.parentId) ||
			player.parentId === otherPlayer.id ||
			otherPlayer.parentId === player.id ||
			player.id === otherPlayer.parentId;

		if (samePlayer) {
			return;
		}

		const dx = player.x - otherPlayer.x;
		const dy = player.y - otherPlayer.y;
		const distance = Math.sqrt(dx * dx + dy * dy);

		if (distance < player.radius + otherPlayer.radius) {
			const canPlayerEatOther = player.mass > otherPlayer.mass * 1.15;
			const canOtherEatPlayer = otherPlayer.mass > player.mass * 1.15;

			if (canPlayerEatOther) {
				this.handlePlayerEaten(otherPlayer, player);
			} else if (canOtherEatPlayer) {
				this.handlePlayerEaten(player, otherPlayer);
			}
		}
	}

	/**
	 * Handles the logic when one player eats another
	 * @private
	 * @param {Player} eaten - The player being eaten
	 * @param {Player} eater - The player doing the eating
	 */
	private handlePlayerEaten(eaten: Player, eater: Player): void {
		const massGain = eaten.mass * 0.8;
		eater.mass += massGain;
		eater.radius = this.massToRadius(eater.mass);
		eater.score += Math.round(massGain);

		if (!eaten.isBot) {
			this.io.to(eaten.id).emit("playerDeath", {
				playerId: eaten.id,
				eatenBy: eater.name,
				finalMass: eaten.mass,
				finalScore: eaten.score,
			});
		}

		// Reset eaten player
		eaten.x = Math.random() * this.WORLD_WIDTH;
		eaten.y = Math.random() * this.WORLD_HEIGHT;
		eaten.mass = this.BASE_MASS;
		eaten.radius = this.BASE_RADIUS;
		eaten.score = 0;

		this.updatePlayerQuadrant(eaten.id);
	}

	/**
	 * Starts the main game loop for updating game state and broadcasting to clients
	 * @private
	 */
	private startGameLoop(): void {
		const targetFrameTime = 1000 / this.UPDATE_RATE;
		const targetBroadcastTime = 1000 / this.BROADCAST_RATE;
		let lastUpdateTime = Date.now();
		let lastBroadcastTime = Date.now();

		const gameLoop = () => {
			const currentTime = Date.now();
			const deltaTime = currentTime - lastUpdateTime;

			// Update game logic
			if (deltaTime >= targetFrameTime) {
				lastUpdateTime = currentTime;

				this.checkCollisions();
				this.checkMerge();
			}

			// Broadcast game state (less frequently)
			if (currentTime - lastBroadcastTime >= targetBroadcastTime) {
				lastBroadcastTime = currentTime;

				const gameState = {
					players: Array.from(this.players.values()).map((p) => ({
						id: p.id,
						x: Math.round(p.x),
						y: Math.round(p.y),
						radius: Math.round(p.radius),
						mass: Math.round(p.mass),
						color: p.color,
						name: p.name,
						isBot: p.isBot,
						parentId: p.parentId,
						score: p.score,
						isControlled: p.isControlled,
					})),
					food: Array.from(this.food.values()).map((f) => ({
						id: f.id,
						x: Math.round(f.x),
						y: Math.round(f.y),
						radius: f.radius,
						color: f.color,
					})),
				};

				// Use volatile for less important updates
				this.io.volatile.emit("gameUpdate", gameState);
			}

			setImmediate(gameLoop);
		};

		gameLoop();
	}
}