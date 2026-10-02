import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import type { PlayerState, Projectile, WindWall, CombatEvent, GameRoomState, Vector2D } from './src/types/game.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

interface Room {
  id: string;
  status: 'waiting' | 'playing' | 'ended';
  players: Record<string, PlayerState>;
  projectiles: Projectile[];
  windwalls: WindWall[];
  winnerId: string | null;
  recentEvents: CombatEvent[];
  isPractice: boolean;
  dummyTimer: number;
  createdAt: number;
}

const rooms: Record<string, Room> = {};

function getOpenRoomsList() {
  const list = [];
  for (const rid in rooms) {
    const r = rooms[rid];
    if (!r.isPractice && r.status === 'waiting') {
      const host = Object.values(r.players)[0];
      list.push({
        id: rid,
        hostName: host?.name || 'Vô danh',
        playerCount: Object.keys(r.players).length,
        status: r.status,
        createdAt: r.createdAt || Date.now(),
      });
    }
  }
  return list;
}

function broadcastLobbyRooms() {
  io.emit('lobby_rooms', getOpenRoomsList());
}

function checkDeathAndBroadcast(room: Room, target: PlayerState, killerId: string) {
  if (target.hp <= 0) {
    target.hp = 0;
    target.isDead = true;
    room.status = 'ended';
    room.winnerId = killerId;
    io.to(room.id).emit('room_tick', {
      roomId: room.id,
      status: room.status,
      players: room.players,
      projectiles: room.projectiles,
      windwalls: room.windwalls,
      winnerId: room.winnerId,
      recentEvents: room.recentEvents,
    });
  }
}

app.get('/api/rooms', (_req, res) => {
  res.json(getOpenRoomsList());
});

function createDefaultPlayer(id: string, name: string, team: 'blue' | 'red', x: number, z: number): PlayerState {
  return {
    id,
    name,
    team,
    x,
    z,
    targetX: x,
    targetZ: z,
    rotation: team === 'blue' ? 0 : Math.PI,
    hp: 1000,
    maxHp: 1000,
    qStacks: 0,
    qCooldown: 0,
    wCooldown: 0,
    eCooldown: 0,
    rCooldown: 0,
    basicAttackCooldown: 0,
    eTargetCooldowns: {},
    isAirborne: false,
    airborneTimeLeft: 0,
    airborneHeight: 0,
    isDashing: false,
    dashDuration: 0,
    dashProgress: 0,
    dashStart: { x, z },
    dashEnd: { x, z },
    isUltActive: false,
    isDead: false,
  };
}

function distSq(x1: number, z1: number, x2: number, z2: number): number {
  return (x1 - x2) ** 2 + (z1 - z2) ** 2;
}

function distanceToSegment(px: number, pz: number, x1: number, z1: number, x2: number, z2: number): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return Math.sqrt(distSq(px, pz, x1, z1));

  let t = ((px - x1) * dx + (pz - z1) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt(distSq(px, pz, x1 + t * dx, z1 + t * dz));
}

// Tick Game Loop at 30Hz (~33ms)
const TICK_RATE = 30;
const DT = 1 / TICK_RATE;

