import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { io, Socket } from 'socket.io-client';
import { Game2DRenderer } from './game/canvas2DRenderer.js';
import { Game3DRenderer } from './game/threeRenderer.js';
import type { GameRoomState, PlayerState, Projectile, WindWall, CombatEvent, LobbyRoomInfo } from './types/game.js';
import { sound } from './utils/audio.js';
import {
  Volume2,
  VolumeX,
  Swords,
  Shield,
  Wind,
  Zap,
  RotateCcw,
  Users,
  Bot,
  Copy,
  Check,
  Sparkles,
  Info,
  Layers,
  Activity,
  Play,
  PlusCircle,
  LogIn,
  AlertCircle,
  RefreshCw,
  ArrowRight
} from 'lucide-react';

interface CommonRenderer {
  setMyPlayerId: (id: string) => void;
  updateGameState: (
    players: Record<string, PlayerState>,
    projectiles: Projectile[],
    windwalls: WindWall[],
    recentEvents: CombatEvent[]
  ) => void;
  spawnSkillEffect: (data: {
    type: string;
    ownerId: string;
    x?: number;
    z?: number;
    dirX?: number;
    dirZ?: number;
    range?: number;
    start?: { x: number; z: number };
    end?: { x: number; z: number };
  }) => void;
  dispose: () => void;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CommonRenderer | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const hoverPointRef = useRef<{ x: number; z: number }>({ x: 0, z: 0 });

