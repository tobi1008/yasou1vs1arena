import type { PlayerState, Projectile, WindWall, CombatEvent, Vector2D } from '../types/game.js';
import { sound } from '../utils/audio.js';

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  onFloorClick: (point: { x: number; z: number }, isRightClick: boolean) => void;
  onTargetClick?: (targetId: string) => void;
  getHoverPoint: (point: { x: number; z: number }) => void;
}

interface FloatingText {
  id: string;
  text: string;
  x: number;
  z: number;
  color: string;
  createdAt: number;
  duration: number;
}

interface VisualSlash {
  type: 'thrust' | 'dash' | 'ult' | 'slash';
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  range?: number;
  start?: Vector2D;
  end?: Vector2D;
  createdAt: number;
  duration: number;
}

export class Game2DRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private myPlayerId: string | null = null;

  private onFloorClickCallback: (point: { x: number; z: number }, isRightClick: boolean) => void;
  private onTargetClickCallback?: (targetId: string) => void;
  private getHoverPointCallback: (point: { x: number; z: number }) => void;

  // View & Camera
  private cameraX = 0;
  private cameraZ = 0;
  private scale = 28; // pixels per world unit
  private mouseScreenX = 0;
  private mouseScreenY = 0;

  // Visuals & Effects
  private moveClick: { x: number; z: number; time: number } | null = null;
  private floatingTexts: FloatingText[] = [];
  private visualSlashes: VisualSlash[] = [];
  private tornadoRotation = 0;
  private animFrameId: number | null = null;
  private isDisposed = false;

  // Cached Game State
  private players: Record<string, PlayerState> = {};
  private projectiles: Projectile[] = [];
  private windwalls: WindWall[] = [];

  constructor(options: RendererOptions) {
    this.canvas = options.canvas;
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.onFloorClickCallback = options.onFloorClick;
    this.onTargetClickCallback = options.onTargetClick;
    this.getHoverPointCallback = options.getHoverPoint;

    this.resize();
    this.setupInputs();
    this.renderLoop();
  }

  public setMyPlayerId(id: string) {
    this.myPlayerId = id;
  }

  private resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;

    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);

    // Dynamic zoom based on screen size so the arena fits comfortably
    this.scale = Math.max(20, Math.min(34, Math.min(width, height) / 28));
  };

  private setupInputs() {
    window.addEventListener('resize', this.resize);

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.handleClick(e, true);
    });

    this.canvas.addEventListener('click', (e) => {
      this.handleClick(e, false);
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseScreenX = e.clientX - rect.left;
      this.mouseScreenY = e.clientY - rect.top;

      const world = this.screenToWorld(this.mouseScreenX, this.mouseScreenY);
      this.getHoverPointCallback(world);
    });
  }

  private screenToWorld(sx: number, sy: number): { x: number; z: number } {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const wx = (sx - width / 2) / this.scale + this.cameraX;
    const wz = (sy - height / 2) / this.scale + this.cameraZ;
    return { x: wx, z: wz };
  }

  private worldToScreen(wx: number, wz: number): { x: number; y: number } {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const sx = width / 2 + (wx - this.cameraX) * this.scale;
    const sy = height / 2 + (wz - this.cameraZ) * this.scale;
    return { x: sx, y: sy };
  }

  private handleClick(e: MouseEvent, isRightClick: boolean) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = this.screenToWorld(sx, sy);

    // Check if clicked directly on enemy
    if (this.onTargetClickCallback) {
      for (const pid in this.players) {
        if (pid !== this.myPlayerId && !this.players[pid].isDead) {
          const enemy = this.players[pid];
          const dist = Math.hypot(enemy.x - world.x, enemy.z - world.z);
          if (dist <= 1.4) {
            this.onTargetClickCallback(pid);
            return;
          }
        }
      }
    }

    this.onFloorClickCallback(world, isRightClick);

    if (isRightClick) {
      this.moveClick = { x: world.x, z: world.z, time: Date.now() };
      sound.playMoveClick();
    }
  }

  public updateGameState(
    players: Record<string, PlayerState>,
    projectiles: Projectile[],
    windwalls: WindWall[],
    recentEvents: CombatEvent[]
  ) {
    this.players = players;
    this.projectiles = projectiles;
    this.windwalls = windwalls;

    // Camera follow player
    if (this.myPlayerId && players[this.myPlayerId]) {
      const me = players[this.myPlayerId];
      this.cameraX += (me.x - this.cameraX) * 0.15;
      this.cameraZ += (me.z - this.cameraZ) * 0.15;
    }

    // Process combat events for damage numbers
    for (const evt of recentEvents) {
      const age = Date.now() - parseInt(evt.id.split('-')[1] || '0');
      if (age < 80 && evt.text && evt.x !== undefined && evt.z !== undefined) {
        if (!this.floatingTexts.some((t) => t.id === evt.id)) {
          this.floatingTexts.push({
            id: evt.id,
            text: evt.text,
            x: evt.x,
            z: evt.z,
            color: evt.type === 'airborne' ? '#ff3344' : evt.type === 'blocked' ? '#66ddff' : '#ffcc00',
            createdAt: Date.now(),
            duration: 1100,
          });
        }
      }
    }
  }

  public spawnSkillEffect(data: {
    type: string;
    ownerId: string;
    x?: number;
    z?: number;
    dirX?: number;
    dirZ?: number;
    range?: number;
    start?: Vector2D;
    end?: Vector2D;
  }) {
    if (data.type === 'q12_thrust' && data.x !== undefined && data.z !== undefined) {
      sound.playQThrust();
      this.visualSlashes.push({
        type: 'thrust',
        x: data.x,
        z: data.z,
        dirX: data.dirX || 1,
        dirZ: data.dirZ || 0,
        range: data.range || 4.8,
        createdAt: Date.now(),
        duration: 220,
      });
    } else if (data.type === 'q3_tornado') {
      sound.playQTornado();
    } else if (data.type === 'w_wall') {
      sound.playWindWall();
    } else if (data.type === 'e_dash' && data.start && data.end) {
      sound.playDash();
      this.visualSlashes.push({
        type: 'dash',
        x: data.start.x,
        z: data.start.z,
        dirX: 0,
        dirZ: 0,
        start: data.start,
        end: data.end,
        createdAt: Date.now(),
        duration: 260,
      });
    } else if (data.type === 'basic_attack' && data.x !== undefined && data.z !== undefined) {
      sound.playHit();
      this.visualSlashes.push({
        type: 'slash',
        x: data.x,
        z: data.z,
        dirX: 0,
        dirZ: 0,
        createdAt: Date.now(),
        duration: 180,
      });
    } else if (data.type === 'r_ult' && data.x !== undefined && data.z !== undefined) {
      sound.playLastBreath();
      this.visualSlashes.push({
        type: 'ult',
        x: data.x,
        z: data.z,
        dirX: 0,
        dirZ: 0,
        createdAt: Date.now(),
        duration: 650,
      });
    }
  }

  // Draw Arena in 2D
  private drawArena() {
    const ctx = this.ctx;
    const center = this.worldToScreen(0, 0);
    const arenaRadius = 21.5 * this.scale;

    // Deep space/void around arena
    ctx.fillStyle = '#060a12';
    ctx.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

    // Save for clipping inside arena
    ctx.save();
    ctx.beginPath();
    ctx.arc(center.x, center.y, arenaRadius, 0, Math.PI * 2);
    ctx.clip();

    // Floor Gradient
    const floorGrad = ctx.createRadialGradient(
      center.x,
      center.y,
      10 * this.scale,
      center.x,
      center.y,
      arenaRadius
    );
    floorGrad.addColorStop(0, '#1a2236');
    floorGrad.addColorStop(0.7, '#111726');
    floorGrad.addColorStop(1, '#0c101b');
    ctx.fillStyle = floorGrad;
    ctx.fill();

    // Grid Lines (Tile grid)
    ctx.strokeStyle = 'rgba(70, 110, 160, 0.15)';
    ctx.lineWidth = 1;
    const gridSize = 3 * this.scale;
    const leftW = -22;
    const rightW = 22;
    for (let gx = leftW; gx <= rightW; gx += 2) {
      const p1 = this.worldToScreen(gx, -22);
      const p2 = this.worldToScreen(gx, 22);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    for (let gz = leftW; gz <= rightW; gz += 2) {
      const p1 = this.worldToScreen(-22, gz);
      const p2 = this.worldToScreen(22, gz);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // Concentric Arena Rings & Rune Circles
    [6, 12, 18].forEach((r, idx) => {
      ctx.beginPath();
      ctx.arc(center.x, center.y, r * this.scale, 0, Math.PI * 2);
      ctx.strokeStyle = idx === 2 ? 'rgba(212, 175, 55, 0.35)' : 'rgba(90, 160, 230, 0.2)';
      ctx.lineWidth = idx === 2 ? 3 : 1.5;
      ctx.stroke();
    });

    // Wind Rune spiral at center
    ctx.strokeStyle = 'rgba(100, 210, 255, 0.3)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 6; a += 0.15) {
      const rad = (0.5 + a * 0.45) * this.scale;
      const rx = center.x + Math.cos(a) * rad;
      const ry = center.y + Math.sin(a) * rad;
      if (a === 0) ctx.moveTo(rx, ry);
      else ctx.lineTo(rx, ry);
    }
    ctx.stroke();

    ctx.restore();

    // Outer Gold Rim with Glow
    ctx.beginPath();
    ctx.arc(center.x, center.y, arenaRadius, 0, Math.PI * 2);
    ctx.strokeStyle = '#c8aa6e';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#d4af37';
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 8 Decorative Pillars / Runestones around perimeter
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI * 2) / 8;
      const px = Math.cos(angle) * 21.2;
      const pz = Math.sin(angle) * 21.2;
      const sp = this.worldToScreen(px, pz);

      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 0.7 * this.scale, 0, Math.PI * 2);
      ctx.fillStyle = '#223048';
      ctx.fill();
      ctx.strokeStyle = '#3d5475';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Glowing Torch light
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 0.35 * this.scale, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 === 0 ? '#00e5ff' : '#ff4422';
      ctx.shadowColor = i % 2 === 0 ? '#00e5ff' : '#ff4422';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // Draw Move Click Reticle
  private drawMoveClick() {
    if (!this.moveClick) return;
    const now = Date.now();
    const elapsed = now - this.moveClick.time;
    if (elapsed > 400) {
      this.moveClick = null;
      return;
    }

    const p = elapsed / 400;
    const pt = this.worldToScreen(this.moveClick.x, this.moveClick.z);
    const radius = (1.1 - p * 0.4) * this.scale;
    const alpha = (1 - p).toFixed(2);

    this.ctx.save();
    this.ctx.strokeStyle = `rgba(34, 238, 119, ${alpha})`;
    this.ctx.lineWidth = 2.5;
    this.ctx.beginPath();
    this.ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
    this.ctx.stroke();

    // 4 inward pointers
    for (let i = 0; i < 4; i++) {
      const ang = (i * Math.PI) / 2;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      this.ctx.beginPath();
      this.ctx.moveTo(pt.x + cos * (radius + 6), pt.y + sin * (radius + 6));
      this.ctx.lineTo(pt.x + cos * (radius - 2), pt.y + sin * (radius - 2));
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  // Draw 2D Yasuo Character
  private drawPlayer(p: PlayerState) {
    const ctx = this.ctx;
    const isMe = p.id === this.myPlayerId;
    const basePt = this.worldToScreen(p.x, p.z);

    // Airborne offset simulation: shadow stays on ground, player lifts up!
    const airborneOffset = p.airborneHeight * this.scale * 1.4;
    const pt = { x: basePt.x, y: basePt.y - airborneOffset };

    // 1. Ground Shadow (stays on ground during airborne)
    ctx.save();
    ctx.beginPath();
    const shadowScale = Math.max(0.4, 1 - (p.airborneHeight / 4) * 0.5);
    ctx.ellipse(basePt.x, basePt.y + 4, 18 * shadowScale, 11 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 0, 0, ${0.45 * shadowScale})`;
    ctx.fill();
    ctx.restore();

    // 2. Selection Ring under character
    ctx.save();
    ctx.beginPath();
    ctx.arc(basePt.x, basePt.y, 1.0 * this.scale, 0, Math.PI * 2);
    ctx.strokeStyle = isMe ? 'rgba(0, 255, 136, 0.8)' : 'rgba(255, 51, 68, 0.8)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // E Target Cooldown Ring on enemy
    const myPlayer = this.myPlayerId ? this.players[this.myPlayerId] : null;
    const eCooldown = myPlayer?.eTargetCooldowns?.[p.id] || 0;
    if (eCooldown > 0) {
      ctx.beginPath();
      ctx.arc(basePt.x, basePt.y, 1.4 * this.scale, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // 3. Q3 Wind Aura around character
    if (p.qStacks === 2) {
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate(this.tornadoRotation);
      ctx.beginPath();
      ctx.arc(0, 0, 1.6 * this.scale, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(100, 230, 255, 0.65)';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#64e6ff';
      ctx.shadowBlur = 10;
      ctx.stroke();

      // Swirling wind particles
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 1.5 * this.scale, Math.sin(a) * 1.5 * this.scale, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
      ctx.restore();
    }

    // 4. Character Body & Weapon (Rotated to face direction)
    ctx.save();
    ctx.translate(pt.x, pt.y);
    // Rotation: player.rotation is angle in radians
    ctx.rotate(p.rotation - Math.PI / 2);

    const mainColor = p.team === 'blue' ? '#1f6eff' : '#ef233c';

    // Long Ponytail Hair trailing behind
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-14, 0, -26, 4);
    ctx.lineTo(-24, -2);
    ctx.closePath();
    ctx.fillStyle = '#11141c';
    ctx.fill();

    // Torso / Robe
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 10, 0, 0, Math.PI * 2);
    ctx.fillStyle = mainColor;
    ctx.fill();
    ctx.strokeStyle = '#0a101d';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Gold Belt / Sash
    ctx.fillStyle = '#d4a017';
    ctx.fillRect(-8, -2, 16, 4);

    // Pauldron Shoulder Armor (Left shoulder)
    ctx.beginPath();
    ctx.ellipse(-2, -10, 6, 4, Math.PI / 4, 0, Math.PI * 2);
    ctx.fillStyle = '#b0c0d8';
    ctx.fill();
    ctx.strokeStyle = '#5a7090';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Head
    ctx.beginPath();
    ctx.arc(3, 0, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#ecd0b0';
    ctx.fill();

    // Katana Sword (Pointing in front of right hand)
    ctx.save();
    ctx.translate(6, 7);
    ctx.rotate(Math.PI / 6);
    // Blade
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(26, 0);
    ctx.strokeStyle = p.qStacks === 2 ? '#88ffff' : '#f0f4f8';
    ctx.lineWidth = 3;
    if (p.qStacks === 2) {
      ctx.shadowColor = '#00ffff';
      ctx.shadowBlur = 8;
    }
    ctx.stroke();

    // Sword Hilt & Tsuba Guard
    ctx.fillStyle = '#d4a017';
    ctx.fillRect(-2, -3, 3, 6);
    ctx.fillStyle = '#222222';
    ctx.fillRect(-7, -1.5, 5, 3);
    ctx.restore();

    ctx.restore();

    // 5. 2D Billboard Health Bar above character
    this.drawHealthBar(p, pt.x, pt.y - 32, isMe);
  }

  // Draw Crisp 2D Health Bar
  private drawHealthBar(p: PlayerState, x: number, y: number, isMe: boolean) {
    const ctx = this.ctx;
    const barW = 76;
    const barH = 9;
    const hpRatio = Math.max(0, Math.min(1, p.hp / p.maxHp));

    ctx.save();
    // Name Label Above
    ctx.font = 'bold 12px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    ctx.fillText(`${p.name} (${Math.round(p.hp)})`, x, y - 6);
    ctx.shadowBlur = 0;

    // Background & Border
    ctx.fillStyle = 'rgba(8, 12, 20, 0.85)';
    ctx.fillRect(x - barW / 2 - 2, y - 2, barW + 4, barH + 4);
    ctx.strokeStyle = isMe ? '#22ee88' : '#ff4455';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - barW / 2 - 2, y - 2, barW + 4, barH + 4);

    // HP Fill
    const fillW = barW * hpRatio;
    if (fillW > 0) {
      const grad = ctx.createLinearGradient(x - barW / 2, 0, x - barW / 2 + fillW, 0);
      if (isMe) {
        grad.addColorStop(0, '#00c853');
        grad.addColorStop(1, '#00e676');
      } else {
        grad.addColorStop(0, '#d50000');
        grad.addColorStop(1, '#ff1744');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(x - barW / 2, y, fillW, barH);

      // 100 HP Ticks
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      for (let i = 1; i < 10; i++) {
        const tx = x - barW / 2 + barW * (i / 10);
        if (tx < x - barW / 2 + fillW) {
          ctx.fillRect(tx - 0.5, y, 1, barH);
        }
      }
    }

    // Status Badges (DEAD / AIRBORNE / Q3 READY)
    if (p.isDead) {
      ctx.fillStyle = 'rgba(40, 45, 55, 0.9)';
      ctx.fillRect(x - 42, y + 13, 84, 16);
      ctx.strokeStyle = '#ff3344';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 42, y + 13, 84, 16);
      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = '#ff6677';
      ctx.fillText('ĐÃ BỊ HẠ GỤC', x, y + 25);
    } else if (p.isAirborne) {
      ctx.fillStyle = '#ff1744';
      ctx.fillRect(x - 36, y + 13, 72, 16);
      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('HẤT TUNG!', x, y + 25);
    } else if (p.qStacks === 2) {
      ctx.fillStyle = '#00b0ff';
      ctx.fillRect(x - 36, y + 13, 72, 15);
      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('LỐC XOÁY!', x, y + 24);
    }

    ctx.restore();
  }

  // Draw Q3 Tornado Projectile
  private drawProjectile(proj: Projectile) {
    const ctx = this.ctx;
    const pt = this.worldToScreen(proj.x, proj.z);
    const radius = proj.radius * this.scale;

    ctx.save();
    ctx.translate(pt.x, pt.y);
    ctx.rotate(this.tornadoRotation * 2);

    // Outer Vortex Wind Ring
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(120, 240, 255, 0.85)';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#66ddff';
    ctx.shadowBlur = 12;
    ctx.stroke();

    // Spiral Arms
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.65, a, a + Math.PI / 1.8);
      ctx.stroke();
    }

    // Glowing core
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.restore();
  }

  // Draw W Wind Wall
  private drawWindWall(wall: WindWall) {
    const ctx = this.ctx;
    const pt = this.worldToScreen(wall.x, wall.z);
    const halfW = (wall.width / 2) * this.scale;
    const lifeRatio = 1 - wall.elapsed / wall.duration;

    ctx.save();
    ctx.translate(pt.x, pt.y);
    ctx.rotate(wall.angle);

    // Glowing Wind Barrier
    ctx.beginPath();
    ctx.moveTo(-halfW, 0);
    ctx.quadraticCurveTo(0, -6, halfW, 0);
    ctx.strokeStyle = `rgba(68, 213, 255, ${Math.min(0.9, lifeRatio * 1.3)})`;
    ctx.lineWidth = 7;
    ctx.shadowColor = '#44d5ff';
    ctx.shadowBlur = 14;
    ctx.stroke();

    // Core white light
    ctx.beginPath();
    ctx.moveTo(-halfW, 0);
    ctx.quadraticCurveTo(0, -6, halfW, 0);
    ctx.strokeStyle = `rgba(220, 255, 255, ${Math.min(1.0, lifeRatio * 1.5)})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.restore();
  }

  // Draw Visual Skill slashes
  private drawVisualSlashes() {
    const ctx = this.ctx;
    const now = Date.now();

    for (let i = this.visualSlashes.length - 1; i >= 0; i--) {
      const s = this.visualSlashes[i];
      const elapsed = now - s.createdAt;
      const progress = elapsed / s.duration;

      if (progress >= 1) {
        this.visualSlashes.splice(i, 1);
        continue;
      }

      const alpha = 1 - progress;

      if (s.type === 'thrust') {
        // Q1/Q2 Blade Thrust
        const p1 = this.worldToScreen(s.x, s.z);
        const range = (s.range || 4.8) * this.scale;
        const p2 = {
          x: p1.x + s.dirX * range,
          y: p1.y + s.dirZ * range,
        };

        ctx.save();
        ctx.strokeStyle = `rgba(160, 240, 255, ${alpha * 0.95})`;
        ctx.lineWidth = 8 * (1 - progress * 0.5);
        ctx.shadowColor = '#a0f0ff';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        // Tip blade diamond
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p2.x, p2.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (s.type === 'dash' && s.start && s.end) {
        // E Dash streak
        const p1 = this.worldToScreen(s.start.x, s.start.z);
        const p2 = this.worldToScreen(s.end.x, s.end.z);

        ctx.save();
        ctx.strokeStyle = `rgba(100, 230, 255, ${alpha * 0.8})`;
        ctx.lineWidth = 14 * (1 - progress * 0.5);
        ctx.shadowColor = '#64e6ff';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.restore();
      } else if (s.type === 'slash') {
        // Basic Attack melee arc slash
        const center = this.worldToScreen(s.x, s.z);
        ctx.save();
        ctx.translate(center.x, center.y);
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.95})`;
        ctx.lineWidth = 4 * (1 - progress * 0.4);
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        const startAng = -Math.PI / 3 + progress * 0.5;
        const endAng = Math.PI / 3 + progress * 0.5;
        ctx.arc(0, 0, 24 * this.scale * 0.05, startAng, endAng);
        ctx.stroke();
        ctx.restore();
      } else if (s.type === 'ult') {
        // R Last Breath multi criss-cross slashes
        const center = this.worldToScreen(s.x, s.z);
        ctx.save();
        ctx.translate(center.x, center.y);

        for (let j = 0; j < 4; j++) {
          const ang = (j * Math.PI) / 4 + progress * 0.4;
          const len = 40 * this.scale * 0.04;
          ctx.strokeStyle = j % 2 === 0 ? `rgba(255, 220, 80, ${alpha})` : `rgba(255, 70, 70, ${alpha})`;
          ctx.lineWidth = 4;
          ctx.shadowColor = '#ffcc00';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.moveTo(-Math.cos(ang) * len, -Math.sin(ang) * len);
          ctx.lineTo(Math.cos(ang) * len, Math.sin(ang) * len);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  // Draw Floating Damage & Combat text
  private drawFloatingTexts() {
    const ctx = this.ctx;
    const now = Date.now();

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const t = this.floatingTexts[i];
      const elapsed = now - t.createdAt;
      const progress = elapsed / t.duration;

      if (progress >= 1) {
        this.floatingTexts.splice(i, 1);
        continue;
      }

      const pt = this.worldToScreen(t.x, t.z);
      const floatY = pt.y - 45 - progress * 35;
      const alpha = Math.max(0, 1 - progress);

      ctx.save();
      ctx.font = '900 18px Rajdhani, sans-serif';
      ctx.textAlign = 'center';

      // Outline
      ctx.strokeStyle = `rgba(0, 0, 0, ${alpha})`;
      ctx.lineWidth = 4;
      ctx.strokeText(t.text, pt.x, floatY);

      // Text
      ctx.fillStyle = t.color;
      ctx.globalAlpha = alpha;
      ctx.fillText(t.text, pt.x, floatY);
      ctx.restore();
    }
  }

  // Main 60 FPS Render Loop
  private renderLoop = () => {
    if (this.isDisposed) return;

    this.tornadoRotation += 0.08;

    // 1. Draw Arena Ground
    this.drawArena();

    // 2. Draw Move Click Ping
    this.drawMoveClick();

    // 3. Draw WindWalls
    for (const wall of this.windwalls) {
      this.drawWindWall(wall);
    }

    // 4. Draw Projectiles (Q3 Tornado)
    for (const proj of this.projectiles) {
      this.drawProjectile(proj);
    }

    // 5. Draw Visual Slashes & Dashes
    this.drawVisualSlashes();

    // 6. Draw Players (Blue & Red)
    for (const pid in this.players) {
      this.drawPlayer(this.players[pid]);
    }

    // 7. Draw Floating Damage Text
    this.drawFloatingTexts();

    this.animFrameId = requestAnimationFrame(this.renderLoop);
  };

  public dispose() {
    this.isDisposed = true;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
    }
    window.removeEventListener('resize', this.resize);
  }
}
