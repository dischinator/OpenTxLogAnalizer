import { AfterViewInit, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { PersistenceService } from "../../services/persistence.service";
import { DataManager } from "../../services/data-manager";
import { StatTriple } from "../../services/IStats";
import { LogRow } from "../../services/open-tx-log-parser";
import * as L from 'leaflet';
import './leaflet-smooth-wheel-zoom';
import { Subscription } from "rxjs";

@Component({
  selector: 'otx-map-view',
  template: `
    <div class="grid-two-panes flex-grow-1">
      <div class="grid-left-pane">
        <div class="mb-3">
          <label for="formGroupExampleInput" class="form-label">Value to draw</label>
          <select class="form-select" multiple [(ngModel)]="selectedStat" (change)="drawTrack()" [size]="15">
            <option [value]="s" *ngFor="let s of stats">{{s.name}}</option>
          </select>
        </div>
        <otx-log-bounds-control></otx-log-bounds-control>
        <div class="mb-3">
          <label for="formGroupExampleInput" class="form-label">Line Width</label>
          <select class="form-select" aria-label="Default select example" [(ngModel)]="strokeWidth" (change)="drawTrack()">
            <option [value]="4">4</option>
            <option [value]="6">6</option>
            <option [value]="8">8</option>
            <option [value]="10">10</option>
            <option [value]="12">12</option>
            <option [value]="14">14</option>
            <option [value]="16">16</option>
          </select>
        </div>

        <!-- ── Replay Section (Left Pane) ─────────────────────────────────── -->
        <div class="mb-3 border rounded p-2 bg-light">
          <button class="btn btn-sm w-100 mb-2"
                  [class.btn-success]="!replayActive"
                  [class.btn-warning]="replayActive && replayPlaying"
                  [class.btn-primary]="replayActive && !replayPlaying"
                  [disabled]="validRows.length === 0"
                  (click)="toggleReplay()">
            <span *ngIf="!replayActive">▶ Play flight</span>
            <span *ngIf="replayActive && replayPlaying">⏸ Pause</span>
            <span *ngIf="replayActive && !replayPlaying">▶ Continue</span>
          </button>

          <div *ngIf="replayActive">
            <button class="btn btn-sm btn-outline-danger w-100 mb-2" (click)="stopReplay()">
              ⏹ Stop Replay
            </button>

            <div class="form-check form-switch mb-2">
              <input class="form-check-input" type="checkbox" id="loopCheck" [(ngModel)]="replayLoop">
              <label class="form-check-label small" for="loopCheck">Loop</label>
            </div>

          </div>
        </div>

        <!-- ── Distance Measurement ──────────────────────────────────────── -->
        <div class="mb-3">
          <div class="d-flex gap-1">
            <button class="btn btn-sm flex-grow-1"
                    [class.btn-warning]="measuring"
                    [class.btn-outline-primary]="!measuring"
                    (click)="toggleMeasure()">
              <span *ngIf="!measuring && measurePoints.length === 0">📏 Measure distance</span>
              <span *ngIf="!measuring && measurePoints.length > 0">📏 Continue measuring</span>
              <span *ngIf="measuring">✔ Exit measure mode <small class="opacity-75">(ESC)</small></span>
            </button>
            <button *ngIf="measurePoints.length > 0"
                    class="btn btn-sm btn-outline-danger"
                    (click)="clearMeasure()"
                    title="Clear measurement">
              ✕
            </button>
          </div>
          <div *ngIf="measurePoints.length > 0" class="mt-1 text-muted text-center" style="font-size: 11px;">
            Drag points to adjust &bull; Right-click to delete
          </div>
          <div *ngIf="measureTotal > 0" class="mt-1 text-center small">
            <strong>Total: {{ formatDist(measureTotal) }}</strong>
          </div>
        </div>
      </div>

      <!-- ── Right Pane (Map + Overlays) ────────────────────────────────── -->
      <div class="grid-right-pane position-relative" style="display: grid; min-height: 450px;">
          <div id="map" style="width: 100%; height: 100%; min-height: 400px;"></div>

          <!-- Replay HUD Telemetry Overlay (Top Right) -->
          <div *ngIf="replayActive && replayShowHud" class="replay-hud shadow-lg"
               (click)="$event.stopPropagation()"
               (mousedown)="$event.stopPropagation()"
               (touchstart)="$event.stopPropagation()">
            <div class="replay-hud-header d-flex align-items-center justify-content-between mb-2">
              <div class="d-flex align-items-center gap-2">
                <span class="replay-status-dot" [class.playing]="replayPlaying"></span>
                <span class="replay-hud-title">TELEMETRY</span>
              </div>
              <div class="d-flex align-items-center gap-2">
                <span class="badge bg-primary bg-opacity-75 text-white" style="font-size: 10px;">{{ replaySpeed }}x</span>
                <button class="btn btn-sm btn-link text-white-50 p-0 text-decoration-none" (click)="replayShowHud = false" title="HUD ausblenden" style="line-height: 1;">✕</button>
              </div>
            </div>

            <div class="replay-hud-body">
              <div class="replay-hud-metric">
                <div class="metric-label"><span>⚡</span> SPEED</div>
                <div class="metric-val text-info">
                  {{ currentSpeed | number:'1.1-1' }} <span class="unit">km/h</span>
                </div>
              </div>
              <div class="replay-hud-metric">
                <div class="metric-label"><span>🏔️</span> ALT</div>
                <div class="metric-val text-warning">
                  {{ currentAltitude | number:'1.1-1' }} <span class="unit">m</span>
                </div>
              </div>
              <div class="replay-hud-metric">
                <div class="metric-label"><span>🔋</span> mAh</div>
                <div class="metric-val text-success">
                  {{ currentCapacity | number:'1.0-0' }} <span class="unit">mAh</span>
                </div>
              </div>
              <div class="replay-hud-metric">
                <div class="metric-label"><span>⏱️</span> TIME</div>
                <div class="metric-val text-light font-monospace" style="font-size: 13px;">
                  {{ formatTime(currentDuration) }} <span class="unit text-white-50">/ {{ formatTime(totalDuration) }}</span>
                </div>
              </div>
              <!-- Extra stats from "Value to draw" selection -->
              <ng-container *ngFor="let s of extraHudStats">
                <ng-container *ngIf="getExtraStatValue(s) !== undefined">
                  <div class="replay-hud-metric">
                    <div class="metric-label"><span>📊</span> {{ s.name | uppercase }}</div>
                    <div class="metric-val text-light">
                      {{ formatStatValue(s, getExtraStatValue(s)!) }}
                    </div>
                  </div>
                </ng-container>
              </ng-container>
            </div>
          </div>

          <!-- Show HUD Button if minimized -->
          <button *ngIf="replayActive && !replayShowHud"
                  class="btn btn-sm btn-dark position-absolute shadow"
                  style="top: 12px; right: 12px; z-index: 1100; background: rgba(22, 27, 34, 0.85); border: 1px solid rgba(255,255,255,0.25);"
                  (click)="replayShowHud = true"
                  title="HUD einblenden">
            📊 Telemetry
          </button>

          <!-- Replay Stick & Switch Monitor Overlay (Draggable) -->
          <div *ngIf="replayActive && stickMonitorVisible" class="replay-stick-monitor shadow-lg"
               [ngStyle]="{ 'top.px': stickMonitorPos.y, 'left.px': stickMonitorPos.x }"
               (click)="$event.stopPropagation()"
               (mousedown)="$event.stopPropagation()"
               (touchstart)="$event.stopPropagation()">
            <div class="replay-stick-header" (mousedown)="startMonitorDrag($event)">
              <div class="replay-stick-title">
                <span>🕹️</span>
                <span>STICKS & SCHALTER</span>
              </div>
              <button class="btn-close-monitor" (click)="stickMonitorVisible = false" title="Close stick monitor">✕</button>
            </div>

            <!-- 2 Sticks (Mode 2: Left = Throttle / Rudder, Right = Elevator / Aileron) -->
            <div class="sticks-container">
              <!-- Left Stick: Thr (Y) / Rud (X) -->
              <div class="stick-box">
                <div class="stick-label">THR / RUD</div>
                <div class="stick-pad">
                  <div class="stick-crosshair-h"></div>
                  <div class="stick-crosshair-v"></div>
                  <div class="stick-thumb"
                       [style.left.%]="getStickValue('rudder')"
                       [style.top.%]="100 - getStickValue('throttle')"></div>
                </div>
                <div class="stick-value-text">
                  T:{{ getStickValue('throttle') | number:'1.0-0' }}% R:{{ getStickValue('rudder') | number:'1.0-0' }}%
                </div>
              </div>

              <!-- Right Stick: Ele (Y) / Ail (X) -->
              <div class="stick-box">
                <div class="stick-label">ELE / AIL</div>
                <div class="stick-pad">
                  <div class="stick-crosshair-h"></div>
                  <div class="stick-crosshair-v"></div>
                  <div class="stick-thumb"
                       [style.left.%]="getStickValue('aileron')"
                       [style.top.%]="100 - getStickValue('elevator')"></div>
                </div>
                <div class="stick-value-text">
                  E:{{ getStickValue('elevator') | number:'1.0-0' }}% A:{{ getStickValue('aileron') | number:'1.0-0' }}%
                </div>
              </div>
            </div>

            <!-- Switches SA .. SH -->
            <div class="switches-container">
              <div *ngFor="let sw of switchKeys"
                   class="switch-item"
                   [class.switch-item-disabled]="!hasSwitchData(sw)">
                <div class="switch-id">{{ sw }}</div>
                <div class="switch-track">
                  <div class="switch-pos" [class.active-up]="getSwitchState(sw) === -1" title="Oben (UP)"></div>
                  <div class="switch-pos" [class.active-mid]="getSwitchState(sw) === 0" title="Mitte (MID)"></div>
                  <div class="switch-pos" [class.active-down]="getSwitchState(sw) === 1" title="Unten (DN)"></div>
                </div>
                <div class="switch-state-text"
                     [class.text-up]="getSwitchState(sw) === -1"
                     [class.text-mid]="getSwitchState(sw) === 0"
                     [class.text-down]="getSwitchState(sw) === 1">
                  {{ getSwitchText(sw) }}
                </div>
              </div>
            </div>
          </div>

          <!-- Replay Bottom Player Bar (Bottom Center) -->
          <div *ngIf="replayActive" class="replay-bottom-bar shadow-lg"
               (click)="$event.stopPropagation()"
               (mousedown)="$event.stopPropagation()"
               (touchstart)="$event.stopPropagation()"
               (wheel)="$event.stopPropagation()">
            <div class="d-flex align-items-center gap-2 w-100 flex-wrap flex-md-nowrap">
              <button class="btn btn-sm btn-outline-light border-0 py-1 px-2" (click)="restartReplay()" title="Zum Anfang">
                ⏮
              </button>
              <button class="btn btn-sm text-white py-1 px-2"
                      [class.btn-warning]="replayPlaying"
                      [class.btn-success]="!replayPlaying"
                      (click)="togglePlayPause()"
                      [title]="replayPlaying ? 'Pause' : 'Abspielen'">
                {{ replayPlaying ? '⏸' : '▶' }}
              </button>

              <span class="replay-time text-white text-nowrap font-monospace" style="font-size: 12px;">
                {{ formatTime(currentDuration) }}
              </span>

              <input type="range" class="form-range flex-grow-1 mx-1 replay-slider"
                     min="0" [max]="validRows.length > 0 ? validRows.length - 1 : 0"
                     [value]="replayCurrentIndex"
                     (input)="onScrub($event)" />

              <span class="replay-time text-white-50 text-nowrap font-monospace" style="font-size: 12px;">
                {{ formatTime(totalDuration) }}
              </span>

              <div class="btn-group btn-group-sm">
                <button *ngFor="let spd of speeds"
                        class="btn btn-sm py-0 px-2"
                        [class.btn-primary]="replaySpeed === spd"
                        [class.btn-dark]="replaySpeed !== spd"
                        (click)="setSpeed(spd)">
                  {{ spd }}x
                </button>
              </div>

              <button class="btn btn-sm py-1 px-2"
                      [class.btn-info]="replayFollowPlane"
                      [class.btn-dark]="!replayFollowPlane"
                      (click)="toggleFollowPlane()"
                      [title]="replayFollowPlane ? 'Kamera folgt Flugzeug' : 'Kamera fixiert'">
                🎯
              </button>

              <button class="btn btn-sm py-1 px-2"
                      [class.btn-success]="stickMonitorVisible"
                      [class.btn-dark]="!stickMonitorVisible"
                      (click)="toggleStickMonitor()"
                      [title]="stickMonitorVisible ? 'Stick Monitor ausblenden' : 'Stick Monitor einblenden'">
                🕹️
              </button>

              <button class="btn btn-sm btn-outline-danger border-0 py-1 px-2" (click)="stopReplay()" title="Stop replay">
                ✕
              </button>
            </div>
          </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; flex-grow: 1; }
    .grid-left-pane { max-height: calc(100vh - 120px); overflow-y: auto; padding-right: 4px; }
    .btn-xs { padding: 0.15rem 0.35rem; font-size: 0.75rem; }
  `]
})
export class MapViewComponent implements OnInit, AfterViewInit, OnDestroy {
  stats = knownStats;
  private myMap?: L.Map;
  private trackLayer: L.LayerGroup = L.layerGroup();
  selectedStat = [this.stats[0]];
  strokeWidth = 14;
  private logChangeSub?: Subscription;

