import { Component, OnInit } from '@angular/core';
import { PersistenceService } from "../../services/persistence.service";
import { knownStats, StatDesc } from "../map-view/map-view.component";
import { DataManager } from "../../services/data-manager";
import { ILogRow } from "../../services/open-tx-log-parser";
import { format } from "d3-format";

@Component({
  selector: 'otx-charts-view',
  template: `
    <div class="container-fluid flex-container flex-grow-1">
      <div class="grid-two-panes flex-grow-1">
        <div class="grid-left-pane">
          <div class="mb-3">
            <label for="formGroupExampleInput" class="form-label">X Axis</label>
            <select class="form-select" [(ngModel)]="selectedXAxisType" (change)="chartSelectionChanged()">
              <option [ngValue]="s" *ngFor="let s of xAxisTypes">{{s.name}}</option>
            </select>
          </div>
          <div class="mb-3">
            <label for="formGroupExampleInput" class="form-label">Value to draw
              <span class="badge bg-secondary" ngbTooltip="Ctrl+Click to select several values at once">?</span></label>
            <select class="form-select" multiple [(ngModel)]="selectedStat" (change)="onStatSelectionChange()" [size]="15">
              <option [value]="s" *ngFor="let s of stats">{{s.name}}</option>
            </select>
          </div>

          <div class="form-check form-switch mb-1">
            <input class="form-check-input" type="checkbox" id="normalizeCheck"
                   [(ngModel)]="normalize" (change)="onNormalizeChange()">
            <label class="form-check-label" for="normalizeCheck">
              Normalisieren (0–100%)
            </label>
          </div>
          <div class="text-muted mb-3" style="font-size: 11px;">
            Skaliert Kurven relativ auf Min–Max
          </div>

          <div class="form-check form-switch mb-1">
            <input class="form-check-input" type="checkbox" id="smoothCheck"
                   [(ngModel)]="smooth" (change)="onSmoothChange()">
            <label class="form-check-label" for="smoothCheck">
              Werte glätten
            </label>
          </div>
          <div *ngIf="smooth" class="mb-3">
            <div class="d-flex justify-content-between text-muted" style="font-size: 11px;">
              <span>Fensterbreite:</span>
              <span class="fw-bold">{{smoothWindow}} Pkt.</span>
            </div>
            <input type="range" class="form-range" min="3" max="255" step="8"
                   [(ngModel)]="smoothWindow" (input)="onSmoothChange()">
          </div>

          <div *ngIf="normalize && statRanges.length > 0" class="mb-3 p-2 bg-light rounded border" style="font-size: 11px;">
            <div class="fw-bold mb-1 text-muted">Wertebereiche (0% – 100%):</div>
            <div *ngFor="let r of statRanges" class="d-flex justify-content-between mb-1">
              <span class="text-truncate me-1" [title]="r.name">{{r.name}}:</span>
              <span class="text-nowrap font-monospace">{{r.min}} &hellip; {{r.max}}</span>
            </div>
          </div>

          <otx-log-bounds-control></otx-log-bounds-control>
        </div>
        <div class="grid-right-pane" style="display: grid">
            <ngx-charts-line-chart
              [results]="results"
              [legend]="true"
              [showXAxisLabel]="true"
              [showYAxisLabel]="true"
              [xAxis]="true"
              [yAxis]="true"
              [xAxisLabel]="selectedXAxisType.name"
              [yAxisLabel]="yAxisLabel"
              [yAxisTickFormatting]="yAxisTickFormatting"
              [autoScale]="true"
              (select)="onSelect($event)"
            >
              <ng-template #seriesTooltipTemplate let-model="model">
                <div class="area-tooltip-container">
                  <div *ngFor="let item of model" class="tooltip-item">
                    <span class="tooltip-item-color" [style.background-color]="item.color"></span>
                    <span>
                      <strong>{{ item.series }}</strong>: {{ item.formattedRawValue }}
                      <span *ngIf="smooth && item.formattedRawValue !== item.formattedOriginalValue" class="text-white-50" style="font-size: 11px;"> (Roh: {{ item.formattedOriginalValue }})</span>
                      <span *ngIf="normalize" class="text-white-50" style="font-size: 11px;"> ({{ item.value | number:'1.0-1' }}%)</span>
                    </span>
                  </div>
                </div>
              </ng-template>

              <ng-template #tooltipTemplate let-model="model">
                <div class="area-tooltip-container">
                  <div class="tooltip-item">
                    <span class="tooltip-item-color" [style.background-color]="model.color"></span>
                    <span>
                      <strong>{{ model.series }}</strong>: {{ model.formattedRawValue }}
                      <span *ngIf="smooth && model.formattedRawValue !== model.formattedOriginalValue" class="text-white-50" style="font-size: 11px;"> (Roh: {{ model.formattedOriginalValue }})</span>
                      <span *ngIf="normalize" class="text-white-50" style="font-size: 11px;"> ({{ model.value | number:'1.0-1' }}%)</span>
                    </span>
                  </div>
                </div>
              </ng-template>
            </ngx-charts-line-chart>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      flex-grow: 1;
    }`
  ]
})
export class ChartsViewComponent implements OnInit {
  stats = knownStats;
  results = [];
  selectedStat: StatDesc[] = [];
  normalize = false;
  smooth = false;
  smoothWindow = 7;
  statRanges: { name: string; min: string; max: string }[] = [];