setInterval(() => {
  const now = Date.now();

  for (const roomId in rooms) {
    const room = rooms[roomId];

    // If room is waiting for opponent, still process movement and broadcast state
    if (room.status === 'waiting') {
      for (const pid in room.players) {
        const p = room.players[pid];
        const dx = p.targetX - p.x;
        const dz = p.targetZ - p.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > 0.1) {
          const moveSpeed = 7.5;
          const step = Math.min(d, moveSpeed * DT);
          p.x += (dx / d) * step;
          p.z += (dz / d) * step;
          p.rotation = Math.atan2(dx, dz);
        }
      }
      io.to(roomId).emit('room_tick', {
        roomId,
        status: room.status,
        players: room.players,
        projectiles: room.projectiles,
        windwalls: room.windwalls,
        winnerId: room.winnerId,
        recentEvents: room.recentEvents,
      });
      continue;
    }

    // If game ended, still broadcast room_tick so clients display Victory/Defeat screen and damage numbers
    if (room.status === 'ended') {
      io.to(roomId).emit('room_tick', {
        roomId,
        status: room.status,
        players: room.players,
        projectiles: room.projectiles,
        windwalls: room.windwalls,
        winnerId: room.winnerId,
        recentEvents: room.recentEvents,
      });

      // In practice mode, auto-revive dummy bot after 2.5 seconds
      if (room.isPractice && room.players['dummy_bot']?.isDead) {
        room.dummyTimer = (room.dummyTimer || 0) + DT;
        if (room.dummyTimer > 2.5) {
          room.dummyTimer = 0;
          const dummy = room.players['dummy_bot'];
          dummy.hp = 1000;
          dummy.isDead = false;
          dummy.x = 9;
          dummy.z = 0;
          dummy.targetX = 9;
          dummy.targetZ = 0;
          room.status = 'playing';
          room.winnerId = null;
          room.recentEvents.push({
            id: `evt-${Date.now()}`,
            type: 'hit',
            sourceId: 'dummy_bot',
            text: 'BÙ NHÌN HỒI SINH!',
          });
        }
      }
      continue;
    }

    if (room.status !== 'playing') continue;

    // 1. Update Players
    for (const pid in room.players) {
      const p = room.players[pid];
      if (p.isDead) continue;

      // Cooldowns
      p.qCooldown = Math.max(0, p.qCooldown - DT * 1000);
      p.wCooldown = Math.max(0, p.wCooldown - DT * 1000);
      p.eCooldown = Math.max(0, p.eCooldown - DT * 1000);
      p.rCooldown = Math.max(0, p.rCooldown - DT * 1000);
      p.basicAttackCooldown = Math.max(0, (p.basicAttackCooldown || 0) - DT * 1000);

      for (const targetId in p.eTargetCooldowns) {
        p.eTargetCooldowns[targetId] = Math.max(0, p.eTargetCooldowns[targetId] - DT * 1000);
      }

      // Ult status
      if (p.isUltActive) {
        p.airborneHeight = 2.5;
      }

      // Airborne logic
      if (p.isAirborne) {
        p.airborneTimeLeft -= DT * 1000;
        if (p.airborneTimeLeft <= 0) {
          p.isAirborne = false;
          p.airborneTimeLeft = 0;
          p.airborneHeight = 0;
          p.isUltActive = false;
        } else {
          // Parabolic height arc
          const progress = 1 - p.airborneTimeLeft / 1200;
          p.airborneHeight = Math.max(0, Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI) * 3.0);
        }
      }

      // Dashing logic (E skill)
      if (p.isDashing) {
        p.dashProgress += (DT * 1000) / p.dashDuration;
        if (p.dashProgress >= 1) {
          p.isDashing = false;
          p.x = p.dashEnd.x;
          p.z = p.dashEnd.z;
          p.targetX = p.x;
          p.targetZ = p.z;
        } else {
          p.x = p.dashStart.x + (p.dashEnd.x - p.dashStart.x) * p.dashProgress;
          p.z = p.dashStart.z + (p.dashEnd.z - p.dashStart.z) * p.dashProgress;
        }
      } else if (!p.isAirborne && !p.isUltActive) {
        // Standard movement
        const dx = p.targetX - p.x;
        const dz = p.targetZ - p.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > 0.1) {
          const moveSpeed = 7.5;
          const step = Math.min(d, moveSpeed * DT);
          p.x += (dx / d) * step;
          p.z += (dz / d) * step;
          p.rotation = Math.atan2(dx, dz);
        }
      }

      // Arena boundary clamp (radius 22)
      const distFromCenter = Math.sqrt(p.x * p.x + p.z * p.z);
      if (distFromCenter > 21) {
        const factor = 21 / distFromCenter;
        p.x *= factor;
        p.z *= factor;
      }
    }

    // 2. Dummy Bot AI in Practice Mode
    if (room.isPractice && room.players['dummy_bot']) {
      const dummy = room.players['dummy_bot'];
      room.dummyTimer = (room.dummyTimer || 0) + DT;
      const realPlayer = Object.values(room.players).find((p) => p.id !== 'dummy_bot');

      if (realPlayer && !dummy.isDead && !dummy.isAirborne) {
        // Dummy gently sidesteps or repositions every 3 seconds
        if (room.dummyTimer > 3.0) {
          room.dummyTimer = 0;
          const randomAngle = Math.random() * Math.PI * 2;
          const randomDist = 2 + Math.random() * 4;
          dummy.targetX = Math.max(-16, Math.min(16, dummy.x + Math.cos(randomAngle) * randomDist));
          dummy.targetZ = Math.max(-16, Math.min(16, dummy.z + Math.sin(randomAngle) * randomDist));
        }
      }
    }

    // 3. Update WindWalls
    for (let i = room.windwalls.length - 1; i >= 0; i--) {
      const wall = room.windwalls[i];
      wall.elapsed += DT * 1000;
      if (wall.elapsed >= wall.duration) {
        room.windwalls.splice(i, 1);
      }
    }

    // 4. Update Projectiles (Q3 Tornado)
    for (let i = room.projectiles.length - 1; i >= 0; i--) {
      const proj = room.projectiles[i];
      const step = proj.speed * DT;
      proj.x += proj.dirX * step;
      proj.z += proj.dirZ * step;
      proj.distanceTraveled += step;

      let destroyed = false;

      // Check collision with opposing WindWalls
      for (const wall of room.windwalls) {
        if (wall.ownerId === proj.ownerId) continue; // Own windwall doesn't block

        const halfW = wall.width / 2;
        const cos = Math.cos(wall.angle);
        const sin = Math.sin(wall.angle);
        const x1 = wall.x - cos * halfW;
        const z1 = wall.z - sin * halfW;
        const x2 = wall.x + cos * halfW;
        const z2 = wall.z + sin * halfW;

        const dist = distanceToSegment(proj.x, proj.z, x1, z1, x2, z2);
        if (dist <= proj.radius + 0.8) {
          destroyed = true;
          room.recentEvents.push({
            id: `evt-${Date.now()}-${Math.random()}`,
            type: 'blocked',
            sourceId: wall.ownerId,
            x: proj.x,
            z: proj.z,
            text: 'BLOCKED!',
          });
          break;
        }
      }

      if (destroyed) {
        room.projectiles.splice(i, 1);
        continue;
      }

      // Check collision with enemy players
      for (const pid in room.players) {
        const target = room.players[pid];
        if (target.id === proj.ownerId || target.isDead) continue;

        const hitDistSq = distSq(proj.x, proj.z, target.x, target.z);
        const hitRadius = proj.radius + 0.9;

        if (hitDistSq <= hitRadius * hitRadius) {
          // Hit! 150 damage + Airborne 1.2s
          target.hp = Math.max(0, target.hp - 150);
          target.isAirborne = true;
          target.airborneTimeLeft = 1200;
          target.isDashing = false;

          room.recentEvents.push({
            id: `evt-${Date.now()}-${Math.random()}`,
            type: 'airborne',
            sourceId: proj.ownerId,
            targetId: target.id,
            damage: 150,
            x: target.x,
            z: target.z,
            text: '-150 HẤT TUNG!',
          });

          checkDeathAndBroadcast(room, target, proj.ownerId);

          destroyed = true;
          break;
        }
      }

      if (destroyed) {
        room.projectiles.splice(i, 1);
        continue;
      }

      // Range check
      if (proj.distanceTraveled >= proj.maxDistance) {
        room.projectiles.splice(i, 1);
      }
    }

    // Keep events trimmed
    if (room.recentEvents.length > 20) {
      room.recentEvents = room.recentEvents.slice(-15);
    }

    // Broadcast room state
    io.to(roomId).emit('room_tick', {
      roomId,
      status: room.status,
      players: room.players,
      projectiles: room.projectiles,
      windwalls: room.windwalls,
      winnerId: room.winnerId,
      recentEvents: room.recentEvents,
    });
  }
}, 1000 / TICK_RATE);

