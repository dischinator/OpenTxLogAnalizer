import {AfterViewInit, Component, OnDestroy, OnInit} from '@angular/core';
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
    ::ng-deep .otx-map-badge-marker {
      background: transparent;
      border: none;
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
    if (this.myMap) {
      this.myMap.remove();
      this.myMap = undefined;
    }
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
