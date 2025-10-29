export interface Player {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  name: string;
  mass: number;
}

export interface Food {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
}

export interface PlayerState {
  current: Player;
  target: Player;
  lastUpdate: number;
  interpolationTime: number;
}

export interface GameState {
  ts: number;
  players: Player[];
  food: Food[];
  totalPlayers: number;
}

export interface InitData {
  player: Player;
  worldWidth: number;
  worldHeight: number;
}

export interface DeathData {
  playerId: string;
  eatenBy: string;
}

export interface MoveData {
  x: number;
  y: number;
}