  // Lobby & Connection State
  const [roomId, setRoomId] = useState('');
  const [inputRoomId, setInputRoomId] = useState('');
  const [playerName, setPlayerName] = useState('Yasuo Lãng Khách');
  const [isInRoom, setIsInRoom] = useState(false);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [renderMode, setRenderMode] = useState<'2d' | '3d'>('2d');
  const [openRooms, setOpenRooms] = useState<LobbyRoomInfo[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  // Game Room Snapshot
  const [roomState, setRoomState] = useState<GameRoomState | null>(null);

  // Read URL query for room invite
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setInputRoomId(roomParam);
    }
  }, []);

  // Initialize Socket.io connection on app mount
  useEffect(() => {
    const socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnecting(false);
      socket.emit('get_lobby_rooms');
    });

    socket.on('lobby_rooms', (rooms: LobbyRoomInfo[]) => {
      setOpenRooms(rooms);
    });

    socket.on('joined_room', (data: { roomId: string; playerId: string; team: 'blue' | 'red'; isPractice: boolean; roomState?: GameRoomState }) => {
      setMyPlayerId(data.playerId);
      setRoomId(data.roomId);
      setIsInRoom(true);
      if (data.roomState) {
        setRoomState(data.roomState);
      }
      setErrorMessage('');

      if (rendererRef.current) {
        rendererRef.current.setMyPlayerId(data.playerId);
      }
    });

    socket.on('room_error', (data: { message: string }) => {
      setErrorMessage(data.message);
      setTimeout(() => setErrorMessage(''), 5000);
    });

    socket.on('room_tick', (data: GameRoomState) => {
      setRoomState(data);
      if (rendererRef.current) {
        rendererRef.current.updateGameState(
          data.players,
          data.projectiles,
          data.windwalls,
          data.recentEvents
        );
      }
    });

    socket.on('skill_fired', (data: Parameters<CommonRenderer['spawnSkillEffect']>[0]) => {
      if (rendererRef.current) {
        rendererRef.current.spawnSkillEffect(data);
      }
    });

    socket.on('game_restarted', (data: { players: Record<string, PlayerState>; status: 'waiting' | 'playing' | 'ended' }) => {
      setRoomState((prev) => (prev ? { ...prev, players: data.players, status: data.status, winnerId: null } : null));
    });

    // Also fetch rooms via API initially
    fetch('/api/rooms')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setOpenRooms(data);
      })
      .catch(() => {});

    return () => {
      socket.disconnect();
    };
  }, []);

  // Join Room Actions
  const joinGame = ({
    targetRoom,
    isPractice = false,
    isQuickMatch = false,
  }: {
    targetRoom?: string;
    isPractice?: boolean;
    isQuickMatch?: boolean;
  }) => {
    const socket = socketRef.current;
    if (!socket) return;
    if (!socket.connected) {
      socket.connect();
    }

    setErrorMessage('');
    socket.emit('join_room', {
      roomId: targetRoom,
      playerName: playerName.trim() || 'Yasuo',
      isPractice,
      isQuickMatch,
    });
  };

  // Quick Matchmaking
  const handleQuickMatch = () => {
    joinGame({ isQuickMatch: true });
  };

  // Create New Explicit Room
  const handleCreateNewRoom = () => {
    const newCode = `solo_${Math.floor(1000 + Math.random() * 9000)}`;
    joinGame({ targetRoom: newCode });
  };

  // Join With Room Code Input
  const handleJoinByCode = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const code = inputRoomId.trim();
    if (!code) {
      setErrorMessage('Vui lòng nhập mã phòng hợp lệ!');
      setTimeout(() => setErrorMessage(''), 3000);
      return;
    }
    joinGame({ targetRoom: code });
  };

  // Setup Renderer on Canvas Mount or Mode Change
  useEffect(() => {
    if (!isInRoom || !canvasRef.current) return;

    if (rendererRef.current) {
      rendererRef.current.dispose();
      rendererRef.current = null;
    }

    const options = {
      canvas: canvasRef.current,
      onFloorClick: (point: { x: number; z: number }, isRightClick: boolean) => {
        if (!socketRef.current) return;
        if (isRightClick) {
          socketRef.current.emit('move_to', { targetX: point.x, targetZ: point.z });
        }
      },
      onTargetClick: (targetId: string) => {
        if (!socketRef.current) return;
        socketRef.current.emit('basic_attack', { targetId });
      },
      getHoverPoint: (point: { x: number; z: number }) => {
        hoverPointRef.current = { x: point.x, z: point.z };
      },
    };

    let renderer: CommonRenderer;
    if (renderMode === '2d') {
      renderer = new Game2DRenderer(options);
    } else {
      renderer = new Game3DRenderer(options);
    }

    if (myPlayerId) {
      renderer.setMyPlayerId(myPlayerId);
    }
    rendererRef.current = renderer;

    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [isInRoom, myPlayerId, renderMode]);

  // Keyboard Hotkeys (Q, W, E, R)
  useEffect(() => {
    if (!isInRoom) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      const socket = socketRef.current;
      if (!socket || !roomState || !myPlayerId) return;

      const myPlayer = roomState.players[myPlayerId];
      if (!myPlayer || myPlayer.isDead) return;

      const hover = hoverPointRef.current;
      const dirX = hover.x - myPlayer.x;
      const dirZ = hover.z - myPlayer.z;

      if (e.code === 'KeyA') {
        e.preventDefault();
        triggerBasicAttack();
      } else if (e.code === 'KeyQ') {
        e.preventDefault();
        socket.emit('cast_q', { dirX, dirZ });
      } else if (e.code === 'KeyW') {
        e.preventDefault();
        socket.emit('cast_w', { dirX, dirZ });
      } else if (e.code === 'KeyE') {
        e.preventDefault();
        let enemyId: string | undefined;
        for (const pid in roomState.players) {
          if (pid !== myPlayerId && !roomState.players[pid].isDead) {
            enemyId = pid;
            break;
          }
        }
        socket.emit('cast_e', { targetId: enemyId });
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        socket.emit('cast_r');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isInRoom, roomState, myPlayerId]);

  // Basic Attack execution (Key A or Click)
  const triggerBasicAttack = () => {
    const socket = socketRef.current;
    if (!socket || !roomState || !myPlayerId) return;
    const myPlayer = roomState.players[myPlayerId];
    if (!myPlayer || myPlayer.isDead) return;

    const hover = hoverPointRef.current;
    let targetId: string | undefined;
    let minCursorDist = Infinity;
    for (const pid in roomState.players) {
      if (pid !== myPlayerId && !roomState.players[pid].isDead) {
        const p = roomState.players[pid];
        const d = (p.x - hover.x) ** 2 + (p.z - hover.z) ** 2;
        if (d < minCursorDist) {
          minCursorDist = d;
          targetId = pid;
        }
      }
    }
    socket.emit('basic_attack', { targetId });
  };

  // Skill casts via button clicks
  const triggerSkill = (skill: 'a' | 'q' | 'w' | 'e' | 'r') => {
    if (skill === 'a') {
      triggerBasicAttack();
      return;
    }

    const socket = socketRef.current;
    if (!socket || !roomState || !myPlayerId) return;
    const myPlayer = roomState.players[myPlayerId];
    if (!myPlayer || myPlayer.isDead) return;

    const hover = hoverPointRef.current;
    const dirX = hover.x - myPlayer.x;
    const dirZ = hover.z - myPlayer.z;

    if (skill === 'q') socket.emit('cast_q', { dirX, dirZ });
    if (skill === 'w') socket.emit('cast_w', { dirX, dirZ });
    if (skill === 'e') {
      let enemyId: string | undefined;
      for (const pid in roomState.players) {
        if (pid !== myPlayerId && !roomState.players[pid].isDead) {
          enemyId = pid;
          break;
        }
      }
      socket.emit('cast_e', { targetId: enemyId });
    }
    if (skill === 'r') socket.emit('cast_r');
  };

  const handleRematch = () => {
    socketRef.current?.emit('restart_game');
  };

  const toggleSound = () => {
    sound.enabled = !sound.enabled;
    setIsAudioMuted(!sound.enabled);
  };

  const copyRoomInvite = () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomId);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const leaveRoom = () => {
    setIsInRoom(false);
    setRoomState(null);
    socketRef.current?.emit('leave_room');
    socketRef.current?.emit('get_lobby_rooms');
  };

  // Helper extraction
  const myPlayer = myPlayerId && roomState?.players ? roomState.players[myPlayerId] : null;
  const enemyPlayer =
    roomState?.players &&
    Object.values(roomState.players).find((p) => p.id !== myPlayerId);

  const isEnemyAirborne = enemyPlayer?.isAirborne ?? false;
  const isQ3Ready = (myPlayer?.qStacks ?? 0) === 2;
  const isWinner = roomState?.winnerId === myPlayerId;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 font-sans select-none text-slate-100">
      {/* Canvas Viewport (Supports 2D Canvas or 3D WebGL) */}
      {isInRoom && (
        <canvas
          ref={canvasRef}
          className="w-full h-full block cursor-crosshair outline-none"
        />
      )}

      {/* LOBBY / ROOM CREATION SCREEN */}
      {!isInRoom && (
        <div className="absolute inset-0 z-50 overflow-y-auto flex items-center justify-center bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black p-4 sm:p-6">
          <div className="w-full max-w-2xl bg-slate-900/95 border border-amber-500/40 rounded-3xl p-6 sm:p-8 backdrop-blur-2xl shadow-2xl shadow-cyan-950/70">
            {/* Header Title */}
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs tracking-wider uppercase font-semibold mb-3">
                <Activity className="w-4 h-4 text-emerald-400" />
                Chế Độ 2D Siêu Mượt - 60 FPS (Không Giật Lag)
              </div>
              <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-500 bg-clip-text text-transparent font-['Cinzel',serif]">
                YASUO 1VS1 ARENA
              </h1>
              <p className="text-slate-400 text-xs sm:text-sm mt-1.5">
                Đấu trường trực tuyến 1v1 chuẩn kỹ năng Yasuo LMHT. Solo mượt mà với bạn bè qua 2 tab hoặc đối thủ online!
              </p>
            </div>

            {/* Error Notification Banner */}
            {errorMessage && (
              <div className="mb-5 flex items-center gap-2.5 p-3.5 rounded-xl bg-red-950/80 border border-red-500/70 text-red-200 text-xs font-semibold animate-shake">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Renderer Selection Toggle & Player Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6 bg-slate-950/80 p-3 rounded-2xl border border-slate-800">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1">
                  Tên Kiếm Khách Của Bạn
                </label>
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Nhập tên..."
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-amber-400 transition"
                  maxLength={18}
                />
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1">
                  Chế Độ Hiển Thị
                </label>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setRenderMode('2d')}
                    className={`flex-1 py-2 px-2.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
                      renderMode === '2d'
                        ? 'bg-emerald-600 text-white shadow-md shadow-emerald-700/40'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    ⚡ 2D Siêu Mượt
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenderMode('3d')}
                    className={`flex-1 py-2 px-2.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
                      renderMode === '3d'
                        ? 'bg-amber-600 text-white shadow-md shadow-amber-700/40'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" /> 3D Đồ Họa
                  </button>
                </div>
              </div>
            </div>

            {/* ACTION CARD 1: QUICK MATCHMAKING */}
            <div className="mb-5 bg-gradient-to-r from-amber-500/15 via-yellow-500/10 to-amber-500/15 border border-amber-500/50 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <h3 className="font-extrabold text-amber-300 text-base flex items-center gap-2">
                  <Zap className="w-5 h-5 text-amber-400 animate-pulse" />
                  Tìm Trận Nhanh (Ghép Đôi Tự Động)
                </h3>
                <p className="text-slate-300 text-xs mt-1">
                  {openRooms.length > 0
                    ? `Đang có ${openRooms.length} người chơi đang chờ đối thủ! Bấm để vào solo ngay!`
                    : 'Tự động ghép với đối thủ đang mở game hoặc tạo phòng chờ đối thủ vào solo.'}
                </p>
              </div>

              <button
                onClick={handleQuickMatch}
                className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-slate-950 font-black rounded-xl shadow-lg shadow-amber-500/30 transition active:scale-95 flex items-center justify-center gap-2 text-sm shrink-0 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-slate-950" />
                Vào Trận Ngay
              </button>
            </div>

            {/* ACTION CARD 2: LIVE OPEN ROOMS LIST */}
            <div className="mb-5 bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800/80">
                <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider text-slate-300">
                  <Users className="w-4 h-4 text-cyan-400" />
                  Phòng Chờ Đang Đợi Đối Thủ ({openRooms.length})
                </div>
                <button
                  onClick={() => socketRef.current?.emit('get_lobby_rooms')}
                  title="Làm mới danh sách phòng"
                  className="text-slate-400 hover:text-amber-300 transition flex items-center gap-1 text-[11px] cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" /> Làm mới
                </button>
              </div>

              {openRooms.length === 0 ? (
                <div className="py-5 text-center text-xs text-slate-500">
                  Hiện chưa có phòng nào đang mở. Hãy bấm <b className="text-amber-400">"Tạo Phòng Mới"</b> bên dưới để trở thành chủ phòng hoặc mở thêm 1 tab nữa để test!
                </div>
              ) : (
                <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                  {openRooms.map((room) => (
                    <div
                      key={room.id}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-700/70 hover:border-cyan-500/60 transition"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                        <div>
                          <div className="font-bold text-slate-200 text-xs">
                            Chủ phòng: <span className="text-cyan-300">{room.hostName}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            Mã: <span className="text-amber-400 font-semibold">{room.id}</span> • Đang đợi (1/2)
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => joinGame({ targetRoom: room.id })}
                        className="py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition active:scale-95 flex items-center gap-1 cursor-pointer shadow-sm shadow-emerald-700/30"
                      >
                        Vào Solo <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ACTION CARD 3: CREATE CUSTOM ROOM / JOIN BY CODE */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
              {/* Create new room button */}
              <button
                onClick={handleCreateNewRoom}
                className="p-3.5 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 hover:border-amber-400/80 rounded-2xl text-left transition flex items-center gap-3 group cursor-pointer"
              >
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 group-hover:scale-110 transition">
                  <PlusCircle className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-bold text-slate-200 text-xs group-hover:text-amber-300 transition">
                    Tạo Phòng Mới (Nhận Mã)
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Nhận mã phòng ngẫu nhiên và gửi link mời bạn
                  </div>
                </div>
              </button>

              {/* Join room with code input */}
              <form
                onSubmit={handleJoinByCode}
                className="p-2.5 bg-slate-800/80 border border-slate-700 rounded-2xl flex items-center gap-2"
              >
                <input
                  type="text"
                  value={inputRoomId}
                  onChange={(e) => setInputRoomId(e.target.value)}
                  placeholder="Nhập mã phòng..."
                  className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-amber-400 transition"
                />
                <button
                  type="submit"
                  className="py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl transition flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <LogIn className="w-3.5 h-3.5" /> Vào Phòng
                </button>
              </form>
            </div>

            {/* ACTION CARD 4: PRACTICE VS BOT */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-2xl bg-cyan-950/30 border border-cyan-700/40">
              <div className="flex items-center gap-2.5">
                <Bot className="w-5 h-5 text-cyan-400 shrink-0" />
                <div className="text-xs text-slate-300">
                  <b>Chế độ Luyện Tập:</b> Vào ngay phòng solo 1 mình với Bù Nhìn Test Dame để luyện combo Q, W, E, R mà không cần đợi đối thủ!
                </div>
              </div>
              <button
                onClick={() => joinGame({ isPractice: true })}
                className="w-full sm:w-auto px-4 py-2 bg-cyan-700 hover:bg-cyan-600 text-white font-bold text-xs rounded-xl transition active:scale-95 shrink-0 cursor-pointer"
              >
                Vào Luyện Tập Ngay
              </button>
            </div>
          </div>
        </div>
      )}

      {/* IN-GAME HUD OVERLAYS */}
      {isInRoom && roomState && (
        <>
          {/* Top Status & Health Bar Comparison */}
          <div className="absolute top-4 left-0 right-0 z-40 pointer-events-none flex flex-col items-center">
            {/* Room Info & Status Bar */}
            <div className="pointer-events-auto flex items-center gap-3 bg-slate-900/90 border border-slate-700/80 px-4 py-1.5 rounded-full backdrop-blur-md shadow-lg mb-3">
              <span className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                <span className={`w-2.5 h-2.5 rounded-full ${roomState.status === 'playing' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400 animate-ping'}`} />
                {roomState.status === 'playing' ? 'Trận Đấu Đang Diễn Ra' : 'Đang Chờ Đối Thủ Vào Phòng...'}
              </span>

              <div className="h-3 w-px bg-slate-700" />

              <span className="text-xs text-slate-400 font-mono">
                Mã: <span className="text-amber-400 font-bold">{roomId}</span>
              </span>

              <button
                onClick={copyRoomCode}
                title="Sao chép mã phòng"
                className="text-slate-400 hover:text-amber-300 transition p-1 hover:bg-slate-800 rounded cursor-pointer"
              >
                {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={toggleSound}
                title={isAudioMuted ? 'Bật âm thanh' : 'Tắt âm thanh'}
                className="text-slate-400 hover:text-slate-200 transition p-1 hover:bg-slate-800 rounded cursor-pointer"
              >
                {isAudioMuted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5 text-cyan-400" />}
              </button>

              {/* Mode Switcher Toggle Pill */}
              <button
                onClick={() => setRenderMode(renderMode === '2d' ? '3d' : '2d')}
                title="Chuyển chế độ hiển thị"
                className="px-2 py-0.5 rounded text-[11px] font-bold border transition cursor-pointer bg-slate-800 border-slate-600 hover:border-amber-400 text-amber-300"
              >
                {renderMode === '2d' ? '⚡ 2D Siêu Mượt' : '🎮 3D'}
              </button>

              <button
                onClick={leaveRoom}
                className="text-xs text-red-400 hover:text-red-300 px-2 py-0.5 hover:bg-red-950/50 rounded transition cursor-pointer"
              >
                Rời Phòng
              </button>
            </div>

            {/* Duel Health Comparison Bars */}
            <div className="w-full max-w-3xl px-4 flex items-center justify-between gap-4">
              {/* Blue Player (My Yasuo) */}
              <div className="flex-1 bg-slate-900/80 border border-blue-500/50 rounded-xl p-2.5 backdrop-blur-md shadow-lg">
                <div className="flex items-center justify-between mb-1.5 text-xs">
                  <span className="font-bold text-blue-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    {myPlayer?.name || 'Yasuo (Bạn)'}
                  </span>
                  <span className="font-mono font-bold text-slate-200">
                    {Math.round(myPlayer?.hp ?? 0)} / {myPlayer?.maxHp ?? 1000} HP
                  </span>
                </div>
                {/* Health Bar track */}
                <div className="w-full h-3.5 bg-slate-950 rounded-md overflow-hidden p-0.5 border border-slate-700/60">
                  <div
                    className="h-full bg-gradient-to-r from-blue-600 via-emerald-500 to-green-400 rounded transition-all duration-150"
                    style={{ width: `${Math.max(0, ((myPlayer?.hp ?? 0) / (myPlayer?.maxHp ?? 1000)) * 100)}%` }}
                  />
                </div>
              </div>

              {/* VS Crest */}
              <div className="flex flex-col items-center">
                <div className="w-9 h-9 rounded-full bg-gradient-to-b from-amber-500 to-amber-700 border-2 border-yellow-300 flex items-center justify-center font-extrabold text-slate-950 text-xs shadow-md">
                  VS
                </div>
              </div>

              {/* Red Player (Opponent) */}
              <div className="flex-1 bg-slate-900/80 border border-red-500/50 rounded-xl p-2.5 backdrop-blur-md shadow-lg">
                <div className="flex items-center justify-between mb-1.5 text-xs">
                  <span className="font-bold text-red-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    {enemyPlayer?.name || (roomState.status === 'waiting' ? 'Đang đợi đối thủ...' : 'Yasuo (Đối Thủ)')}
                  </span>
                  <span className="font-mono font-bold text-slate-200">
                    {enemyPlayer ? `${Math.round(enemyPlayer.hp)} / ${enemyPlayer.maxHp} HP` : '---'}
                  </span>
                </div>
                {/* Health Bar track */}
                <div className="w-full h-3.5 bg-slate-950 rounded-md overflow-hidden p-0.5 border border-slate-700/60">
                  <div
                    className="h-full bg-gradient-to-r from-red-600 via-orange-500 to-red-400 rounded transition-all duration-150"
                    style={{ width: `${enemyPlayer ? Math.max(0, (enemyPlayer.hp / enemyPlayer.maxHp) * 100) : 0}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* WAITING FOR OPPONENT CARD OVERLAY */}
          {roomState.status === 'waiting' && (
            <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center p-4">
              <div className="pointer-events-auto bg-slate-900/95 border-2 border-amber-500/60 rounded-3xl p-6 sm:p-8 max-w-md text-center shadow-2xl backdrop-blur-xl">
                <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto mb-3 animate-pulse">
                  <Users className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-black text-amber-300 uppercase tracking-wide mb-1 font-['Cinzel',serif]">
                  Đang Chờ Đối Thủ Vào Phòng
                </h3>
                <p className="text-slate-400 text-xs mb-4">
                  Mở tab trình duyệt thứ 2 (hoặc gửi mã cho bạn bè) để bắt đầu trận đấu solo 1vs1!
                </p>

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 mb-4 flex items-center justify-between">
                  <div className="text-left">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">Mã Phòng</div>
                    <div className="text-lg font-mono font-black text-amber-400">{roomId}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={copyRoomCode}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold rounded-lg text-slate-200 transition flex items-center gap-1 cursor-pointer"
                    >
                      {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedCode ? 'Đã chép' : 'Chép mã'}
                    </button>
                    <button
                      onClick={copyRoomInvite}
                      className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg transition flex items-center gap-1 cursor-pointer"
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                      {copiedLink ? 'Đã chép link' : 'Chép link mời'}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => {
                      leaveRoom();
                      setTimeout(() => joinGame({ isPractice: true }), 100);
                    }}
                    className="w-full py-2.5 px-4 bg-cyan-700/80 hover:bg-cyan-600 border border-cyan-600/50 text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Bot className="w-4 h-4" /> Đổi Sang Đấu Với Bot Dummy Ngay
                  </button>
                  <button
                    onClick={leaveRoom}
                    className="text-xs text-slate-400 hover:text-slate-200 py-1 transition cursor-pointer"
                  >
                    Rời Phòng Về Sảnh
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Airborne Warning Banner */}
          {myPlayer?.isAirborne && (
            <div className="absolute top-28 left-1/2 -translate-x-1/2 z-40 bg-red-600/90 text-white font-extrabold px-6 py-2 rounded-full text-base tracking-widest uppercase border-2 border-red-300 shadow-2xl animate-bounce">
              BỊ HẤT TUNG LÊN KHÔNG TRUNG!
            </div>
          )}

          {/* Quick Controls Drawer (Bottom-Left) */}
          <div className="absolute bottom-4 left-4 z-40">
            {showGuide ? (
              <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-3.5 backdrop-blur-md shadow-xl max-w-xs text-xs space-y-2">
                <div className="flex items-center justify-between font-bold text-amber-300 pb-1 border-b border-slate-800">
                  <span className="flex items-center gap-1">
                    <Info className="w-3.5 h-3.5" /> Phím Tắt Điều Khiển
                  </span>
                  <button
                    onClick={() => setShowGuide(false)}
                    className="text-slate-400 hover:text-white cursor-pointer"
                  >
                    Thu gọn
                  </button>
                </div>
                <div className="text-slate-300 space-y-1">
                  <div>• <b className="text-emerald-400">Chuột phải:</b> Di chuyển tướng</div>
                  <div>• <b className="text-emerald-400">Phím A / Chuột trái:</b> Đánh thường cận chiến (Chém kiếm 50 ST)</div>
                  <div>• <b className="text-cyan-400">Q:</b> Đâm kiếm (Trúng 2 lần mở Lốc Q3)</div>
                  <div>• <b className="text-blue-400">W:</b> Dựng Tường Gió (Chắn lốc 3.5s)</div>
                  <div>• <b className="text-amber-400">E:</b> Lướt qua người đối thủ</div>
                  <div>• <b className="text-red-400">R:</b> Trăn Trối (Khi địch bị hất tung)</div>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowGuide(true)}
                className="bg-slate-900/80 border border-slate-700 p-2 rounded-lg text-slate-300 hover:text-amber-300 flex items-center gap-1.5 text-xs font-semibold backdrop-blur cursor-pointer"
              >
                <Info className="w-4 h-4" /> Hiện Phím Tắt
              </button>
            )}
          </div>

          {/* BOTTOM MOBA HUD - YASUO SKILL BAR */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-40 pointer-events-auto flex flex-col items-center">
            {/* Q Stacks Indicator (Wind Power Gems) */}
            <div className="flex items-center gap-2 mb-2 bg-slate-950/80 px-4 py-1 rounded-full border border-slate-700/70 shadow-md">
              <span className="text-[11px] font-bold tracking-wider uppercase text-slate-400">
                Tụ Gió (Q Stacks):
              </span>
              <div className="flex items-center gap-1.5">
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-300 ${
                    (myPlayer?.qStacks ?? 0) >= 1
                      ? 'bg-cyan-400 shadow-sm shadow-cyan-400 ring-2 ring-cyan-300'
                      : 'bg-slate-800 border border-slate-600'
                  }`}
                />
                <div
                  className={`w-3.5 h-3.5 rounded-full transition-all duration-300 ${
                    (myPlayer?.qStacks ?? 0) >= 2
                      ? 'bg-amber-300 shadow-md shadow-amber-300 ring-2 ring-yellow-200 animate-pulse'
                      : 'bg-slate-800 border border-slate-600'
                  }`}
                />
              </div>
              {isQ3Ready && (
                <span className="text-[11px] font-extrabold text-amber-300 uppercase tracking-widest ml-1 animate-pulse">
                  HASAGI! (LỐC SẴN SÀNG)
                </span>
              )}
            </div>

            {/* League of Legends Hextech Skill Frame */}
            <div className="flex items-center gap-3 bg-gradient-to-b from-slate-900 via-slate-950 to-black p-3 rounded-2xl border-2 border-amber-500/60 shadow-2xl backdrop-blur-lg">
              {/* Skill A: Đánh Thường / Chém Kiếm */}
              <button
                onClick={() => triggerSkill('a')}
                disabled={(myPlayer?.basicAttackCooldown ?? 0) > 0}
                className="relative w-16 h-16 rounded-xl flex flex-col items-center justify-center p-1.5 border-2 border-slate-700 hover:border-emerald-400 bg-slate-900 transition active:scale-95 group cursor-pointer"
              >
                <div className="absolute top-1 left-1 bg-black/80 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-emerald-400 border border-emerald-500/40">
                  A
                </div>
                <div className="my-auto flex flex-col items-center">
                  <Swords className="w-6 h-6 text-emerald-400 group-hover:scale-110 transition" />
                  <span className="text-[9px] font-bold text-slate-300 mt-0.5">ĐÁNH THƯỜNG</span>
                </div>
                {(myPlayer?.basicAttackCooldown ?? 0) > 0 && (
                  <div className="absolute inset-0 bg-black/80 rounded-xl flex items-center justify-center font-mono font-bold text-xs text-white">
                    {((myPlayer?.basicAttackCooldown ?? 0) / 1000).toFixed(1)}
                  </div>
                )}
              </button>

              {/* Skill Q: Bão Kiếm / Lốc Xoáy */}
              <button
                onClick={() => triggerSkill('q')}
                disabled={(myPlayer?.qCooldown ?? 0) > 0}
                className={`relative w-16 h-16 rounded-xl flex flex-col items-center justify-center p-1.5 border-2 transition active:scale-95 group cursor-pointer ${
                  isQ3Ready
                    ? 'border-amber-300 shadow-lg shadow-amber-400/40 bg-gradient-to-b from-cyan-950 to-slate-900 ring-2 ring-amber-300/60'
                    : 'border-slate-700 hover:border-cyan-400 bg-slate-900'
                }`}
              >
                <div className="absolute top-1 left-1 bg-black/80 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-amber-300 border border-amber-500/40">
                  Q
                </div>
                <div className="my-auto flex flex-col items-center">
                  <Wind className={`w-6 h-6 ${isQ3Ready ? 'text-amber-300 animate-spin' : 'text-cyan-400'}`} style={{ animationDuration: '3s' }} />
                  <span className="text-[9px] font-bold text-slate-300 mt-0.5">
                    {isQ3Ready ? 'LỐC XOÁY' : 'BÃO KIẾM'}
                  </span>
                </div>
                {(myPlayer?.qCooldown ?? 0) > 0 && (
                  <div className="absolute inset-0 bg-black/80 rounded-xl flex items-center justify-center font-mono font-bold text-base text-white">
                    {((myPlayer?.qCooldown ?? 0) / 1000).toFixed(1)}
                  </div>
                )}
              </button>

              {/* Skill W: Tường Gió */}
              <button
                onClick={() => triggerSkill('w')}
                disabled={(myPlayer?.wCooldown ?? 0) > 0}
                className="relative w-16 h-16 rounded-xl flex flex-col items-center justify-center p-1.5 border-2 border-slate-700 hover:border-blue-400 bg-slate-900 transition active:scale-95 group cursor-pointer"
              >
                <div className="absolute top-1 left-1 bg-black/80 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-amber-300 border border-amber-500/40">
                  W
                </div>
                <div className="my-auto flex flex-col items-center">
                  <Shield className="w-6 h-6 text-blue-400" />
                  <span className="text-[9px] font-bold text-slate-300 mt-0.5">TƯỜNG GIÓ</span>
                </div>
                {(myPlayer?.wCooldown ?? 0) > 0 && (
                  <div className="absolute inset-0 bg-black/80 rounded-xl flex items-center justify-center font-mono font-bold text-base text-white">
                    {((myPlayer?.wCooldown ?? 0) / 1000).toFixed(1)}
                  </div>
                )}
              </button>

              {/* Skill E: Quét Kiếm */}
              <button
                onClick={() => triggerSkill('e')}
                disabled={(myPlayer?.eCooldown ?? 0) > 0}
                className="relative w-16 h-16 rounded-xl flex flex-col items-center justify-center p-1.5 border-2 border-slate-700 hover:border-yellow-400 bg-slate-900 transition active:scale-95 group cursor-pointer"
              >
                <div className="absolute top-1 left-1 bg-black/80 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-amber-300 border border-amber-500/40">
                  E
                </div>
                <div className="my-auto flex flex-col items-center">
                  <Zap className="w-6 h-6 text-amber-400" />
                  <span className="text-[9px] font-bold text-slate-300 mt-0.5">QUÉT KIẾM</span>
                </div>
                {(myPlayer?.eCooldown ?? 0) > 0 && (
                  <div className="absolute inset-0 bg-black/80 rounded-xl flex items-center justify-center font-mono font-bold text-base text-white">
                    {((myPlayer?.eCooldown ?? 0) / 1000).toFixed(1)}
                  </div>
                )}
              </button>

              {/* Skill R: Trăn Trối */}
              <button
                onClick={() => triggerSkill('r')}
                disabled={(myPlayer?.rCooldown ?? 0) > 0 || !isEnemyAirborne}
                className={`relative w-16 h-16 rounded-xl flex flex-col items-center justify-center p-1.5 border-2 transition active:scale-95 group cursor-pointer ${
                  isEnemyAirborne && (myPlayer?.rCooldown ?? 0) <= 0
                    ? 'border-yellow-400 shadow-xl shadow-yellow-500/50 bg-gradient-to-b from-red-950 to-slate-900 ring-2 ring-yellow-400 animate-bounce'
                    : 'border-slate-800 bg-slate-950 opacity-60'
                }`}
              >
                <div className="absolute top-1 left-1 bg-black/80 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-amber-300 border border-amber-500/40">
                  R
                </div>
                <div className="my-auto flex flex-col items-center">
                  <Swords className={`w-6 h-6 ${isEnemyAirborne ? 'text-yellow-300 animate-pulse' : 'text-slate-500'}`} />
                  <span className={`text-[9px] font-bold mt-0.5 ${isEnemyAirborne ? 'text-yellow-200' : 'text-slate-500'}`}>
                    TRĂN TRỐI
                  </span>
                </div>
                {(myPlayer?.rCooldown ?? 0) > 0 && (
                  <div className="absolute inset-0 bg-black/85 rounded-xl flex items-center justify-center font-mono font-bold text-base text-white">
                    {((myPlayer?.rCooldown ?? 0) / 1000).toFixed(1)}
                  </div>
                )}
              </button>
            </div>
          </div>

          {/* GAME OVER MODAL (VICTORY / DEFEAT) */}
          {roomState.status === 'ended' && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
              <div className={`w-full max-w-md p-8 rounded-3xl text-center shadow-2xl border-2 ${
                isWinner
                  ? 'bg-gradient-to-b from-slate-900 via-slate-950 to-amber-950/40 border-amber-400/80 shadow-amber-500/30'
                  : 'bg-gradient-to-b from-slate-900 via-slate-950 to-red-950/40 border-red-500/80 shadow-red-500/30'
              }`}>
                {/* Result Title */}
                <h2 className={`text-5xl font-black tracking-wider uppercase mb-2 font-['Cinzel',serif] ${
                  isWinner
                    ? 'bg-gradient-to-r from-yellow-200 via-amber-400 to-yellow-500 bg-clip-text text-transparent'
                    : 'text-red-500'
                }`}>
                  {isWinner ? 'CHIẾN THẮNG!' : 'THẤT BẠI!'}
                </h2>

                <p className="text-slate-300 text-sm mb-6">
                  {isWinner
                    ? 'Kiếm pháp của bạn thần sầu! Đối thủ đã bị hạ gục hoàn toàn.'
                    : 'Đã trúng kiếm của đối thủ. Hãy tôi luyện lại ý chí và chiến đấu tiếp!'}
                </p>

                {/* Rematch & Exit Buttons */}
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <button
                    onClick={handleRematch}
                    className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-slate-950 font-extrabold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-amber-500/25 transition active:scale-95 cursor-pointer"
                  >
                    <RotateCcw className="w-5 h-5" />
                    Đấu Lại (Rematch)
                  </button>

                  <button
                    onClick={leaveRoom}
                    className="w-full sm:w-auto px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl transition cursor-pointer"
                  >
                    Về Phòng Chờ
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const rootContainer = document.getElementById('root');
if (rootContainer && !rootContainer.hasChildNodes()) {
  createRoot(rootContainer).render(<App />);
}
