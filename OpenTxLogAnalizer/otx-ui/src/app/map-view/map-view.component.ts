import {AfterViewInit, Component, HostListener, OnDestroy, OnInit} from '@angular/core';
import {PersistenceService} from "../../services/persistence.service";
import {DataManager} from "../../services/data-manager";
import {StatTriple} from "../../services/IStats";
import {LogRow} from "../../services/open-tx-log-parser";
import * as L from 'leaflet';
import {Subscription} from "rxjs";

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
        <div class="mb-3">
          <div class="d-flex gap-1">
            <button class="btn btn-sm flex-grow-1"
                    [class.btn-warning]="measuring"
                    [class.btn-outline-primary]="!measuring"
                    (click)="toggleMeasure()">
              <span *ngIf="!measuring && measurePoints.length === 0">📏 Entfernung messen</span>
              <span *ngIf="!measuring && measurePoints.length > 0">📏 Weiter messen</span>
              <span *ngIf="measuring">✔ Messmodus beenden <small class="opacity-75">(ESC)</small></span>
            </button>
            <button *ngIf="measurePoints.length > 0"
                    class="btn btn-sm btn-outline-danger"
                    (click)="clearMeasure()"
                    title="Messung löschen">
              ✕
            </button>
          </div>
          <div *ngIf="measurePoints.length > 0" class="mt-1 text-muted text-center" style="font-size: 11px;">
            Punkte verschiebbar &bull; Rechtsklick löscht Punkt
          </div>
          <div *ngIf="measureTotal > 0" class="mt-1 text-center small">
            <strong>Gesamt: {{ formatDist(measureTotal) }}</strong>
          </div>
        </div>
      </div>
      <div class="grid-right-pane" style="display: grid">
          <div id="map" style="width: 100%; height: 100%; min-height: 400px;"></div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      flex-grow: 1;
    }
    ::ng-deep .otx-map-badge-marker,
    ::ng-deep .measure-badge-icon {
      background: transparent;
      border: none;
    }
    ::ng-deep .measure-label {
      background: rgba(255,255,255,0.95);
      color: #222;
      border: 1px solid #555;
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
      pointer-events: none;
      user-select: none;
    }
    ::ng-deep .measure-label-total {
      background: #1a73e8;
      color: #fff;
      border-color: #0d5bbd;
    }
    ::ng-deep .measure-dot-marker {
      background: transparent !important;
      border: none !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: move !important;
    }
    ::ng-deep .measure-dot-inner {
      width: 14px;
      height: 14px;
      background: #1a73e8;
      border: 2px solid #ffffff;
      border-radius: 50%;
      box-shadow: 0 2px 5px rgba(0,0,0,0.45);
      cursor: move !important;
      transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
      pointer-events: none;
    }
    ::ng-deep .measure-dot-marker:hover .measure-dot-inner {
      background: #ea4335;
      width: 18px;
      height: 18px;
      box-shadow: 0 0 0 5px rgba(234, 67, 53, 0.35), 0 3px 8px rgba(0,0,0,0.5);
    }
    ::ng-deep .measure-dot-marker.is-dragging .measure-dot-inner {
      background: #e65100;
      width: 20px;
      height: 20px;
      box-shadow: 0 0 0 6px rgba(230, 81, 0, 0.4), 0 4px 10px rgba(0,0,0,0.6);
    }
    ::ng-deep .leaflet-drag-target,
    ::ng-deep .leaflet-dragging .measure-dot-marker,
    ::ng-deep .leaflet-dragging .measure-dot-marker * {
      cursor: move !important;
    }
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

  constructor(private persistence: PersistenceService, public data: DataManager) {
    const d = persistence.mapViewPreferences ?? {selectedStat: this.stats[0].field, strokeWidth: 14};
    this.strokeWidth = d.strokeWidth!;
    this.selectedStat = [this.stats.find(x => x.field === d.selectedStat) ?? this.stats[0]];
  }

  ngOnInit(): void {
    this.logChangeSub = this.data.selectedLogChange.subscribe(() => {
      this.drawTrack(true);
    });
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    this.logChangeSub?.unsubscribe();
    this.clearMeasure();
    if (this.myMap) {
      this.myMap.remove();
      this.myMap = undefined;
    }
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
      title: 'Ziehen zum Feinjustieren, Rechtsklick zum Löschen'
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
      center: [50.1109, 8.6821],
      zoom: 12,
      layers: [osmLayer]
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

    setTimeout(() => {
      this.myMap?.invalidateSize();
      this.drawTrack(true);
    }, 100);
  }

  drawTrack(setCenter: boolean = false) {
    if (!this.data.selectedLog || !this.myMap) return;
    this.persistence.mapViewPreferences = {selectedStat: this.selectedStat[0].field, strokeWidth: this.strokeWidth};
    this.trackLayer.clearLayers();

    const validRows = this.data.selectedLog.rows.filter(x => x.lat !== undefined && x.lon !== undefined && !isNaN(x.lat) && !isNaN(x.lon));
    if (validRows.length === 0) return;

    const coords: L.LatLngTuple[] = validRows.map(x => [x.lat!, x.lon!]);

    // White background outline for high contrast
    const bgLine = L.polyline(coords, {
      color: '#FFFFFF',
      weight: parseInt(<any>this.strokeWidth) + 2,
      opacity: 0.9
    });
    this.trackLayer.addLayer(bgLine);

    if (setCenter && coords.length > 0) {
      const bounds = L.latLngBounds(coords);
      this.myMap.fitBounds(bounds, { padding: [30, 30] });
    }

    this.drawMulticolorTrack(validRows);
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
      data.sort((a,b) => b.value - a.value);
    else
      data.sort((a,b) => a.value - b.value);
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
      return {value: min, index: minIndex - 1, difference: Math.abs(min - avg)};
    else
      return {value: max, index: maxIndex - 1, difference: Math.abs(max - avg)};
  }

  private getMultiColor(value:number) {
    if (isNaN(value)|| !isFinite(value) || value < 0 || value > 1)
      return "00ff00";
    const del = 1/3;
    if (value < del) {
      return this.colorPart(value * 3) + "0000";
    }
    if (value >= del && value < del * 2) {
      const v = (value - del) * 3;
      return "ff" + this.colorPart(v) + "00";
    }
    const v = Math.round((value - del * 2) * 3 * 255 % 255)/255;
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
  {name: "Speed", field: "gpsSpeed", numberFormat: ".1f"},
  {name: "Altitude", field: "altitude", numberFormat: ".1f"},
  {name: "Cumulative Ascend", field: "cumulativeAscend", numberFormat: ".0f"},
  {name: "V Speed m/s", field: "vSpeed", numberFormat: ".1f"},
  {name: "V Speed m/s (iNav)", field: "vSpeedInav", numberFormat: ".1f"},
  {name: "3d Speed km/h", field: "3dSpeed", numberFormat: ".1f"},
  {name: "Pitch Degrees", field: "pitchDeg", numberFormat: ".1f"},
  {name: "Throttle %", field: "throttle", numberFormat: ".0f"},
  {name: "Home", field: "distanceToHome", lowIsBetter: true, numberFormat: ".0f"},
  {name: "Trip", field: "distanceTraveled", numberFormat: ".0f"},
  {name: "Sats Count", field: "sats"},
  {name: "Rx Battery", field: "rxBattery", numberFormat: ".1f"},
  {name: "Current", field: "current", lowIsBetter: true, numberFormat: ".1f"},
  {name: "Capacity", field: "capacity", lowIsBetter: true, invertOsdBar: true, numberFormat: ".0f"},
  {name: "Power", field: "power", lowIsBetter: true, numberFormat: ".1f"},
  {name: "Watt hour per km", field: "wattPerKm", lowIsBetter: true, numberFormat: ".2f"},
  {name: "Watt hour per 10 km", field: "wattPer10Km", lowIsBetter: true, numberFormat: ".1f"},
  {name: "Estimated Range", field: "estimatedRange", numberFormat: ".1f"},
  {name: "Estimated Time", field: "estimatedFlightTime", numberFormat: ".1f"},
  {name: "RSSI dbm 1", field: "rss1"},
  {name: "RSSI dbm 2", field: "rss2"},
  {name: "LQ", field: "rqly"},
  {name: "LQ CRSF", field: "rqlySum"},
  {name: "SNR", field: "rsnr"},
  {name: "Tx Power", field: "tpwr", lowIsBetter: true},
  {name: "VTX Latency", field: "vtxDelay", lowIsBetter: true, numberFormat: ".0f"},
  {name: "VTX Bitrate", field: "vtxBitrate", numberFormat: ".1f"},
  {name: "VTX Distance", field: "vtxDistance", numberFormat: ".0f"},
  {name: "VTX Sky Battery", field: "vtxSkyBattery", numberFormat: ".1f"},
  {name: "VTX Goggle Battery", field: "vtxGoggleBattery", numberFormat: ".1f"},
  {name: "VTX Power", field: "vtxPower", numberFormat: ".0f"},
  {name: "VTX Ground Power", field: "vtxGroundPower", numberFormat: ".0f"},
  {name: "DJI Latency", field: "djiDelay", lowIsBetter: true, numberFormat: ".0f"},
  {name: "DJI Bitrate", field: "djiBitrate", numberFormat: ".1f"},
];
