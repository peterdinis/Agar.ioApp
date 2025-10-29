export interface HandlebarsContext {
  [key: string]: string | number | boolean | object | null | undefined;
}

export interface Food {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  mass: number;
}

export interface GameState {
  ts: number;
  players: Player[];
  food: Food[];
  totalPlayers: number;
}


export interface MoveData {
  x: number;
  y: number;
}

export interface DeathData {
  playerId: string;
  eatenBy: string;
  finalMass: number;
}

export interface InitData {
  player: Player;
  worldWidth: number;
  worldHeight: number;
}

export interface Player {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  name: string;
  mass: number;
  speed: number;
}