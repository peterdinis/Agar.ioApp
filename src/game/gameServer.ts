import { Server, Socket } from 'socket.io';

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
  behavior: 'hunter' | 'prey' | 'neutral';
  aggression: number;
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
  private players: Map<string, Player> = new Map();
  private food: Map<string, Food> = new Map();
  private readonly WORLD_WIDTH = 5000;
  private readonly WORLD_HEIGHT = 5000;
  private readonly FOOD_COUNT = 800;
  private readonly MIN_FOOD_RADIUS = 5;
  private readonly MAX_FOOD_RADIUS = 8;
  private readonly BOT_COUNT = 15;
  private readonly BASE_RADIUS = 20;
  private lastUpdateTime = Date.now();
  private botNames = [
    'BotMaster', 'ProBot', 'CellDestroyer', 'MegaEater', 'SpeedDemon',
    'TinyTerror', 'GiantSlayer', 'QuickSilver', 'CellHunter', 'BlobKing',
    'NanoBot', 'CircleChamp', 'PelletPro', 'MassMonster', 'AgileBot',
    'PowerCell', 'SwiftSphere', 'DotMaster', 'OrbWarrior', 'CellSensei'
  ];

  constructor(io: Server) {
    this.io = io;
    this.initializeFood();
    this.spawnBots();
    this.setupSocketHandlers();
    this.startGameLoop();
  }

  private initializeFood(): void {
    for (let i = 0; i < this.FOOD_COUNT; i++) {
      this.spawnFood();
    }
  }

  private spawnFood(): void {
    const food: Food = {
      id: `food_${Date.now()}_${Math.random()}`,
      x: Math.random() * this.WORLD_WIDTH,
      y: Math.random() * this.WORLD_HEIGHT,
      radius: this.MIN_FOOD_RADIUS + Math.random() * (this.MAX_FOOD_RADIUS - this.MIN_FOOD_RADIUS),
      color: this.getRandomColor(),
    };
    this.food.set(food.id, food);
  }

  private spawnBots(): void {
    for (let i = 0; i < this.BOT_COUNT; i++) {
      const botId = `bot_${i}_${Date.now()}`;
      const aggression = Math.random();
      const bot: Player = {
        id: botId,
        x: Math.random() * this.WORLD_WIDTH,
        y: Math.random() * this.WORLD_HEIGHT,
        radius: this.BASE_RADIUS,
        mass: this.BASE_RADIUS,
        color: this.getRandomColor(),
        name: this.botNames[i % this.botNames.length],
        isBot: true,
        targetX: Math.random() * this.WORLD_WIDTH,
        targetY: Math.random() * this.WORLD_HEIGHT,
        lastTargetChange: Date.now(),
        behavior: aggression > 0.7 ? 'hunter' : aggression > 0.3 ? 'neutral' : 'prey',
        aggression: aggression,
      };
      this.players.set(botId, bot);
    }
  }

  private updateBots(deltaTime: number): void {
    const currentTime = Date.now();
    
    for (const [id, bot] of this.players) {
      if (!bot.isBot) continue;

      // Zmena správania podľa veľkosti
      this.updateBotBehavior(bot);

      // Nájdi cieľ
      let target = this.findBestTarget(bot);
      
      if (target) {
        bot.targetX = target.x;
        bot.targetY = target.y;
      } else if (
        !bot.targetX || 
        !bot.targetY || 
        currentTime - (bot.lastTargetChange || 0) > 3000 ||
        this.distance(bot.x, bot.y, bot.targetX!, bot.targetY!) < 50
      ) {
        // Náhodný cieľ ak žiadny dobrý cieľ neexistuje
        bot.targetX = Math.random() * this.WORLD_WIDTH;
        bot.targetY = Math.random() * this.WORLD_HEIGHT;
        bot.lastTargetChange = currentTime;
      }

      // Pohyb k cieľu
      this.moveBotTowardsTarget(bot, deltaTime);

      // Útek pred väčšími hráčmi
      this.avoidBiggerPlayers(bot);
    }
  }

  private updateBotBehavior(bot: Player): void {
    if (bot.mass > 100) {
      bot.behavior = 'hunter';
      bot.aggression = Math.min(1, bot.aggression + 0.1);
    } else if (bot.mass < 30) {
      bot.behavior = 'prey';
    }
  }

  private findBestTarget(bot: Player): { x: number; y: number; priority: number } | null {
    let bestTarget: { x: number; y: number; priority: number } | null = null;
    let currentPriority = 0; // Začneme s prioritou 0

    // Hľadaj menších hráčov (najvyššia priorita pre hunter botov)
    for (const [otherId, player] of this.players) {
      if (otherId === bot.id) continue;
      
      const dist = this.distance(bot.x, bot.y, player.x, player.y);
      const massRatio = player.mass / bot.mass;

      let priority = 0;
      
      if (massRatio < 0.8 && dist < 600) {
        // Menší hráč - veľká priorita
        priority = 100 - (dist / 10) + (0.8 - massRatio) * 50;
        
        if (bot.behavior === 'hunter') priority += 50;
        if (player.isBot) priority -= 20; // Menej agresívne k botom
      } else if (massRatio > 1.2 && dist < 400) {
        // Väčší hráč - nízka priorita (útek)
        priority = 10;
      }

      if (priority > currentPriority && priority > 30) {
        bestTarget = { x: player.x, y: player.y, priority };
        currentPriority = priority; // Aktualizuj currentPriority
      }
    }

    // Hľadaj jedlo (stredná priorita)
    if (!bestTarget || currentPriority < 80) {
      for (const [_, food] of this.food) {
        const dist = this.distance(bot.x, bot.y, food.x, food.y);
        
        if (dist < 400) {
          const priority = 70 - (dist / 10) + (food.radius / 2);
          
          if (priority > currentPriority) {
            bestTarget = { x: food.x, y: food.y, priority };
            currentPriority = priority;
          }
        }
      }
    }

    return bestTarget;
  }

  private moveBotTowardsTarget(bot: Player, deltaTime: number): void {
    if (!bot.targetX || !bot.targetY) return;

    const dx = bot.targetX - bot.x;
    const dy = bot.targetY - bot.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 10) {
      // Rýchlosť závisí od veľkosti a správania
      let baseSpeed = Math.max(2, 10 - bot.mass / 40);
      if (bot.behavior === 'hunter') baseSpeed *= 1.2;
      if (bot.behavior === 'prey') baseSpeed *= 0.9;

      const speed = baseSpeed * (deltaTime / 16.67);
      const moveX = (dx / distance) * speed;
      const moveY = (dy / distance) * speed;

      bot.x += moveX;
      bot.y += moveY;

      // Hranice sveta
      bot.x = Math.max(bot.radius, Math.min(this.WORLD_WIDTH - bot.radius, bot.x));
      bot.y = Math.max(bot.radius, Math.min(this.WORLD_HEIGHT - bot.radius, bot.y));
    }
  }

  private avoidBiggerPlayers(bot: Player): void {
    for (const [otherId, player] of this.players) {
      if (otherId === bot.id) continue;
      
      if (player.mass > bot.mass * 1.15) {
        const distX = bot.x - player.x;
        const distY = bot.y - player.y;
        const dist = Math.sqrt(distX * distX + distY * distY);
        
        // Útek ak je nebezpečenstvo blízko
        if (dist < 300) {
          const escapeDistance = 400;
          const escapeX = bot.x + (distX / dist) * escapeDistance;
          const escapeY = bot.y + (distY / dist) * escapeDistance;
          
          bot.targetX = Math.max(bot.radius, Math.min(this.WORLD_WIDTH - bot.radius, escapeX));
          bot.targetY = Math.max(bot.radius, Math.min(this.WORLD_HEIGHT - bot.radius, escapeY));
          bot.lastTargetChange = Date.now();
          break;
        }
      }
    }
  }

  private distance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  }

  private getRandomColor(): string {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
      '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788',
      '#E74C3C', '#3498DB', '#2ECC71', '#F39C12', '#9B59B6',
      '#1ABC9C', '#E67E22', '#95A5A6', '#34495E', '#16A085'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  private massToRadius(mass: number): number {
    return Math.sqrt(mass) * 2;
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      console.log(`Player connected: ${socket.id}`);

      socket.on('join', (name: string) => {
        const player: Player = {
          id: socket.id,
          x: Math.random() * this.WORLD_WIDTH,
          y: Math.random() * this.WORLD_HEIGHT,
          radius: this.BASE_RADIUS,
          mass: this.BASE_RADIUS,
          color: this.getRandomColor(),
          name: name || 'Anonymous',
          isBot: false,
          behavior: 'neutral',
          aggression: 0.5,
        };
        this.players.set(socket.id, player);

        socket.emit('init', {
          player,
          worldWidth: this.WORLD_WIDTH,
          worldHeight: this.WORLD_HEIGHT,
        });

        console.log(`Player ${name} joined. Total players: ${this.players.size}`);
      });

      socket.on('move', (data: { x: number; y: number }) => {
        const player = this.players.get(socket.id);
        if (!player || player.isBot) return;

        const dx = data.x - player.x;
        const dy = data.y - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 0) {
          const speed = Math.max(3, 12 - player.mass / 40);
          const moveDistance = Math.min(speed, distance);
          player.x += (dx / distance) * moveDistance;
          player.y += (dy / distance) * moveDistance;

          player.x = Math.max(player.radius, Math.min(this.WORLD_WIDTH - player.radius, player.x));
          player.y = Math.max(player.radius, Math.min(this.WORLD_HEIGHT - player.radius, player.y));
        }
      });

      socket.on('disconnect', () => {
        const player = this.players.get(socket.id);
        if (player && !player.isBot) {
          this.players.delete(socket.id);
          console.log(`Player disconnected: ${socket.id}. Total players: ${this.players.size}`);
        }
      });
    });
  }

  private checkCollisions(): void {
    // Skontroluj všetky kolízie medzi hráčmi
    const playersArray = Array.from(this.players.entries());
    
    for (let i = 0; i < playersArray.length; i++) {
      const [playerId, player] = playersArray[i];
      
      // Player-food kolízie
      for (const [foodId, foodItem] of this.food) {
        const dx = player.x - foodItem.x;
        const dy = player.y - foodItem.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < player.radius) {
          this.food.delete(foodId);
          player.mass += foodItem.radius * 0.5;
          player.radius = this.massToRadius(player.mass);
          this.spawnFood();
        }
      }

      // Player-player kolízie
      for (let j = i + 1; j < playersArray.length; j++) {
        const [otherPlayerId, otherPlayer] = playersArray[j];
        
        const dx = player.x - otherPlayer.x;
        const dy = player.y - otherPlayer.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Kolízia nastane ak je vzdialenosť menšia ako súčet polomerov
        if (distance < player.radius + otherPlayer.radius) {
          // Zisti kto koho môže zjesť
          const canPlayerEatOther = player.mass > otherPlayer.mass * 1.15;
          const canOtherEatPlayer = otherPlayer.mass > player.mass * 1.15;

          if (canPlayerEatOther) {
            // Hráč zje druhého
            player.mass += otherPlayer.mass * 0.8;
            player.radius = this.massToRadius(player.mass);
            
            // Notify about death
            if (!otherPlayer.isBot) {
              this.io.to(otherPlayerId).emit('playerDeath', {
                playerId: otherPlayerId,
                eatenBy: player.name,
                finalMass: otherPlayer.mass
              });
            }

            // Respawn
            otherPlayer.x = Math.random() * this.WORLD_WIDTH;
            otherPlayer.y = Math.random() * this.WORLD_HEIGHT;
            otherPlayer.mass = this.BASE_RADIUS;
            otherPlayer.radius = this.BASE_RADIUS;

          } else if (canOtherEatPlayer) {
            // Druhý hráč zje tohto
            otherPlayer.mass += player.mass * 0.8;
            otherPlayer.radius = this.massToRadius(otherPlayer.mass);
            
            // Notify about death
            if (!player.isBot) {
              this.io.to(playerId).emit('playerDeath', {
                playerId: playerId,
                eatenBy: otherPlayer.name,
                finalMass: player.mass
              });
            }

            // Respawn
            player.x = Math.random() * this.WORLD_WIDTH;
            player.y = Math.random() * this.WORLD_HEIGHT;
            player.mass = this.BASE_RADIUS;
            player.radius = this.BASE_RADIUS;
          }
        }
      }
    }
  }

  private startGameLoop(): void {
    const targetFPS = 60;
    const targetFrameTime = 1000 / targetFPS;
    let lastTime = Date.now();

    const gameLoop = () => {
      const currentTime = Date.now();
      const deltaTime = currentTime - lastTime;
      lastTime = currentTime;

      this.updateBots(deltaTime);
      this.checkCollisions();

      // Optimalizované odosielanie len zmien
      const gameState = {
        players: Array.from(this.players.values()).map(p => ({
          id: p.id,
          x: Math.round(p.x),
          y: Math.round(p.y),
          radius: Math.round(p.radius),
          mass: Math.round(p.mass),
          color: p.color,
          name: p.name,
          isBot: p.isBot,
        })),
        food: Array.from(this.food.values()).map(f => ({
          id: f.id,
          x: Math.round(f.x),
          y: Math.round(f.y),
          radius: f.radius,
          color: f.color,
        })),
      };

      this.io.volatile.emit('update', gameState);

      const processingTime = Date.now() - currentTime;
      const waitTime = Math.max(0, targetFrameTime - processingTime);
      
      setTimeout(gameLoop, waitTime);
    };

    gameLoop();
  }
}