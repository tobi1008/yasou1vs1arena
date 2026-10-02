import * as THREE from 'three';
import type { PlayerState, Projectile, WindWall, CombatEvent } from '../types/game.js';
import { sound } from '../utils/audio.js';

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  onFloorClick: (point: THREE.Vector3, isRightClick: boolean) => void;
  onTargetClick?: (targetId: string) => void;
  getHoverPoint: (point: THREE.Vector3) => void;
}

interface VisualEffect {
  mesh: THREE.Object3D;
  createdAt: number;
  duration: number;
  update?: (progress: number) => void;
}

export class Game3DRenderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private floorPlane: THREE.Mesh;
  private canvas: HTMLCanvasElement;

  private playerMeshes: Map<string, THREE.Group> = new Map();
  private healthSprites: Map<string, THREE.Sprite> = new Map();
  private eCooldownRings: Map<string, THREE.Mesh> = new Map();
  private projectileMeshes: Map<string, THREE.Group> = new Map();
  private windwallMeshes: Map<string, THREE.Group> = new Map();
  private visualEffects: VisualEffect[] = [];

  private myPlayerId: string | null = null;
  private cameraOffset = new THREE.Vector3(0, 18, 14); // Isometric League of Legends style angle (~54°)
  private cameraLookTarget = new THREE.Vector3(0, 0, 0);

  private moveClickMesh: THREE.Group | null = null;
  private moveClickTime = 0;

  private onFloorClickCallback: (point: THREE.Vector3, isRightClick: boolean) => void;
  private onTargetClickCallback?: (targetId: string) => void;
  private getHoverPointCallback: (point: THREE.Vector3) => void;

  private isDisposed = false;
  private animFrameId: number | null = null;

  constructor(options: RendererOptions) {
    this.canvas = options.canvas;
    this.onFloorClickCallback = options.onFloorClick;
    this.onTargetClickCallback = options.onTargetClick;
    this.getHoverPointCallback = options.getHoverPoint;

    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0f18);
    this.scene.fog = new THREE.FogExp2(0x0a0f18, 0.016);

    // 2. Camera
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight || 1;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
    this.camera.position.set(0, 22, 17);
    this.camera.lookAt(0, 0, 0);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // 4. Lights
    this.setupLighting();

    // 5. Arena Floor & Props
    this.floorPlane = this.createArena();

    // 6. Move Click Indicator
    this.createMoveClickIndicator();

    // 7. Event Listeners
    this.setupInputs();

    // 8. Start Loop
    this.renderLoop();
  }

  public setMyPlayerId(id: string) {
    this.myPlayerId = id;
  }

  private setupLighting() {
    const ambient = new THREE.AmbientLight(0xddeeff, 0.85);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff6e6, 1.4);
    sun.position.set(15, 25, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 60;
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 22;
    sun.shadow.camera.bottom = -22;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    // Subtle colored rim lights for MOBA atmosphere
    const bluePoint = new THREE.PointLight(0x00a8ff, 1.2, 35);
    bluePoint.position.set(-14, 4, -14);
    this.scene.add(bluePoint);

    const redPoint = new THREE.PointLight(0xff3366, 1.2, 35);
    redPoint.position.set(14, 4, 14);
    this.scene.add(redPoint);
  }

  private createArena(): THREE.Mesh {
    // Arena Ground Texture Generator (Ionian Stone with Wind Runes)
    const floorSize = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = floorSize;
    canvas.height = floorSize;
    const ctx = canvas.getContext('2d')!;

    // Background gradient stone
    const grad = ctx.createRadialGradient(floorSize / 2, floorSize / 2, 80, floorSize / 2, floorSize / 2, floorSize / 2);
    grad.addColorStop(0, '#1c2438');
    grad.addColorStop(0.6, '#141a29');
    grad.addColorStop(0.9, '#0d131f');
    grad.addColorStop(1, '#080d16');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, floorSize, floorSize);

    // Stone Grid Tiles
    ctx.strokeStyle = 'rgba(70, 110, 160, 0.15)';
    ctx.lineWidth = 2;
    const tileSize = 64;
    for (let x = 0; x <= floorSize; x += tileSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, floorSize);
      ctx.stroke();
    }
    for (let y = 0; y <= floorSize; y += tileSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(floorSize, y);
      ctx.stroke();
    }

    // Concentric Arena Rings
    const center = floorSize / 2;
    [120, 240, 360, 460].forEach((r, idx) => {
      ctx.beginPath();
      ctx.arc(center, center, r, 0, Math.PI * 2);
      ctx.strokeStyle = idx === 3 ? 'rgba(212, 175, 55, 0.4)' : 'rgba(90, 160, 230, 0.25)';
      ctx.lineWidth = idx === 3 ? 6 : 3;
      ctx.stroke();
    });

    // Wind Spiral Runes in Center
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.35)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 6; a += 0.1) {
      const radius = 8 + a * 12;
      const x = center + Math.cos(a) * radius;
      const y = center + Math.sin(a) * radius;
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const floorTexture = new THREE.CanvasTexture(canvas);
    floorTexture.wrapS = THREE.ClampToEdgeWrapping;
    floorTexture.wrapT = THREE.ClampToEdgeWrapping;

    const floorGeo = new THREE.CylinderGeometry(21.5, 22, 1.2, 48);
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTexture,
      roughness: 0.6,
      metalness: 0.25,
    });

    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -0.6;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Gold Outer Rim Border
    const rimGeo = new THREE.TorusGeometry(21.6, 0.35, 12, 64);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xc8aa6e,
      roughness: 0.3,
      metalness: 0.8,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.05;
    this.scene.add(rim);

    // Decorative Pillars around the arena
    const pillarGeo = new THREE.CylinderGeometry(0.7, 0.9, 5.5, 12);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x223048,
      roughness: 0.5,
      metalness: 0.3,
    });

    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI * 2) / 8;
      const dist = 21.0;
      const px = Math.cos(angle) * dist;
      const pz = Math.sin(angle) * dist;

      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(px, 2.5, pz);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this.scene.add(pillar);

      // Torch fire light on top of pillar
      const torchLight = new THREE.PointLight(i % 2 === 0 ? 0x00c3ff : 0xff5533, 0.8, 12);
      torchLight.position.set(px, 5.5, pz);
      this.scene.add(torchLight);

      // Glowing crystal on pillar
      const gemGeo = new THREE.OctahedronGeometry(0.4, 0);
      const gemMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0x00eeff : 0xff4422,
      });
      const gem = new THREE.Mesh(gemGeo, gemMat);
      gem.position.set(px, 5.5, pz);
      this.scene.add(gem);
    }

    return floor;
  }

  private createMoveClickIndicator() {
    const group = new THREE.Group();
    // Green arrow reticle
    const ringGeo = new THREE.RingGeometry(0.5, 0.65, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x22ee77,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);

    // Cross markers
    for (let i = 0; i < 4; i++) {
      const barGeo = new THREE.PlaneGeometry(0.12, 0.4);
      const barMat = new THREE.MeshBasicMaterial({
        color: 0x22ee77,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      });
      const bar = new THREE.Mesh(barGeo, barMat);
      bar.rotation.x = -Math.PI / 2;
      bar.rotation.z = (i * Math.PI) / 2;
      bar.position.set(Math.cos((i * Math.PI) / 2) * 0.75, 0, Math.sin((i * Math.PI) / 2) * 0.75);
      group.add(bar);
    }

    group.position.set(0, -99, 0);
    this.scene.add(group);
    this.moveClickMesh = group;
  }

  public showMoveClick(x: number, z: number) {
    if (this.moveClickMesh) {
      this.moveClickMesh.position.set(x, 0.08, z);
      this.moveClickMesh.scale.set(1.2, 1.2, 1.2);
      this.moveClickTime = Date.now();
    }
  }

  private setupInputs() {
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.handleMouseAction(e, true);
    });

    this.canvas.addEventListener('click', (e) => {
      this.handleMouseAction(e, false);
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObject(this.floorPlane);
      if (intersects.length > 0) {
        this.getHoverPointCallback(intersects[0].point);
      }
    });

    window.addEventListener('resize', this.onResize);
  }

  private handleMouseAction(e: MouseEvent, isRightClick: boolean) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check click on enemy character
    const playerObjects: THREE.Object3D[] = [];
    this.playerMeshes.forEach((group, pid) => {
      if (pid !== this.myPlayerId) {
        playerObjects.push(group);
      }
    });

    const enemyIntersects = this.raycaster.intersectObjects(playerObjects, true);
    if (enemyIntersects.length > 0 && this.onTargetClickCallback) {
      // Find parent with userData
      let obj: THREE.Object3D | null = enemyIntersects[0].object;
      while (obj && !obj.userData?.playerId) {
        obj = obj.parent;
      }
      if (obj && obj.userData?.playerId) {
        this.onTargetClickCallback(obj.userData.playerId);
      }
    }

    // Floor click
    const floorIntersects = this.raycaster.intersectObject(this.floorPlane);
    if (floorIntersects.length > 0) {
      const pt = floorIntersects[0].point;
      this.onFloorClickCallback(pt, isRightClick);
      if (isRightClick) {
        this.showMoveClick(pt.x, pt.z);
        sound.playMoveClick();
      }
    }
  }

  private onResize = () => {
    if (!this.canvas) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  // Build Yasuo 3D Character Model
  private createYasuoModel(team: 'blue' | 'red', isMe: boolean): THREE.Group {
    const group = new THREE.Group();

    const mainColor = team === 'blue' ? 0x1f5eff : 0xdf2244;
    const trimColor = 0xc8aa6e;
    const steelColor = 0xb0c0d8;

    // 1. Lower Body / Hakama Pants
    const pantsGeo = new THREE.CylinderGeometry(0.38, 0.48, 1.1, 10);
    const pantsMat = new THREE.MeshStandardMaterial({
      color: 0x141822,
      roughness: 0.8,
    });
    const pants = new THREE.Mesh(pantsGeo, pantsMat);
    pants.position.y = 0.55;
    pants.castShadow = true;
    group.add(pants);

    // 2. Torso / Robe
    const torsoGeo = new THREE.CylinderGeometry(0.35, 0.36, 0.9, 10);
    const torsoMat = new THREE.MeshStandardMaterial({
      color: mainColor,
      roughness: 0.5,
      metalness: 0.1,
    });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 1.35;
    torso.castShadow = true;
    group.add(torso);

    // Sash / Belt
    const beltGeo = new THREE.TorusGeometry(0.38, 0.08, 8, 16);
    const beltMat = new THREE.MeshStandardMaterial({
      color: 0xd4a017,
      roughness: 0.4,
    });
    const belt = new THREE.Mesh(beltGeo, beltMat);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 1.05;
    group.add(belt);

    // 3. Pauldron (Left Shoulder Armor Plate - Yasuo signature)
    const pauldronGeo = new THREE.CylinderGeometry(0.24, 0.12, 0.55, 6);
    const pauldronMat = new THREE.MeshStandardMaterial({
      color: steelColor,
      metalness: 0.8,
      roughness: 0.25,
    });
    const pauldron = new THREE.Mesh(pauldronGeo, pauldronMat);
    pauldron.rotation.z = Math.PI / 3.5;
    pauldron.position.set(-0.48, 1.7, 0);
    pauldron.castShadow = true;
    group.add(pauldron);

    // 4. Head & Face
    const headGeo = new THREE.SphereGeometry(0.24, 12, 10);
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xecd0b0,
      roughness: 0.6,
    });
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 1.95;
    head.castShadow = true;
    group.add(head);

    // 5. Yasuo Ponytail Hair (High spiky curved ponytail)
    const hairMat = new THREE.MeshStandardMaterial({
      color: 0x111116,
      roughness: 0.85,
    });
    const hairGeo = new THREE.ConeGeometry(0.22, 1.05, 8);
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.rotation.x = -Math.PI / 3;
    hair.position.set(0, 2.3, -0.4);
    hair.castShadow = true;
    group.add(hair);

    // 6. Katana Sword
    const katanaGroup = new THREE.Group();
    // Blade
    const bladeGeo = new THREE.BoxGeometry(0.06, 1.6, 0.14);
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0xf0f4f8,
      metalness: 0.95,
      roughness: 0.15,
      emissive: team === 'blue' ? 0x002244 : 0x440011,
    });
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.position.y = 0.8;
    blade.castShadow = true;
    katanaGroup.add(blade);

    // Tsuba guard & Hilt
    const tsubaGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.04, 8);
    const tsubaMat = new THREE.MeshStandardMaterial({ color: trimColor, metalness: 0.8 });
    const tsuba = new THREE.Mesh(tsubaGeo, tsubaMat);
    katanaGroup.add(tsuba);

    const hiltGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.45, 8);
    const hiltMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const hilt = new THREE.Mesh(hiltGeo, hiltMat);
    hilt.position.y = -0.22;
    katanaGroup.add(hilt);

    // Position sword in right hand / ready stance
    katanaGroup.position.set(0.5, 1.2, 0.25);
    katanaGroup.rotation.x = Math.PI / 4;
    katanaGroup.rotation.z = -Math.PI / 8;
    katanaGroup.name = 'katana';
    group.add(katanaGroup);

    // 7. Base Selection Ring (Green/Gold for me, Red for enemy)
    const baseRingGeo = new THREE.RingGeometry(0.75, 0.85, 32);
    const baseRingMat = new THREE.MeshBasicMaterial({
      color: isMe ? 0x00ff88 : 0xff3344,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
    });
    const baseRing = new THREE.Mesh(baseRingGeo, baseRingMat);
    baseRing.rotation.x = -Math.PI / 2;
    baseRing.position.y = 0.02;
    group.add(baseRing);

    // 8. Wind Aura (Rotates when Q3 is ready)
    const auraGeo = new THREE.TorusGeometry(0.9, 0.08, 8, 24);
    const auraMat = new THREE.MeshBasicMaterial({
      color: 0x88eeff,
      transparent: true,
      opacity: 0,
    });
    const aura = new THREE.Mesh(auraGeo, auraMat);
    aura.rotation.x = Math.PI / 2;
    aura.position.y = 0.8;
    aura.name = 'windAura';
    group.add(aura);

    return group;
  }

  // Generate 3D Billboarding Health Bar Sprite
  private updateHealthSprite(sprite: THREE.Sprite, player: PlayerState, isMe: boolean) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 72;
    const ctx = canvas.getContext('2d')!;

    const w = 256;
    const h = 72;
    const hpRatio = Math.max(0, Math.min(1, player.hp / player.maxHp));

    // Outer Background Box
    ctx.fillStyle = 'rgba(10, 15, 25, 0.85)';
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(8, 20, w - 16, 26, 6);
    } else {
      ctx.rect(8, 20, w - 16, 26);
    }
    ctx.fill();

    // Border
    ctx.strokeStyle = isMe ? '#22ee88' : '#ff4455';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Health Bar Fill
    const barW = (w - 24) * hpRatio;
    if (barW > 0) {
      const hpGrad = ctx.createLinearGradient(12, 0, 12 + barW, 0);
      if (isMe) {
        hpGrad.addColorStop(0, '#00d26a');
        hpGrad.addColorStop(1, '#2df090');
      } else {
        hpGrad.addColorStop(0, '#c70039');
        hpGrad.addColorStop(1, '#ff4d6d');
      }
      ctx.fillStyle = hpGrad;
      ctx.fillRect(12, 23, barW, 20);

      // Tick marks every 100 HP
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      for (let i = 1; i < 10; i++) {
        const tx = 12 + (w - 24) * (i / 10);
        if (tx < 12 + barW) {
          ctx.fillRect(tx - 0.5, 23, 1.5, 20);
        }
      }
    }

    // Name Label Above Bar
    ctx.font = 'bold 13px Rajdhani, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    const displayName = `${player.name} (${Math.round(player.hp)})`;
    ctx.fillText(displayName, w / 2, 16);

    // Dead / Airborne / Stun Banner
    if (player.isDead) {
      ctx.fillStyle = 'rgba(220, 40, 40, 0.95)';
      ctx.fillRect(w / 2 - 60, 48, 120, 20);
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('ĐÃ BỊ HẠ GỤC', w / 2, 63);
    } else if (player.isAirborne) {
      ctx.fillStyle = 'rgba(255, 60, 60, 0.95)';
      ctx.fillRect(w / 2 - 50, 48, 100, 20);
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('HẤT TUNG!', w / 2, 63);
    } else if (player.qStacks === 2) {
      // Hasagi ready tag
      ctx.fillStyle = 'rgba(0, 200, 255, 0.95)';
      ctx.fillRect(w / 2 - 50, 48, 100, 20);
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('LỐC XOÁY!', w / 2, 63);
    }

    const texture = new THREE.CanvasTexture(canvas);
    sprite.material.map?.dispose();
    sprite.material.map = texture;
    sprite.material.needsUpdate = true;
  }

  // Update complete game state from server tick
  public updateGameState(
    players: Record<string, PlayerState>,
    projectiles: Projectile[],
    windwalls: WindWall[],
    recentEvents: CombatEvent[]
  ) {
    const activePlayerIds = new Set<string>();

    // 1. Sync Players
    for (const pid in players) {
      activePlayerIds.add(pid);
      const p = players[pid];
      const isMe = pid === this.myPlayerId;

      let group = this.playerMeshes.get(pid);
      if (!group) {
        group = this.createYasuoModel(p.team, isMe);
        group.userData = { playerId: pid };
        this.scene.add(group);
        this.playerMeshes.set(pid, group);

        // Add 3D health sprite
        const spriteMat = new THREE.SpriteMaterial({ transparent: true });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(3.2, 0.9, 1);
        group.add(sprite);
        this.healthSprites.set(pid, sprite);

        // Target cooldown ring (for E target indicator)
        const eRingGeo = new THREE.RingGeometry(1.2, 1.35, 32);
        const eRingMat = new THREE.MeshBasicMaterial({
          color: 0xffaa00,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0,
        });
        const eRing = new THREE.Mesh(eRingGeo, eRingMat);
        eRing.rotation.x = -Math.PI / 2;
        eRing.position.y = 0.04;
        group.add(eRing);
        this.eCooldownRings.set(pid, eRing);
      }

      // Smooth position interpolation
      group.position.x = p.x;
      group.position.z = p.z;
      group.position.y = p.isDead ? 0.2 : p.airborneHeight;
      group.rotation.y = p.rotation;
      group.rotation.x = p.isDead ? Math.PI / 2.3 : 0;

      // Update sword aura based on Q Stacks
      const aura = group.getObjectByName('windAura') as THREE.Mesh;
      if (aura && aura.material instanceof THREE.MeshBasicMaterial) {
        if (p.qStacks === 2) {
          aura.material.opacity = 0.8;
          aura.rotation.z += 0.15;
          aura.scale.set(1 + Math.sin(Date.now() * 0.01) * 0.1, 1 + Math.sin(Date.now() * 0.01) * 0.1, 1);
        } else if (p.qStacks === 1) {
          aura.material.opacity = 0.35;
          aura.rotation.z += 0.05;
        } else {
          aura.material.opacity = 0;
        }
      }

      // E Target Cooldown Ring for enemy
      const eRing = this.eCooldownRings.get(pid);
      if (eRing && eRing.material instanceof THREE.MeshBasicMaterial) {
        const myPlayer = this.myPlayerId ? players[this.myPlayerId] : null;
        const eCooldownOnThisTarget = myPlayer?.eTargetCooldowns?.[pid] || 0;
        if (eCooldownOnThisTarget > 0) {
          eRing.material.opacity = 0.8;
          eRing.rotation.z -= 0.05;
        } else {
          eRing.material.opacity = 0;
        }
      }

      // Update Health Bar Sprite
      const sprite = this.healthSprites.get(pid);
      if (sprite) {
        sprite.position.y = 3.2;
        this.updateHealthSprite(sprite, p, isMe);
      }
    }

    // Remove disconnected players
    this.playerMeshes.forEach((mesh, pid) => {
      if (!activePlayerIds.has(pid)) {
        this.scene.remove(mesh);
        this.playerMeshes.delete(pid);
        this.healthSprites.delete(pid);
        this.eCooldownRings.delete(pid);
      }
    });

    // 2. Camera tracking my player
    if (this.myPlayerId && players[this.myPlayerId]) {
      const myP = players[this.myPlayerId];
      this.cameraLookTarget.lerp(new THREE.Vector3(myP.x, 0, myP.z), 0.12);
      this.camera.position.x = this.cameraLookTarget.x + this.cameraOffset.x;
      this.camera.position.y = this.cameraOffset.y;
      this.camera.position.z = this.cameraLookTarget.z + this.cameraOffset.z;
      this.camera.lookAt(this.cameraLookTarget.x, 0, this.cameraLookTarget.z);
    }

    // 3. Projectiles (Q3 Tornado)
    const activeProjIds = new Set<string>();
    for (const proj of projectiles) {
      activeProjIds.add(proj.id);
      let pGroup = this.projectileMeshes.get(proj.id);
      if (!pGroup) {
        pGroup = this.createTornadoMesh();
        this.scene.add(pGroup);
        this.projectileMeshes.set(proj.id, pGroup);
      }
      pGroup.position.set(proj.x, 1.2, proj.z);
      // Spin tornado
      pGroup.rotation.y += 0.25;
    }

    this.projectileMeshes.forEach((mesh, id) => {
      if (!activeProjIds.has(id)) {
        this.scene.remove(mesh);
        this.projectileMeshes.delete(id);
      }
    });

    // 4. WindWalls (W Skill)
    const activeWallIds = new Set<string>();
    for (const wall of windwalls) {
      activeWallIds.add(wall.id);
      let wGroup = this.windwallMeshes.get(wall.id);
      if (!wGroup) {
        wGroup = this.createWindWallMesh(wall.width);
        this.scene.add(wGroup);
        this.windwallMeshes.set(wall.id, wGroup);
      }
      wGroup.position.set(wall.x, 1.4, wall.z);
      wGroup.rotation.y = wall.angle;

      // Fade out near end of duration
      const lifeRatio = 1 - wall.elapsed / wall.duration;
      wGroup.children.forEach((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.Material) {
          child.material.opacity = Math.min(0.8, lifeRatio * 1.2);
        }
      });
    }

    this.windwallMeshes.forEach((mesh, id) => {
      if (!activeWallIds.has(id)) {
        this.scene.remove(mesh);
        this.windwallMeshes.delete(id);
      }
    });

    // 5. Spawn recent combat events / floating damage texts
    for (const evt of recentEvents) {
      const eventAge = Date.now() - parseInt(evt.id.split('-')[1] || '0');
      if (eventAge < 100 && evt.text && evt.x !== undefined && evt.z !== undefined) {
        this.spawnFloatingText(evt.text, evt.x, evt.z, evt.type === 'airborne' ? '#ff3344' : '#ffcc00');
      }
    }
  }

  // Create 3D Tornado Mesh for Q3
  private createTornadoMesh(): THREE.Group {
    const group = new THREE.Group();
    // Multiple spiral wind rings
    const layers = 6;
    for (let i = 0; i < layers; i++) {
      const radius = 0.4 + i * 0.22;
      const ringGeo = new THREE.TorusGeometry(radius, 0.08, 8, 20);
      const ringMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0x90f0ff : 0xd0ffff,
        transparent: true,
        opacity: 0.75,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = (i - 2.5) * 0.45;
      ring.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.2;
      group.add(ring);
    }

    // Central wind vortex core
    const coreGeo = new THREE.ConeGeometry(1.4, 2.8, 12, 1, true);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0x66ddff,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.rotation.x = Math.PI; // upside down cone
    group.add(core);

    return group;
  }

  // Create 3D Wind Wall Mesh for W
  private createWindWallMesh(width: number): THREE.Group {
    const group = new THREE.Group();
    const height = 3.2;

    // Curved barrier plane
    const wallGeo = new THREE.PlaneGeometry(width, height, 16, 8);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x44d5ff,
      emissive: 0x116688,
      roughness: 0.1,
      metalness: 0.8,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
    });
    const wallMesh = new THREE.Mesh(wallGeo, wallMat);
    wallMesh.castShadow = true;
    group.add(wallMesh);

    // Glowing wind lines
    const lineGeo = new THREE.BoxGeometry(width, 0.12, 0.2);
    const lineMat = new THREE.MeshBasicMaterial({
      color: 0xb0ffff,
      transparent: true,
      opacity: 0.9,
    });
    const topBar = new THREE.Mesh(lineGeo, lineMat);
    topBar.position.y = height / 2;
    group.add(topBar);

    return group;
  }

  // Spawn visual skill slash / thrust on event
  public spawnSkillEffect(data: {
    type: string;
    ownerId: string;
    x?: number;
    z?: number;
    dirX?: number;
    dirZ?: number;
    range?: number;
    start?: { x: number; z: number };
    end?: { x: number; z: number };
  }) {
    if (data.type === 'q12_thrust' && data.x !== undefined && data.z !== undefined) {
      sound.playQThrust();
      // Fast thrust wind blade
      const range = data.range || 4.8;
      const geo = new THREE.ConeGeometry(0.7, range, 8);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xa0f0ff,
        transparent: true,
        opacity: 0.85,
      });
      const thrust = new THREE.Mesh(geo, mat);
      const nx = data.dirX || 1;
      const nz = data.dirZ || 0;
      thrust.position.set(data.x + nx * (range / 2), 1.2, data.z + nz * (range / 2));
      thrust.rotation.x = Math.PI / 2;
      thrust.rotation.z = -Math.atan2(nx, nz);

      this.scene.add(thrust);
      this.visualEffects.push({
        mesh: thrust,
        createdAt: Date.now(),
        duration: 220,
        update: (progress) => {
          mat.opacity = 0.85 * (1 - progress);
          thrust.scale.set(1 + progress * 0.5, 1, 1);
        },
      });
    } else if (data.type === 'q3_tornado') {
      sound.playQTornado();
    } else if (data.type === 'w_wall') {
      sound.playWindWall();
    } else if (data.type === 'e_dash' && data.start && data.end) {
      sound.playDash();
      // Dash speed wind ribbon
      const dx = data.end.x - data.start.x;
      const dz = data.end.z - data.start.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      const trailGeo = new THREE.PlaneGeometry(0.8, len);
      const trailMat = new THREE.MeshBasicMaterial({
        color: 0x66eeff,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      });
      const trail = new THREE.Mesh(trailGeo, trailMat);
      trail.position.set((data.start.x + data.end.x) / 2, 0.4, (data.start.z + data.end.z) / 2);
      trail.rotation.x = -Math.PI / 2;
      trail.rotation.z = Math.atan2(dx, dz);
      this.scene.add(trail);

      this.visualEffects.push({
        mesh: trail,
        createdAt: Date.now(),
        duration: 280,
        update: (progress) => {
          trailMat.opacity = 0.7 * (1 - progress);
        },
      });
    } else if (data.type === 'r_ult' && data.x !== undefined && data.z !== undefined) {
      sound.playLastBreath();
      // Multiple criss-crossing slash lines
      for (let i = 0; i < 5; i++) {
        const slashGeo = new THREE.BoxGeometry(0.1, 4.5, 0.1);
        const slashMat = new THREE.MeshBasicMaterial({
          color: 0xffdd44,
          transparent: true,
          opacity: 0.9,
        });
        const slash = new THREE.Mesh(slashGeo, slashMat);
        slash.position.set(data.x + (Math.random() - 0.5) * 1.5, 2.5 + (Math.random() - 0.5) * 1.5, data.z + (Math.random() - 0.5) * 1.5);
        slash.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        this.scene.add(slash);

        this.visualEffects.push({
          mesh: slash,
          createdAt: Date.now() + i * 50,
          duration: 350,
          update: (progress) => {
            slashMat.opacity = 0.9 * (1 - progress);
            slash.scale.set(1 + progress, 1 + progress, 1);
          },
        });
      }
    }
  }

  // Floating Combat Damage Text in 3D
  public spawnFloatingText(text: string, x: number, z: number, color = '#ffcc00') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    ctx.font = 'bold 24px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    ctx.strokeText(text, 128, 40);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 40);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2.8, 0.7, 1);
    sprite.position.set(x + (Math.random() - 0.5) * 0.8, 3.8, z + (Math.random() - 0.5) * 0.8);
    this.scene.add(sprite);

    const startY = sprite.position.y;
    this.visualEffects.push({
      mesh: sprite,
      createdAt: Date.now(),
      duration: 1000,
      update: (progress) => {
        sprite.position.y = startY + progress * 1.6;
        spriteMat.opacity = Math.max(0, 1 - progress);
      },
    });
  }

  // Main Render Loop
  private renderLoop = () => {
    if (this.isDisposed) return;

    const now = Date.now();

    // 1. Move Click Fade
    if (this.moveClickMesh && this.moveClickTime > 0) {
      const elapsed = now - this.moveClickTime;
      if (elapsed > 450) {
        this.moveClickMesh.position.y = -99;
      } else {
        const p = elapsed / 450;
        this.moveClickMesh.scale.set(1.2 - p * 0.4, 1.2 - p * 0.4, 1);
      }
    }

    // 2. Visual Effects Progress
    for (let i = this.visualEffects.length - 1; i >= 0; i--) {
      const fx = this.visualEffects[i];
      const elapsed = now - fx.createdAt;
      if (elapsed < 0) continue; // delayed start
      const progress = Math.min(1, elapsed / fx.duration);
      if (fx.update) fx.update(progress);

      if (progress >= 1) {
        this.scene.remove(fx.mesh);
        this.visualEffects.splice(i, 1);
      }
    }

    // 3. Render
    this.renderer.render(this.scene, this.camera);
    this.animFrameId = requestAnimationFrame(this.renderLoop);
  };

  public dispose() {
    this.isDisposed = true;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
    }
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}