  // ── Measurement state ────────────────────────────────────────────────────
  measuring = false;
  measureTotal = 0;
  measurePoints: L.LatLng[] = [];
  private measureLayer: L.LayerGroup = L.layerGroup();
  private measureMarkers: L.Marker[] = [];
  private measureLines: L.Polyline[] = [];
  private measureLabels: L.Marker[] = [];
  private measureTotalLabel?: L.Marker;
  private measurePreviewLine?: L.Polyline;
  private lastMouseLatLng?: L.LatLng;
  private isDraggingMarker = false;

  // ── Replay state ─────────────────────────────────────────────────────────
  replayActive = false;
  replayPlaying = false;
  replaySpeed = 5;
  readonly speeds: number[] = [1, 2, 5, 10, 20, 50];
  replayCurrentIndex = 0;
  replayCurrentTime = 0;
  replayFollowPlane = true;
  replayLoop = false;
  replayShowHud = true;
  validRows: LogRow[] = [];
  validCoords: L.LatLngTuple[] = [];
  currentBearing = 0;

  private replayLayer: L.LayerGroup = L.layerGroup();
  private replayBgLine?: L.Polyline;
  private replayTraveledLine?: L.Polyline;
  private replayMarker?: L.Marker;
  private animFrameId?: number;
  private lastAnimTimestamp = 0;