// Socket.io Handlers
io.on('connection', (socket: Socket) => {
  let currentRoomId: string | null = null;
  let currentPlayerId: string | null = null;

  // Send initial list of open rooms to newly connected socket
  socket.emit('lobby_rooms', getOpenRoomsList());

  socket.on('get_lobby_rooms', () => {
    socket.emit('lobby_rooms', getOpenRoomsList());
  });

  socket.on('join_room', ({ roomId, playerName, isPractice, isQuickMatch }: { roomId?: string; playerName?: string; isPractice?: boolean; isQuickMatch?: boolean }) => {
    let finalRoomId = roomId?.trim() || '';

    // If Quick Match (Auto Matchmaking) or empty roomId:
    if (isQuickMatch || (!finalRoomId && !isPractice)) {
      // Find an existing public waiting room
      for (const rid in rooms) {
        const r = rooms[rid];
        if (!r.isPractice && r.status === 'waiting' && Object.keys(r.players).length === 1) {
          finalRoomId = rid;
          break;
        }
      }
      // If no room waiting, create a clean readable room ID
      if (!finalRoomId) {
        finalRoomId = `solo_${Math.floor(1000 + Math.random() * 9000)}`;
      }
    } else if (!finalRoomId) {
      finalRoomId = isPractice ? `practice_${Date.now()}` : `solo_${Math.floor(1000 + Math.random() * 9000)}`;
    }

    // Check if room is already full
    if (rooms[finalRoomId] && !rooms[finalRoomId].players[socket.id]) {
      const activePlayers = Object.keys(rooms[finalRoomId].players);
      if (activePlayers.length >= 2) {
        socket.emit('room_error', { message: 'Phòng đã đủ 2 người chơi! Vui lòng chọn hoặc tạo phòng khác.' });
        return;
      }
    }

    // Leave previous room if currently in one
    if (currentRoomId && currentRoomId !== finalRoomId && rooms[currentRoomId]) {
      const oldRoom = rooms[currentRoomId];
      delete oldRoom.players[socket.id];
      socket.leave(currentRoomId);
      if (Object.keys(oldRoom.players).length === 0 || (oldRoom.isPractice && Object.keys(oldRoom.players).length <= 1)) {
        delete rooms[currentRoomId];
      } else {
        oldRoom.status = 'waiting';
        io.to(currentRoomId).emit('room_updated', {
          roomId: currentRoomId,
          status: oldRoom.status,
          players: oldRoom.players,
          isPractice: oldRoom.isPractice,
        });
      }
    }

    currentRoomId = finalRoomId;
    currentPlayerId = socket.id;

    if (!rooms[finalRoomId]) {
      rooms[finalRoomId] = {
        id: finalRoomId,
        status: isPractice ? 'playing' : 'waiting',
        players: {},
        projectiles: [],
        windwalls: [],
        winnerId: null,
        recentEvents: [],
        isPractice: !!isPractice,
        dummyTimer: 0,
        createdAt: Date.now(),
      };
    }

    const room = rooms[finalRoomId];
    socket.join(finalRoomId);

    const playerCount = Object.keys(room.players).length;
    const team: 'blue' | 'red' = playerCount === 0 ? 'blue' : 'red';
    const spawnX = team === 'blue' ? -9 : 9;

    room.players[socket.id] = createDefaultPlayer(
      socket.id,
      playerName || (team === 'blue' ? 'Yasuo (Xanh)' : 'Yasuo (Đỏ)'),
      team,
      spawnX,
      0
    );

    // If Practice mode, spawn dummy opponent immediately
    if (isPractice && !room.players['dummy_bot']) {
      room.players['dummy_bot'] = createDefaultPlayer('dummy_bot', 'Bù Nhìn Luyện Tập', 'red', 9, 0);
      room.status = 'playing';
    } else if (Object.keys(room.players).length >= 2) {
      room.status = 'playing';
    }

    const initialRoomState = {
      roomId: finalRoomId,
      status: room.status,
      players: room.players,
      projectiles: room.projectiles,
      windwalls: room.windwalls,
      winnerId: room.winnerId,
      recentEvents: room.recentEvents,
      isPractice: room.isPractice,
    };

    socket.emit('joined_room', {
      roomId: finalRoomId,
      playerId: socket.id,
      team,
      isPractice: room.isPractice,
      roomState: initialRoomState,
    });

    io.to(finalRoomId).emit('room_tick', initialRoomState);

    io.to(finalRoomId).emit('room_updated', {
      roomId: finalRoomId,
      status: room.status,
      players: room.players,
      isPractice: room.isPractice,
    });

    // Notify all lobby clients of open room list changes
    broadcastLobbyRooms();
  });

  socket.on('leave_room', () => {
    if (currentRoomId && currentPlayerId && rooms[currentRoomId]) {
      const room = rooms[currentRoomId];
      delete room.players[currentPlayerId];
      socket.leave(currentRoomId);

      if (Object.keys(room.players).length === 0 || (room.isPractice && Object.keys(room.players).length <= 1)) {
        delete rooms[currentRoomId];
      } else {
        room.status = 'waiting';
        io.to(currentRoomId).emit('room_updated', {
          roomId: currentRoomId,
          status: room.status,
          players: room.players,
          isPractice: room.isPractice,
        });
      }
      currentRoomId = null;
      broadcastLobbyRooms();
    }
  });

  socket.on('move_to', ({ targetX, targetZ }: { targetX: number; targetZ: number }) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms[currentRoomId];
    if (!room || (room.status !== 'playing' && room.status !== 'waiting')) return;
    const player = room.players[currentPlayerId];
    if (!player || player.isDead || player.isAirborne || player.isDashing || player.isUltActive) return;

    player.targetX = Math.max(-21, Math.min(21, targetX));
    player.targetZ = Math.max(-21, Math.min(21, targetZ));
  });

  socket.on('cast_q', ({ dirX, dirZ }: { dirX: number; dirZ: number }) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms[currentRoomId];
    if (!room || room.status !== 'playing') return;
    const player = room.players[currentPlayerId];
    if (!player || player.isDead || player.isAirborne || player.isDashing || player.isUltActive) return;
    if (player.qCooldown > 0) return;

    const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
    const nx = len > 0.001 ? dirX / len : 1;
    const nz = len > 0.001 ? dirZ / len : 0;
    player.rotation = Math.atan2(nx, nz);

    if (player.qStacks < 2) {
      // Q1 or Q2 Thrust
      player.qCooldown = 1200; // 1.2s
      const thrustRange = 4.8;
      const thrustWidth = 1.3;

      let hitAny = false;
      for (const pid in room.players) {
        const opp = room.players[pid];
        if (opp.id === player.id || opp.isDead) continue;

        const toOppX = opp.x - player.x;
        const toOppZ = opp.z - player.z;
        const dot = toOppX * nx + toOppZ * nz;
        const perp = Math.abs(-nz * toOppX + nx * toOppZ);

        if (dot >= 0 && dot <= thrustRange && perp <= thrustWidth) {
          hitAny = true;
          opp.hp = Math.max(0, opp.hp - 80);
          room.recentEvents.push({
            id: `evt-${Date.now()}-${Math.random()}`,
            type: 'hit',
            sourceId: player.id,
            targetId: opp.id,
            damage: 80,
            x: opp.x,
            z: opp.z,
            text: '-80 SÁT THƯƠNG!',
          });

          checkDeathAndBroadcast(room, opp, player.id);
        }
      }

      if (hitAny) {
        player.qStacks = Math.min(2, player.qStacks + 1);
      }

      io.to(currentRoomId).emit('skill_fired', {
        type: 'q12_thrust',
        ownerId: player.id,
        x: player.x,
        z: player.z,
        dirX: nx,
        dirZ: nz,
        range: thrustRange,
        stacks: player.qStacks,
      });
    } else {
      // Q3 Hasagi Tornado
      player.qStacks = 0;
      player.qCooldown = 1400; // 1.4s

      const proj: Projectile = {
        id: `proj-${Date.now()}-${Math.random()}`,
        ownerId: player.id,
        x: player.x + nx * 1.0,
        z: player.z + nz * 1.0,
        dirX: nx,
        dirZ: nz,
        speed: 13.0,
        radius: 1.1,
        distanceTraveled: 0,
        maxDistance: 19.0,
      };

      room.projectiles.push(proj);

      io.to(currentRoomId).emit('skill_fired', {
        type: 'q3_tornado',
        ownerId: player.id,
        x: proj.x,
        z: proj.z,
        dirX: nx,
        dirZ: nz,
      });
    }
  });

  socket.on('cast_w', ({ dirX, dirZ }: { dirX: number; dirZ: number }) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms[currentRoomId];
    if (!room || room.status !== 'playing') return;
    const player = room.players[currentPlayerId];
    if (!player || player.isDead || player.isAirborne || player.isDashing || player.isUltActive) return;
    if (player.wCooldown > 0) return;

    const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
    const nx = len > 0.001 ? dirX / len : 1;
    const nz = len > 0.001 ? dirZ / len : 0;

    player.wCooldown = 10000; // 10s cooldown
    const wallDist = 2.4;
    const wallX = player.x + nx * wallDist;
    const wallZ = player.z + nz * wallDist;
    const wallAngle = Math.atan2(nz, nx) + Math.PI / 2;

    const wall: WindWall = {
      id: `wall-${Date.now()}-${Math.random()}`,
      ownerId: player.id,
      x: wallX,
      z: wallZ,
      angle: wallAngle,
      width: 7.2,
      duration: 3500,
      elapsed: 0,
    };

    room.windwalls.push(wall);

    io.to(currentRoomId).emit('skill_fired', {
      type: 'w_wall',
      ownerId: player.id,
      wall,
    });
  });

  socket.on('cast_e', ({ targetId }: { targetId?: string }) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms[currentRoomId];
    if (!room || room.status !== 'playing') return;
    const player = room.players[currentPlayerId];
    if (!player || player.isDead || player.isAirborne || player.isDashing || player.isUltActive) return;
    if (player.eCooldown > 0) return;

    // Find closest opponent or specified target
    let target = targetId ? room.players[targetId] : null;
    if (!target) {
      for (const pid in room.players) {
        if (pid !== player.id && !room.players[pid].isDead) {
          target = room.players[pid];
          break;
        }
      }
    }

    if (!target || target.isDead) return;

    const dSq = distSq(player.x, player.z, target.x, target.z);
    const maxRange = 9.0;
    if (dSq > maxRange * maxRange) return;

    // Check target specific cooldown (6 seconds)
    if (player.eTargetCooldowns[target.id] && player.eTargetCooldowns[target.id] > 0) return;

    // Dash past target
    const dx = target.x - player.x;
    const dz = target.z - player.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    const nx = len > 0.001 ? dx / len : 1;
    const nz = len > 0.001 ? dz / len : 0;

    const dashPastDist = 3.2;
    let endX = target.x + nx * dashPastDist;
    let endZ = target.z + nz * dashPastDist;

    // Clamp inside arena
    const endDistFromCenter = Math.sqrt(endX * endX + endZ * endZ);
    if (endDistFromCenter > 21) {
      const factor = 21 / endDistFromCenter;
      endX *= factor;
      endZ *= factor;
    }

    player.isDashing = true;
    player.dashDuration = 220; // 0.22s fast dash
    player.dashProgress = 0;
    player.dashStart = { x: player.x, z: player.z };
    player.dashEnd = { x: endX, z: endZ };
    player.rotation = Math.atan2(nx, nz);
    player.eCooldown = 400; // 0.4s between dashes
    player.eTargetCooldowns[target.id] = 6000; // 6s per target

    // Deal 60 damage
    target.hp = Math.max(0, target.hp - 60);
    room.recentEvents.push({
      id: `evt-${Date.now()}-${Math.random()}`,
      type: 'e_dash',
      sourceId: player.id,
      targetId: target.id,
      damage: 60,
      x: target.x,
      z: target.z,
      text: '-60 QUÉT KIẾM!',
    });

    checkDeathAndBroadcast(room, target, player.id);

    io.to(currentRoomId).emit('skill_fired', {
      type: 'e_dash',
      ownerId: player.id,
      targetId: target.id,
      start: player.dashStart,
      end: player.dashEnd,
    });
  });

  socket.on('cast_r', () => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms[currentRoomId];
    if (!room || room.status !== 'playing') return;
    const player = room.players[currentPlayerId];
    if (!player || player.isDead || player.isAirborne || player.isDashing || player.isUltActive) return;
    if (player.rCooldown > 0) return;

    // Check if any opponent is Airborne
    let airborneOpponent: PlayerState | null = null;
    for (const pid in room.players) {
      const opp = room.players[pid];
      if (opp.id !== player.id && !opp.isDead && opp.isAirborne) {
        const dSq = distSq(player.x, player.z, opp.x, opp.z);
        if (dSq <= 16 * 16) {
          airborneOpponent = opp;
          break;
        }
      }
    }

    if (!airborneOpponent) return;

    // Trigger Last Breath!
    player.rCooldown = 22000; // 22s cooldown
    player.isUltActive = true;
    player.isDashing = false;

    // Teleport close to opponent in the air
    player.x = airborneOpponent.x + 1.0;
    player.z = airborneOpponent.z;
    player.targetX = player.x;
    player.targetZ = player.z;

    // Suspend both in air for an extra 1.0s
    airborneOpponent.isAirborne = true;
    airborneOpponent.airborneTimeLeft = 1000;
    airborneOpponent.airborneHeight = 2.8;

    player.isAirborne = true;
    player.airborneTimeLeft = 1000;
    player.airborneHeight = 2.8;

    // Deal 250 damage
    airborneOpponent.hp = Math.max(0, airborneOpponent.hp - 250);

    room.recentEvents.push({
      id: `evt-${Date.now()}-${Math.random()}`,
      type: 'r_ult',
      sourceId: player.id,
      targetId: airborneOpponent.id,
      damage: 250,
      x: airborneOpponent.x,
      z: airborneOpponent.z,
      text: '-250 TRĂN TRỐI!',
    });

    checkDeathAndBroadcast(room, airborneOpponent, player.id);

    io.to(currentRoomId).emit('skill_fired', {
      type: 'r_ult',
      ownerId: player.id,
      targetId: airborneOpponent.id,
      x: airborneOpponent.x,
      z: airborneOpponent.z,
    });
  });

  socket.on('basic_attack', ({ targetId }: { targetId?: string }) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms[currentRoomId];
    if (!room || room.status !== 'playing') return;
    const player = room.players[currentPlayerId];
    if (!player || player.isDead || player.isAirborne || player.isDashing || player.isUltActive) return;

    let target = targetId ? room.players[targetId] : null;
    if (!target) {
      for (const pid in room.players) {
        if (pid !== player.id && !room.players[pid].isDead) {
          target = room.players[pid];
          break;
        }
      }
    }

    if (!target || target.isDead) return;

    const dSq = distSq(player.x, player.z, target.x, target.z);
    if (dSq > 2.6 * 2.6) {
      // If within 6.5 units, approach target automatically like attack-move in MOBA
      if (dSq <= 6.5 * 6.5) {
        player.targetX = target.x;
        player.targetZ = target.z;
      }
      return;
    }

    // Cooldown check for attack speed (0.55s)
    if ((player.basicAttackCooldown || 0) > 0) return;
    player.basicAttackCooldown = 550;

    // Face target
    player.rotation = Math.atan2(target.x - player.x, target.z - player.z);

    target.hp = Math.max(0, target.hp - 50);
    room.recentEvents.push({
      id: `evt-${Date.now()}-${Math.random()}`,
      type: 'hit',
      sourceId: player.id,
      targetId: target.id,
      damage: 50,
      x: target.x,
      z: target.z,
      text: '-50 ĐÁNH THƯỜNG (A)',
    });

    io.to(currentRoomId).emit('skill_fired', {
      type: 'basic_attack',
      ownerId: player.id,
      targetId: target.id,
      x: target.x,
      z: target.z,
    });

    checkDeathAndBroadcast(room, target, player.id);
  });

  socket.on('restart_game', () => {
    if (!currentRoomId) return;
    const room = rooms[currentRoomId];
    if (!room) return;

    room.projectiles = [];
    room.windwalls = [];
    room.winnerId = null;
    room.status = 'playing';

    const pids = Object.keys(room.players);
    if (pids.length > 0) {
      const p1 = room.players[pids[0]];
      p1.hp = 1000;
      p1.x = -9;
      p1.z = 0;
      p1.targetX = -9;
      p1.targetZ = 0;
      p1.qStacks = 0;
      p1.qCooldown = 0;
      p1.wCooldown = 0;
      p1.eCooldown = 0;
      p1.rCooldown = 0;
      p1.isDead = false;
      p1.isAirborne = false;
      p1.isDashing = false;
      p1.isUltActive = false;
      p1.eTargetCooldowns = {};
    }
    if (pids.length > 1) {
      const p2 = room.players[pids[1]];
      p2.hp = 1000;
      p2.x = 9;
      p2.z = 0;
      p2.targetX = 9;
      p2.targetZ = 0;
      p2.qStacks = 0;
      p2.qCooldown = 0;
      p2.wCooldown = 0;
      p2.eCooldown = 0;
      p2.rCooldown = 0;
      p2.isDead = false;
      p2.isAirborne = false;
      p2.isDashing = false;
      p2.isUltActive = false;
      p2.eTargetCooldowns = {};
    }

    const restartTick = {
      roomId: currentRoomId,
      status: room.status,
      players: room.players,
      projectiles: room.projectiles,
      windwalls: room.windwalls,
      winnerId: null,
      recentEvents: [],
      isPractice: room.isPractice,
    };

    io.to(currentRoomId).emit('room_tick', restartTick);

    io.to(currentRoomId).emit('game_restarted', {
      players: room.players,
      status: room.status,
    });
  });

  socket.on('disconnect', () => {
    if (currentRoomId && currentPlayerId && rooms[currentRoomId]) {
      const room = rooms[currentRoomId];
      delete room.players[currentPlayerId];

      if (Object.keys(room.players).length === 0 || (room.isPractice && Object.keys(room.players).length <= 1)) {
        delete rooms[currentRoomId];
      } else {
        room.status = 'waiting';
        io.to(currentRoomId).emit('room_updated', {
          roomId: currentRoomId,
          status: room.status,
          players: room.players,
          isPractice: room.isPractice,
        });
      }
      broadcastLobbyRooms();
    }
  });
});

// Middleware configuration
async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer();
