export interface Vector2D {
  x: number;
  z: number;
}

export interface PlayerState {
  id: string;
  name: string;
  team: 'blue' | 'red';
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  rotation: number;
  hp: number;
  maxHp: number;
  qStacks: number; // 0, 1, 2 (2 means Q3 tornado ready)
  qCooldown: number;
  wCooldown: number;
  eCooldown: number;
  rCooldown: number;
  eTargetCooldowns: Record<string, number>; // targetId -> remaining ms
  basicAttackCooldown?: number;
  isAirborne: boolean;
  airborneTimeLeft: number;
  airborneHeight: number;
  isDashing: boolean;
  dashDuration: number;
  dashProgress: number;
  dashStart: Vector2D;
  dashEnd: Vector2D;
  isUltActive: boolean;
  isDead: boolean;
}

export interface Projectile {
  id: string;
  ownerId: string;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  speed: number;
  radius: number;
  distanceTraveled: number;
  maxDistance: number;
}

export interface WindWall {
  id: string;
  ownerId: string;
  x: number;
  z: number;
  angle: number; // orientation angle
  width: number;
  duration: number; // ms
  elapsed: number;
}

export interface CombatEvent {
  id: string;
  type: 'hit' | 'airborne' | 'q12_thrust' | 'q3_tornado' | 'w_wall' | 'e_dash' | 'r_ult' | 'blocked';
  sourceId: string;
  targetId?: string;
  damage?: number;
  x?: number;
  z?: number;
  text?: string;
}

export interface GameRoomState {
  roomId: string;
  status: 'waiting' | 'playing' | 'ended';
  players: Record<string, PlayerState>;
  projectiles: Projectile[];
  windwalls: WindWall[];
  winnerId: string | null;
  recentEvents: CombatEvent[];
  isPractice: boolean;
}

export interface LobbyRoomInfo {
  id: string;
  hostName: string;
  playerCount: number;
  status: 'waiting' | 'playing' | 'ended';
  createdAt: number;
}