  private readonly onMapClick = (e: L.LeafletMouseEvent) => {
    if (this.isDraggingMarker) return;
    this.addMeasurePoint(e.latlng);
  };
  private readonly onMapMouseMove = (e: L.LeafletMouseEvent) => this.updatePreview(e.latlng);
  private readonly onMapRightClick = () => {
    if (this.measuring) {
      this.toggleMeasure();
    }
  };

  @HostListener('window:keydown.escape', ['$event'])
  onEscapeKey(event?: KeyboardEvent): void {
    if (this.measuring) {
      event?.preventDefault();
      this.toggleMeasure();
    }
  }

  @HostListener('window:mousemove', ['$event'])
  onWindowMouseMove(event: MouseEvent): void {
    if (this.isDraggingMonitor) {
      const dx = event.clientX - this.dragStartMouse.x;
      const dy = event.clientY - this.dragStartMouse.y;
      this.stickMonitorPos = {
        x: Math.max(5, this.dragStartPos.x + dx),
        y: Math.max(5, this.dragStartPos.y + dy)
      };
    }
  }

  @HostListener('window:mouseup')
  onWindowMouseUp(): void {
    if (this.isDraggingMonitor) {
      this.isDraggingMonitor = false;
    }
  }

  // ── Stick & Switch Monitor state ─────────────────────────────────────────
  stickMonitorVisible = false;
  stickMonitorPos = { x: 20, y: 70 };
  private isDraggingMonitor = false;
  private dragStartMouse = { x: 0, y: 0 };
  private dragStartPos = { x: 0, y: 0 };
  readonly switchKeys: string[] = ['SA', 'SB', 'SC', 'SD', 'SE', 'SF', 'SG', 'SH'];

  constructor(private persistence: PersistenceService, public data: DataManager) {
    const d = persistence.mapViewPreferences ?? { selectedStat: this.stats[0].field, strokeWidth: 14 };
    this.strokeWidth = d.strokeWidth!;
    this.selectedStat = [this.stats.find(x => x.field === d.selectedStat) ?? this.stats[0]];
  }