  xAxisTypes: xAxisType[] = [
    { name: "Index", field: "index" },
    { name: "Time, s", field: "timecode" },
    { name: "Trip distance, m", field: "distanceTraveled" },
    { name: "Home distance, m", field: "distanceToHome" },
  ];
  selectedXAxisType = this.xAxisTypes[0];

  constructor(private data: DataManager, private persistance: PersistenceService) {
    data.selectedLogChange.subscribe(x => this.chartSelectionChanged());
  }

  ngOnInit(): void {
    this.selectedStat = this.persistance.chartsToDraw?.map(x => this.stats.find(y => y.field == x.field)!).filter(Boolean)
      ?? [this.stats[0]];
    if (this.selectedStat.length === 0) {
      this.selectedStat = [this.stats[0]];
    }
    this.normalize = this.selectedStat.length > 1 ? true : (this.persistance.chartsNormalized ?? false);
    this.smooth = this.persistance.chartsSmoothed;
    this.smoothWindow = this.persistance.chartsSmoothWindow;
    this.chartSelectionChanged();
  }

  onStatSelectionChange(): void {
    if (this.selectedStat.length > 1) {
      this.normalize = true;
      this.persistance.chartsNormalized = true;
    } else if (this.selectedStat.length <= 1) {
      this.normalize = false;
      this.persistance.chartsNormalized = false;
    }
    this.chartSelectionChanged();
  }

  onNormalizeChange(): void {
    this.persistance.chartsNormalized = this.normalize;
    this.chartSelectionChanged();
  }

  onSmoothChange(): void {
    this.persistance.chartsSmoothed = this.smooth;
    this.persistance.chartsSmoothWindow = this.smoothWindow;
    this.chartSelectionChanged();
  }

  get yAxisLabel(): string {
    if (this.normalize) {
      return 'Normalisiert (%)';
    }
    if (this.selectedStat.length === 1) {
      return this.selectedStat[0].name;
    }
    return '';
  }

  yAxisTickFormatting = (val: number): string => {
    if (this.normalize) {
      return `${Math.round(val)}%`;
    }
    return val?.toLocaleString() ?? '';
  };

  formatStatValue(val: number, statDef?: StatDesc): string {
    if (val === undefined || val === null || isNaN(val)) {
      return "-";
    }
    if (statDef?.numberFormat) {
      try {
        return format(statDef.numberFormat)(val);
      } catch {
        // fallback
      }
    }
    if (Number.isInteger(val)) {
      return val.toString();
    }
    return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  smoothValues(values: number[], windowSize: number): number[] {
    if (values.length <= 2 || windowSize <= 1) {
      return [...values];
    }

    const result: number[] = new Array(values.length);
    const half = Math.floor(windowSize / 2);
    const n = values.length;
    const buf: number[] = [];

    for (let i = 0; i < n; i++) {
      const start = Math.max(0, i - half);
      const end = Math.min(n - 1, i + half);
      buf.length = 0;

      for (let j = start; j <= end; j++) {
        buf.push(values[j]);
      }

      const len = buf.length;
      if (len >= 5) {
        buf.sort((a, b) => a - b);
        const trim = len >= 9 ? 2 : 1;
        let sum = 0;
        const validCount = len - 2 * trim;
        for (let k = trim; k < len - trim; k++) {
          sum += buf[k];
        }
        result[i] = sum / validCount;
      } else {
        let sum = 0;
        for (let k = 0; k < len; k++) {
          sum += buf[k];
        }
        result[i] = sum / len;
      }
    }

    return result;
  }

  chartSelectionChanged() {
    this.persistance.chartsToDraw = this.selectedStat;
    const data = [];
    const rows = this.data.selectedLog?.rows ?? [];
    const ranges: { name: string; min: string; max: string }[] = [];

    for (let f of this.selectedStat) {
      const rawValues = rows.map(x => {
        const v = (<any>x)[f.field];
        return (typeof v === 'number' && !isNaN(v)) ? v : 0;
      });

      const valuesToUse = (this.smooth && rawValues.length > 0)
        ? this.smoothValues(rawValues, this.smoothWindow)
        : rawValues;

      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;

      for (const v of valuesToUse) {
        if (v < min) min = v;
        if (v > max) max = v;
      }

      if (!isFinite(min)) {
        min = 0;
        max = 0;
      }

      const diff = max - min;
      ranges.push({
        name: f.name,
        min: this.formatStatValue(min, f),
        max: this.formatStatValue(max, f)
      });

      const series = {
        name: f.name,
        series: rows.map((x, i) => {
          const raw = rawValues[i];
          const processed = valuesToUse[i];
          let val = processed;
          if (this.normalize) {
            val = diff > 0 ? ((processed - min) / diff) * 100 : (min === 0 ? 0 : 50);
            val = Math.round(val * 10) / 10;
          }
          const formattedRaw = this.formatStatValue(this.smooth ? processed : raw, f);
          const formattedOriginal = this.formatStatValue(raw, f);

          return {
            seriesName: f.name,
            index: x.index,
            name: x[this.selectedXAxisType.field],
            value: val,
            rawValue: raw,
            processedValue: processed,
            formattedRawValue: formattedRaw,
            formattedOriginalValue: formattedOriginal,
            statMin: min,
            statMax: max
          };
        })
      };
      data.push(series);
    }

    this.statRanges = ranges;
    this.results = <any>data;
  }

  onSelect($event: any) {
    if (!this.data.currentLogProject) return;
    this.data.currentLogProject.startRow = $event.index - 1;
  }
}

interface xAxisType {
  name: string;
  field: keyof ILogRow;
}