  ngOnInit(): void {
    this.logChangeSub = this.data.selectedLogChange.subscribe(() => {
      if (this.replayActive) {
        this.stopReplay();
      }
      this.drawTrack(true);
    });
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    this.logChangeSub?.unsubscribe();
    this.pauseReplay();
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = undefined;
    }
    this.clearMeasure();
    this.replayLayer.clearLayers();
    if (this.myMap) {
      this.myMap.remove();
      this.myMap = undefined;
    }
  }

  // ── Replay Getters & Telemetry ───────────────────────────────────────────
  /** Fields already shown as default HUD rows – skip these from extras */
  private readonly defaultHudFields = new Set(['gpsSpeed', '3dSpeed', 'altitude', 'capacity']);

  get currentRow(): LogRow | undefined {
    return this.validRows[this.replayCurrentIndex];
  }

  get currentSpeed(): number {
    return this.currentRow?.gpsSpeed ?? this.currentRow?.['3dSpeed'] ?? 0;
  }

  get currentAltitude(): number {
    return this.currentRow?.altitude ?? 0;
  }

  get currentCapacity(): number {
    return this.currentRow?.capacity ?? 0;
  }

  /** Selected stats that are NOT already shown as default HUD rows */
  get extraHudStats(): StatDesc[] {
    return this.selectedStat.filter(s => !this.defaultHudFields.has(s.field));
  }

  getExtraStatValue(stat: StatDesc): number | undefined {
    const v = (this.currentRow as any)?.[stat.field];
    return v !== undefined && !isNaN(v) ? v : undefined;
  }

  formatStatValue(stat: StatDesc, value: number): string {
    const fmt = stat.numberFormat;
    if (!fmt) return String(value);
    const decimals = parseInt((fmt.match(/\.?(\d+)/) ?? [])[1] ?? '0', 10);
    return value.toFixed(decimals);
  }

  get currentTimecode(): number {
    return this.getTimecode(this.replayCurrentIndex);
  }

  get startTimecode(): number {
    return this.validRows.length > 0 ? this.getTimecode(0) : 0;
  }

  get endTimecode(): number {
    return this.validRows.length > 0 ? this.getTimecode(this.validRows.length - 1) : 0;
  }

  get currentDuration(): number {
    return Math.max(0, this.currentTimecode - this.startTimecode);
  }

  get totalDuration(): number {
    return Math.max(0, this.endTimecode - this.startTimecode);
  }

  // ── Replay Controls ──────────────────────────────────────────────────────
  toggleReplay(): void {
    if (this.validRows.length === 0) return;
    if (!this.replayActive) {
      this.startReplay();
    } else if (this.replayPlaying) {
      this.pauseReplay();
    } else {
      this.resumeReplay();
    }
  }

  startReplay(): void {
    if (this.validRows.length === 0) return;
    if (this.measuring) {
      this.toggleMeasure();
    }
    this.replayActive = true;
    this.trackLayer.clearLayers();
    if (this.replayCurrentIndex >= this.validRows.length - 1) {
      this.replayCurrentIndex = 0;
      this.replayCurrentTime = this.startTimecode;
    } else {
      this.replayCurrentTime = this.currentTimecode;
    }
    this.initReplayLayers();
    this.resumeReplay();

    if (this.validCoords.length > 0 && this.myMap && this.replayCurrentIndex === 0) {
      const bounds = L.latLngBounds(this.validCoords);
      this.myMap.fitBounds(bounds, { padding: [50, 50] });
    }
  }

  stopReplay(): void {
    this.pauseReplay();
    this.replayActive = false;
    this.stickMonitorVisible = false;
    this.replayLayer.clearLayers();
    this.drawTrack(false);
  }

  toggleStickMonitor(): void {
    this.stickMonitorVisible = !this.stickMonitorVisible;
  }

  startMonitorDrag(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('.btn-close-monitor')) return;
    e.preventDefault();
    this.isDraggingMonitor = true;
    this.dragStartMouse = { x: e.clientX, y: e.clientY };
    this.dragStartPos = { ...this.stickMonitorPos };
  }

  getStickValue(axis: 'aileron' | 'elevator' | 'throttle' | 'rudder'): number {
    const row = this.currentRow;
    if (!row) return axis === 'throttle' ? 0 : 50;
    const val = row[axis];
    if (val === undefined || isNaN(val)) return axis === 'throttle' ? 0 : 50;
    return Math.max(0, Math.min(100, val));
  }

  hasSwitchData(sw: string): boolean {
    const curVal = (this.currentRow as any)?.[sw];
    if (curVal !== undefined && !isNaN(Number(curVal))) return true;
    const firstVal = (this.validRows[0] as any)?.[sw];
    return firstVal !== undefined && !isNaN(Number(firstVal));
  }

  getSwitchState(sw: string): number | undefined {
    const v = (this.currentRow as any)?.[sw];
    if (v === undefined || isNaN(Number(v))) return undefined;
    const num = Number(v);
    if (num <= -0.5) return -1;
    if (num >= 0.5) return 1;
    return 0;
  }

  getSwitchText(sw: string): string {
    const s = this.getSwitchState(sw);
    if (s === -1) return 'UP';
    if (s === 0) return 'MID';
    if (s === 1) return 'DN';
    return '-';
  }

  togglePlayPause(): void {
    if (!this.replayActive) {
      this.startReplay();
      return;
    }
    if (this.replayPlaying) {
      this.pauseReplay();
    } else {
      if (this.replayCurrentIndex >= this.validRows.length - 1) {
        this.replayCurrentIndex = 0;
        this.replayCurrentTime = this.startTimecode;
        this.updateReplayVisuals();
      }
      this.resumeReplay();
    }
  }

  restartReplay(): void {
    this.replayCurrentIndex = 0;
    this.replayCurrentTime = this.startTimecode;
    this.updateReplayVisuals();
    if (!this.replayPlaying) {
      this.resumeReplay();
    }
  }

  setSpeed(spd: number): void {
    this.replaySpeed = spd;
    this.lastAnimTimestamp = performance.now();
  }

  toggleFollowPlane(): void {
    this.replayFollowPlane = !this.replayFollowPlane;
    if (this.replayFollowPlane && this.currentRow?.lat !== undefined && this.currentRow?.lon !== undefined && this.myMap) {
      this.myMap.panTo([this.currentRow.lat, this.currentRow.lon], { animate: true, duration: 0.3 });
    }
  }

  onScrub(event: any): void {
    const idx = parseInt(event.target.value, 10);
    if (isNaN(idx)) return;
    this.replayCurrentIndex = Math.max(0, Math.min(this.validRows.length - 1, idx));
    this.replayCurrentTime = this.getTimecode(this.replayCurrentIndex);
    this.updateReplayVisuals();
  }

  private startAnimationLoop(): void {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = undefined;
    }
    this.lastAnimTimestamp = performance.now();

    const loop = (now: number) => {
      if (!this.replayPlaying) return;
      const dt = (now - this.lastAnimTimestamp) / 1000;
      this.lastAnimTimestamp = now;

      this.advanceReplay(dt * this.replaySpeed);
      this.animFrameId = requestAnimationFrame(loop);
    };

    this.animFrameId = requestAnimationFrame(loop);
  }

  private pauseReplay(): void {
    this.replayPlaying = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = undefined;
    }
  }

  private resumeReplay(): void {
    this.replayPlaying = true;
    this.lastAnimTimestamp = performance.now();
    this.startAnimationLoop();
  }

  private advanceReplay(dtSim: number): void {
    if (this.validRows.length === 0) return;
    this.replayCurrentTime += dtSim;

    const totalTime = this.endTimecode;
    if (this.replayCurrentTime >= totalTime) {
      if (this.replayLoop) {
        this.replayCurrentIndex = 0;
        this.replayCurrentTime = this.startTimecode;
      } else {
        this.replayCurrentIndex = this.validRows.length - 1;
        this.replayCurrentTime = totalTime;
        this.pauseReplay();
        this.updateReplayVisuals();
        return;
      }
    } else {
      while (
        this.replayCurrentIndex < this.validRows.length - 1 &&
        this.getTimecode(this.replayCurrentIndex + 1) <= this.replayCurrentTime
      ) {
        this.replayCurrentIndex++;
      }
    }

    this.updateReplayVisuals();
  }

  private initReplayLayers(): void {
    this.replayLayer.clearLayers();
    if (this.validRows.length === 0) return;

    this.validCoords = this.validRows.map(r => [r.lat!, r.lon!]);

    // Background track outline
    this.replayBgLine = L.polyline(this.validCoords, {
      color: '#94a3b8',
      weight: 3,
      opacity: 0.35,
      dashArray: '6 4'
    }).addTo(this.replayLayer);

    // Traveled track
    const traveled = this.validCoords.slice(0, this.replayCurrentIndex + 1);
    this.replayTraveledLine = L.polyline(traveled, {
      color: '#00e5ff',
      weight: Math.max(5, parseInt(<any>this.strokeWidth)),
      opacity: 0.95
    }).addTo(this.replayLayer);

    // Plane marker
    const curRow = this.validRows[this.replayCurrentIndex];
    const curLatLng = L.latLng(curRow.lat!, curRow.lon!);
    const bearing = this.calculateCurrentBearing();
    this.currentBearing = bearing;
    this.replayMarker = L.marker(curLatLng, {
      icon: this.createReplayPlaneIcon(bearing),
      zIndexOffset: 1000
    }).addTo(this.replayLayer);

    this.replayMarker.bindTooltip(
      () => {
        let tip = `<b>Speed:</b> ${this.currentSpeed.toFixed(1)} km/h<br/><b>Höhe:</b> ${this.currentAltitude.toFixed(1)} m<br/><b>mAh:</b> ${Math.round(this.currentCapacity)} mAh`;
        for (const s of this.extraHudStats) {
          const v = this.getExtraStatValue(s);
          if (v !== undefined) {
            tip += `<br/><b>${s.name}:</b> ${this.formatStatValue(s, v)}`;
          }
        }
        return tip;
      },
      { sticky: true }
    );
  }

  private updateReplayVisuals(): void {
    if (this.validRows.length === 0 || this.replayCurrentIndex >= this.validRows.length) return;
    const curRow = this.validRows[this.replayCurrentIndex];
    if (curRow.lat === undefined || curRow.lon === undefined) return;

    const curLatLng = L.latLng(curRow.lat, curRow.lon);

    // Update traveled line
    if (this.replayTraveledLine) {
      const traveled = this.validCoords.slice(0, this.replayCurrentIndex + 1);
      this.replayTraveledLine.setLatLngs(traveled);
    }

    // Update plane marker position and rotation
    const bearing = this.calculateCurrentBearing();
    this.currentBearing = bearing;
    if (this.replayMarker) {
      this.replayMarker.setLatLng(curLatLng);
      const wrapEl = this.replayMarker.getElement()?.querySelector('.replay-plane-wrap') as HTMLElement;
      if (wrapEl) {
        wrapEl.style.transform = `rotate(${Math.round(bearing)}deg)`;
      } else {
        this.replayMarker.setIcon(this.createReplayPlaneIcon(bearing));
      }
    }

    // Follow plane if active
    if (this.replayFollowPlane && this.myMap) {
      const bounds = this.myMap.getBounds();
      const innerBounds = bounds.pad(-0.15);
      if (!innerBounds.contains(curLatLng)) {
        this.myMap.panTo(curLatLng, { animate: true, duration: 0.25 });
      }
    }
  }

  private calculateCurrentBearing(): number {
    if (this.validRows.length < 2) return 0;
    const row = this.validRows[this.replayCurrentIndex];
    if (row.heading !== undefined && !isNaN(row.heading)) {
      return row.heading;
    }
    let p1: LogRow;
    let p2: LogRow;
    if (this.replayCurrentIndex < this.validRows.length - 1) {
      p1 = row;
      p2 = this.validRows[this.replayCurrentIndex + 1];
    } else {
      p1 = this.validRows[this.replayCurrentIndex - 1];
      p2 = row;
    }
    if (p1.lat === undefined || p1.lon === undefined || p2.lat === undefined || p2.lon === undefined) {
      return this.currentBearing;
    }
    return this.calculateBearing(p1.lat, p1.lon, p2.lat, p2.lon);
  }

  private calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    if (Math.abs(lat1 - lat2) < 0.000001 && Math.abs(lon1 - lon2) < 0.000001) {
      return this.currentBearing;
    }
    const toRad = Math.PI / 180;
    const dLon = (lon2 - lon1) * toRad;
    const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
    const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
      Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
    const brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
  }

  private createReplayPlaneIcon(bearing: number): L.DivIcon {
    return L.divIcon({
      className: 'replay-plane-marker',
      html: `
        <div class="replay-plane-wrap" style="transform: rotate(${Math.round(bearing)}deg);">
          <div class="replay-plane-ping"></div>
          <svg class="replay-plane-svg" viewBox="0 0 24 24" width="34" height="34">
            <path fill="#00e5ff" stroke="#ffffff" stroke-width="1.3" stroke-linejoin="round"
                  d="M12 2 L14 9 L22 13 L22 15 L14 13.5 L14 19 L16.5 21 L16.5 22.5 L12 21.5 L7.5 22.5 L7.5 21 L10 19 L10 13.5 L2 15 L2 13 L10 9 Z"/>
          </svg>
        </div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
  }

  private getTimecode(index: number): number {
    if (index < 0 || index >= this.validRows.length) return 0;
    const row = this.validRows[index];
    if (row.timecode !== undefined && !isNaN(row.timecode)) {
      return row.timecode;
    }
    return index * 0.1;
  }

  formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const totalSecs = Math.floor(seconds);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // ── Distance measurement ─────────────────────────────────────────────────
  toggleMeasure(): void {
    if (!this.myMap) return;
    this.measuring = !this.measuring;
    if (this.measuring) {
      this.myMap.getContainer().style.cursor = 'crosshair';
      this.myMap.on('click', this.onMapClick);
      this.myMap.on('mousemove', this.onMapMouseMove);
      this.myMap.on('contextmenu', this.onMapRightClick);
    } else {
      this.myMap.getContainer().style.cursor = '';
      this.myMap.off('click', this.onMapClick);
      this.myMap.off('mousemove', this.onMapMouseMove);
      this.myMap.off('contextmenu', this.onMapRightClick);
      if (this.measurePreviewLine) {
        this.measureLayer.removeLayer(this.measurePreviewLine);
        this.measurePreviewLine = undefined;
      }
    }
  }

  clearMeasure(): void {
    if (this.measuring) {
      this.toggleMeasure();
    }
    this.measureLayer.clearLayers();
    this.measurePoints = [];
    this.measureMarkers = [];
    this.measureLines = [];
    this.measureLabels = [];
    this.measureTotalLabel = undefined;
    this.measurePreviewLine = undefined;
    this.measureTotal = 0;
  }

  private addMeasurePoint(latlng: L.LatLng): void {
    if (this.isDraggingMarker) return;
    this.measurePoints.push(latlng);
    this.rebuildMeasureLayers();
  }

  private createMeasureMarker(pt: L.LatLng, index: number): L.Marker {
    const dot = L.divIcon({
      className: 'measure-dot-marker',
      html: '<div class="measure-dot-inner"></div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    const marker = L.marker(pt, {
      icon: dot,
      draggable: true,
      title: 'Drag to adjust, right-click to delete'
    });

    marker.on('dragstart', () => {
      this.isDraggingMarker = true;
      marker.getElement()?.classList.add('is-dragging');
    });

    marker.on('drag', () => {
      this.onMarkerDrag(index, marker.getLatLng());
    });

    marker.on('dragend', () => {
      marker.getElement()?.classList.remove('is-dragging');
      this.measurePoints[index] = marker.getLatLng();
      setTimeout(() => {
        this.isDraggingMarker = false;
        this.rebuildMeasureLayers();
      }, 50);
    });

    marker.on('click', (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
    });

    marker.on('contextmenu', (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      this.measurePoints.splice(index, 1);
      this.rebuildMeasureLayers();
    });

    return marker;
  }

  private onMarkerDrag(index: number, newLatLng: L.LatLng): void {
    this.measurePoints[index] = newLatLng;

    // Update previous segment line and label
    if (index > 0 && this.measureLines[index - 1]) {
      const pPrev = this.measurePoints[index - 1];
      this.measureLines[index - 1].setLatLngs([pPrev, newLatLng]);
      const midPrev = L.latLng((pPrev.lat + newLatLng.lat) / 2, (pPrev.lng + newLatLng.lng) / 2);
      this.measureLabels[index - 1]?.setLatLng(midPrev);
      this.measureLabels[index - 1]?.setIcon(L.divIcon({
        className: 'measure-badge-icon',
        html: `<span class="measure-label">${this.formatDist(pPrev.distanceTo(newLatLng))}</span>`,
        iconAnchor: [18, 10]
      }));
    }

    // Update next segment line and label
    if (index < this.measurePoints.length - 1 && this.measureLines[index]) {
      const pNext = this.measurePoints[index + 1];
      this.measureLines[index].setLatLngs([newLatLng, pNext]);
      const midNext = L.latLng((newLatLng.lat + pNext.lat) / 2, (newLatLng.lng + pNext.lng) / 2);
      this.measureLabels[index]?.setLatLng(midNext);
      this.measureLabels[index]?.setIcon(L.divIcon({
        className: 'measure-badge-icon',
        html: `<span class="measure-label">${this.formatDist(newLatLng.distanceTo(pNext))}</span>`,
        iconAnchor: [18, 10]
      }));
    }

    // Update total
    this.updateMeasureTotal();

    // If last point was moved and preview line exists, update preview line
    if (index === this.measurePoints.length - 1 && this.measurePreviewLine && this.lastMouseLatLng) {
      this.measurePreviewLine.setLatLngs([newLatLng, this.lastMouseLatLng]);
    }
  }

  private rebuildMeasureLayers(): void {
    this.measureLayer.clearLayers();
    this.measureMarkers = [];
    this.measureLines = [];
    this.measureLabels = [];
    this.measureTotalLabel = undefined;
    this.measurePreviewLine = undefined;

    if (this.measurePoints.length === 0) {
      this.measureTotal = 0;
      return;
    }

    // 1. Lines and segment labels
    for (let i = 0; i < this.measurePoints.length - 1; i++) {
      const p1 = this.measurePoints[i];
      const p2 = this.measurePoints[i + 1];

      const line = L.polyline([p1, p2], {
        color: '#1a73e8',
        weight: 2,
        dashArray: '6 4',
        interactive: false
      }).addTo(this.measureLayer);
      this.measureLines.push(line);

      const mid = L.latLng((p1.lat + p2.lat) / 2, (p1.lng + p2.lng) / 2);
      const segDist = p1.distanceTo(p2);
      const label = L.marker(mid, {
        icon: L.divIcon({
          className: 'measure-badge-icon',
          html: `<span class="measure-label">${this.formatDist(segDist)}</span>`,
          iconAnchor: [18, 10]
        }),
        interactive: false
      }).addTo(this.measureLayer);
      this.measureLabels.push(label);
    }

    // 2. Draggable Markers
    this.measurePoints.forEach((pt, idx) => {
      const marker = this.createMeasureMarker(pt, idx);
      marker.addTo(this.measureLayer);
      this.measureMarkers.push(marker);
    });

    // 3. Total calculation & label
    this.updateMeasureTotal();

    // 4. Preview line if measuring
    if (this.measuring && this.lastMouseLatLng && this.measurePoints.length > 0) {
      const lastPt = this.measurePoints[this.measurePoints.length - 1];
      this.measurePreviewLine = L.polyline([lastPt, this.lastMouseLatLng], {
        color: '#1a73e8', weight: 2, dashArray: '4 4', opacity: 0.6, interactive: false
      }).addTo(this.measureLayer);
    }
  }

  private updateMeasureTotal(): void {
    let total = 0;
    for (let i = 0; i < this.measurePoints.length - 1; i++) {
      total += this.measurePoints[i].distanceTo(this.measurePoints[i + 1]);
    }
    this.measureTotal = total;

    if (this.measurePoints.length > 2) {
      const lastPt = this.measurePoints[this.measurePoints.length - 1];
      const totalHtml = `<span class="measure-label measure-label-total">Σ ${this.formatDist(total)}</span>`;
      if (this.measureTotalLabel) {
        this.measureTotalLabel.setLatLng(lastPt);
        this.measureTotalLabel.setIcon(L.divIcon({
          className: 'measure-badge-icon',
          html: totalHtml,
          iconAnchor: [-12, 10]
        }));
      } else {
        this.measureTotalLabel = L.marker(lastPt, {
          icon: L.divIcon({
            className: 'measure-badge-icon',
            html: totalHtml,
            iconAnchor: [-12, 10]
          }),
          interactive: false
        }).addTo(this.measureLayer);
      }
    } else if (this.measureTotalLabel) {
      this.measureLayer.removeLayer(this.measureTotalLabel);
      this.measureTotalLabel = undefined;
    }
  }

  private updatePreview(latlng: L.LatLng): void {
    this.lastMouseLatLng = latlng;
    if (!this.measuring || this.isDraggingMarker || this.measurePoints.length === 0) return;
    const prev = this.measurePoints[this.measurePoints.length - 1];
    if (this.measurePreviewLine) {
      this.measurePreviewLine.setLatLngs([prev, latlng]);
    } else {
      this.measurePreviewLine = L.polyline([prev, latlng], {
        color: '#1a73e8', weight: 2, dashArray: '4 4', opacity: 0.6, interactive: false
      }).addTo(this.measureLayer);
    }
  }

  formatDist(meters: number): string {
    if (meters >= 1000) return (meters / 1000).toFixed(2) + ' km';
    return Math.round(meters) + ' m';
  }

  private initMap(): void {
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
    });

    const esriSatLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri'
    });

    const hybridLayer = L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri'
      }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
      }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
      })
    ]);

    const openTopoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: '&copy; <a href="https://opentopomap.org" target="_blank">OpenTopoMap</a>'
    });

    this.myMap = L.map('map', {
      zoom: 12,
      layers: [osmLayer],
      scrollWheelZoom: false,
      smoothWheelZoom: true,
      smoothSensitivity: 1,
      zoomSnap: 1
    });

    const baseMaps = {
      "OpenStreetMap": osmLayer,
      "Hybrid (Sat + Straßen)": hybridLayer,
      "Satellite (Esri)": esriSatLayer,
      "Topo (OpenTopoMap)": openTopoLayer
    };

    L.control.layers(baseMaps).addTo(this.myMap!);
    this.trackLayer.addTo(this.myMap!);
    this.measureLayer.addTo(this.myMap!);
    this.replayLayer.addTo(this.myMap!);

    setTimeout(() => {
      this.myMap?.invalidateSize();
      this.drawTrack(true);
    }, 100);
  }

  drawTrack(setCenter: boolean = false) {
    if (!this.data.selectedLog || !this.myMap) return;
    this.persistence.mapViewPreferences = { selectedStat: this.selectedStat[0].field, strokeWidth: this.strokeWidth };

    this.validRows = this.data.selectedLog.rows.filter(x => x.lat !== undefined && x.lon !== undefined && !isNaN(x.lat) && !isNaN(x.lon));
    this.validCoords = this.validRows.map(x => [x.lat!, x.lon!]);

    if (this.replayActive) {
      this.replayCurrentIndex = Math.min(this.replayCurrentIndex, Math.max(0, this.validRows.length - 1));
      this.initReplayLayers();
      this.updateReplayVisuals();
      return;
    }

    this.trackLayer.clearLayers();
    if (this.validRows.length === 0) return;

    // White background outline for high contrast
    const bgLine = L.polyline(this.validCoords, {
      color: '#FFFFFF',
      weight: parseInt(<any>this.strokeWidth) + 2,
      opacity: 0.9
    });
    this.trackLayer.addLayer(bgLine);

    if (setCenter && this.validCoords.length > 0) {
      const bounds = L.latLngBounds(this.validCoords);
      this.myMap.fitBounds(bounds, { padding: [30, 30] });
    }

    this.drawMulticolorTrack(this.validRows);
  }

  private drawMulticolorTrack(rows: LogRow[]) {
    const selectedStat = this.selectedStat[0];
    const statData = <StatTriple>(<any>(this.data.selectedLog?.stats))?.[selectedStat.field];

    for (let i = 0; i < rows.length - 1; i++) {
      const stat = (<any>rows[i])[selectedStat.field] ?? 0;
      let statValue = 0;
      if (statData && statData.range) {
        statValue = (stat - statData.min) / statData.range;
      }
      if (selectedStat.lowIsBetter)
        statValue = 1 - statValue;
      let color = this.getMultiColor(statValue);
      if (!statData || !statData.range)
        color = "00FF00";

      const segment = L.polyline([[rows[i].lat!, rows[i].lon!], [rows[i + 1].lat!, rows[i + 1].lon!]], {
        color: '#' + color,
        weight: parseInt(<any>this.strokeWidth),
        opacity: 0.95
      });
      segment.bindTooltip(`[${i + 1}] ${stat}`, { sticky: true });
      this.trackLayer.addLayer(segment);
    }

    this.drawMarkers();
  }

  private createBadgeIcon(text: string, badgeClass: string) {
    return L.divIcon({
      className: 'otx-map-badge-marker',
      html: `<span class="badge ${badgeClass} text-white shadow-sm" style="white-space: nowrap; font-size: 11px;">${text}</span>`,
      iconSize: undefined,
      iconAnchor: [12, 10]
    });
  }

  private drawMarkers() {
    const selectedStat = this.selectedStat[0];
    const statData = <StatTriple>(<any>(this.data.selectedLog?.stats))?.[selectedStat.field];
    if (!statData) return;

    const points = this.findInterestingPoint();
    if (points.length < 2) return;

    if (points[0]?.lat !== undefined && points[0]?.lon !== undefined) {
      const minMarker = L.marker([points[0].lat, points[0].lon], {
        icon: this.createBadgeIcon(`MIN: ${statData.min}`, 'bg-success')
      }).bindPopup(`<b>MIN ${selectedStat.name}:</b> ${statData.min}`);
      this.trackLayer.addLayer(minMarker);
    }

    if (points[1]?.lat !== undefined && points[1]?.lon !== undefined) {
      const maxMarker = L.marker([points[1].lat, points[1].lon], {
        icon: this.createBadgeIcon(`MAX: ${statData.max}`, 'bg-danger')
      }).bindPopup(`<b>MAX ${selectedStat.name}:</b> ${statData.max}`);
      this.trackLayer.addLayer(maxMarker);
    }

    for (let i = 2; i < points.length; i++) {
      if (points[i]?.lat === undefined || points[i]?.lon === undefined) continue;
      const stat = (<any>points[i])[selectedStat.field] ?? 0;
      const marker = L.marker([points[i].lat!, points[i].lon!], {
        icon: this.createBadgeIcon(`${stat}`, 'bg-primary')
      }).bindPopup(`[${points[i].index}] ${selectedStat.name}: ${stat}`);
      this.trackLayer.addLayer(marker);
    }
  }

  private findInterestingPoint(pointCount: number = 10) {
    if (this.data.selectedLog!.rows.length < pointCount + 2)
      return [];
    const selectedStat = this.selectedStat[0];
    const statData = <StatTriple>(<any>(this.data.selectedLog?.stats))[selectedStat.field]!;
    const result: LogRow[] = [
      this.data.selectedLog!.rows[statData.minIndex],
      this.data.selectedLog!.rows[statData.maxIndex],
    ];
    const rows = this.data.selectedLog!.rows;
    const minSpacing = Math.round(rows.length / (pointCount + 2));
    const window = 100;
    let i = 0;
    const data = [];
    while (i + window < rows.length) {
      data.push(this.minMax(rows, i, window, statData));
      i += window / 5;
    }
    if (selectedStat.lowIsBetter)
      data.sort((a, b) => b.value - a.value);
    else
      data.sort((a, b) => a.value - b.value);
    i = 0;
    while (i < data.length && result.length < pointCount) {
      const candidate = data[i];
      if (!result.find(x => Math.abs(x.index - candidate.index) <= minSpacing)) {
        result.push(rows[candidate.index]);
      }
      i++;
    }
    return result;
  }

  private minMax(rows: LogRow[], start: number, window: number, statData: StatTriple) {
    const selectedStat = this.selectedStat[0];
    const stat = (<any>rows[start])[selectedStat.field] ?? 0;
    let min = stat, max = stat, minIndex = start, maxIndex = start, avg = stat;
    for (let i = start; i < start + window; i++) {
      let stat = (<any>rows[i])[selectedStat.field] ?? 0;
      avg += stat;
      if (min > stat) {
        min = stat;
        minIndex = i;
      }
      if (max < stat) {
        max = stat;
        maxIndex = i;
      }
    }
    avg = avg / window;
    if (Math.abs(min - avg) > Math.abs(max - avg))
      return { value: min, index: minIndex - 1, difference: Math.abs(min - avg) };
    else
      return { value: max, index: maxIndex - 1, difference: Math.abs(max - avg) };
  }

  private getMultiColor(value: number) {
    if (isNaN(value) || !isFinite(value) || value < 0 || value > 1)
      return "00ff00";
    const del = 1 / 3;
    if (value < del) {
      return this.colorPart(value * 3) + "0000";
    }
    if (value >= del && value < del * 2) {
      const v = (value - del) * 3;
      return "ff" + this.colorPart(v) + "00";
    }
    const v = Math.round((value - del * 2) * 3 * 255 % 255) / 255;
    return this.colorPart(v) + "ff00";
  }

  private colorPart(value: number) {
    const s = Math.round(value * 255).toString(16);
    if (s.length == 1)
      return "0" + s;
    return s;
  }
}

export interface MapViewPreferences {
  strokeWidth?: number;
  selectedStat?: string;
}

export interface StatDesc {
  name: string;
  field: string;
  lowIsBetter?: boolean;
  invertOsdBar?: boolean;
  numberFormat?: string;
}

export const knownStats: StatDesc[] = [
  { name: "Speed", field: "gpsSpeed", numberFormat: ".1f" },
  { name: "Altitude", field: "altitude", numberFormat: ".1f" },
  { name: "Cumulative Ascend", field: "cumulativeAscend", numberFormat: ".0f" },
  { name: "V Speed m/s", field: "vSpeed", numberFormat: ".1f" },
  { name: "V Speed m/s (iNav)", field: "vSpeedInav", numberFormat: ".1f" },
  { name: "3d Speed km/h", field: "3dSpeed", numberFormat: ".1f" },
  { name: "Pitch Degrees", field: "pitchDeg", numberFormat: ".1f" },
  { name: "Throttle %", field: "throttle", numberFormat: ".0f" },
  { name: "Home", field: "distanceToHome", lowIsBetter: true, numberFormat: ".0f" },
  { name: "Trip", field: "distanceTraveled", numberFormat: ".0f" },
  { name: "Sats Count", field: "sats" },
  { name: "Rx Battery", field: "rxBattery", numberFormat: ".1f" },
  { name: "Current", field: "current", lowIsBetter: true, numberFormat: ".1f" },
  { name: "Capacity", field: "capacity", lowIsBetter: true, invertOsdBar: true, numberFormat: ".0f" },
  { name: "Power", field: "power", lowIsBetter: true, numberFormat: ".1f" },
  { name: "Watt hour per km", field: "wattPerKm", lowIsBetter: true, numberFormat: ".2f" },
  { name: "Watt hour per 10 km", field: "wattPer10Km", lowIsBetter: true, numberFormat: ".1f" },
  { name: "Estimated Range", field: "estimatedRange", numberFormat: ".1f" },
  { name: "Estimated Time", field: "estimatedFlightTime", numberFormat: ".1f" },
  { name: "RSSI dbm 1", field: "rss1" },
  { name: "RSSI dbm 2", field: "rss2" },
  { name: "LQ", field: "rqly" },
  { name: "LQ CRSF", field: "rqlySum" },
  { name: "SNR", field: "rsnr" },
  { name: "Tx Power", field: "tpwr", lowIsBetter: true },
  { name: "VTX Latency", field: "vtxDelay", lowIsBetter: true, numberFormat: ".0f" },
  { name: "VTX Bitrate", field: "vtxBitrate", numberFormat: ".1f" },
  { name: "VTX Distance", field: "vtxDistance", numberFormat: ".0f" },
  { name: "VTX Sky Battery", field: "vtxSkyBattery", numberFormat: ".1f" },
  { name: "VTX Goggle Battery", field: "vtxGoggleBattery", numberFormat: ".1f" },
  { name: "VTX Power", field: "vtxPower", numberFormat: ".0f" },
  { name: "VTX Ground Power", field: "vtxGroundPower", numberFormat: ".0f" },
  { name: "DJI Latency", field: "djiDelay", lowIsBetter: true, numberFormat: ".0f" },
  { name: "DJI Bitrate", field: "djiBitrate", numberFormat: ".1f" },
];
