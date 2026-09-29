import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { MapViewComponent } from './map-view.component';
import { PersistenceService } from '../../services/persistence.service';
import { DataManager } from '../../services/data-manager';
import { OpenTxLogParser, LogRow } from '../../services/open-tx-log-parser';
import { Component } from '@angular/core';

@Component({
  selector: 'otx-log-bounds-control',
  template: ''
})
class MockLogBoundsControlComponent {}

describe('MapViewComponent', () => {
  let component: MapViewComponent;
  let fixture: ComponentFixture<MapViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ FormsModule ],
      declarations: [ MapViewComponent, MockLogBoundsControlComponent ],
      providers: [ PersistenceService, DataManager, OpenTxLogParser ]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(MapViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize with replay inactive and default speed 5x', () => {
    expect(component.replayActive).toBeFalse();
    expect(component.replayPlaying).toBeFalse();
    expect(component.replaySpeed).toBe(5);
    expect(component.replayFollowPlane).toBeTrue();
    expect(component.replayLoop).toBeFalse();
    expect(component.speeds).toEqual([1, 2, 5, 10, 20, 50]);
  });

  it('should format seconds to mm:ss correctly', () => {
    expect(component.formatTime(0)).toBe('00:00');
    expect(component.formatTime(65)).toBe('01:05');
    expect(component.formatTime(3600)).toBe('60:00');
    expect(component.formatTime(-5)).toBe('00:00');
  });

  it('should accurately calculate bearing between GPS coordinates', () => {
    // Due North
    const northBearing = (component as any).calculateBearing(50.0, 8.0, 51.0, 8.0);
    expect(Math.round(northBearing)).toBe(0);

    // Due East
    const eastBearing = (component as any).calculateBearing(50.0, 8.0, 50.0, 9.0);
    expect(Math.round(eastBearing)).toBe(90);

    // Due South
    const southBearing = (component as any).calculateBearing(51.0, 8.0, 50.0, 8.0);
    expect(Math.round(southBearing)).toBe(180);

    // Due West
    const westBearing = (component as any).calculateBearing(50.0, 9.0, 50.0, 8.0);
    expect(Math.round(westBearing)).toBe(270);
  });

  it('should provide telemetry values from current row', () => {
    const row1 = new LogRow({
      index: 1,
      lat: 50.1,
      lon: 8.6,
      gpsSpeed: 75.4,
      altitude: 120.5,
      capacity: 850,
      timecode: 10
    });
    const row2 = new LogRow({
      index: 2,
      lat: 50.2,
      lon: 8.7,
      gpsSpeed: 82.1,
      altitude: 135.0,
      capacity: 920,
      timecode: 15
    });

    component.validRows = [row1, row2];
    component.replayCurrentIndex = 0;

    expect(component.currentSpeed).toBe(75.4);
    expect(component.currentAltitude).toBe(120.5);
    expect(component.currentCapacity).toBe(850);
    expect(component.currentTimecode).toBe(10);
    expect(component.startTimecode).toBe(10);
    expect(component.endTimecode).toBe(15);
    expect(component.totalDuration).toBe(5);

    // Move to next point
    component.replayCurrentIndex = 1;
    expect(component.currentSpeed).toBe(82.1);
    expect(component.currentAltitude).toBe(135.0);
    expect(component.currentCapacity).toBe(920);
    expect(component.currentTimecode).toBe(15);
    expect(component.currentDuration).toBe(5);
  });

  it('should change replay speed correctly', () => {
    component.setSpeed(10);
    expect(component.replaySpeed).toBe(10);
    component.setSpeed(2);
    expect(component.replaySpeed).toBe(2);
  });

  it('should handle scrubbing', () => {
    const row1 = new LogRow({ index: 1, lat: 50.1, lon: 8.6, timecode: 0 });
    const row2 = new LogRow({ index: 2, lat: 50.2, lon: 8.7, timecode: 5 });
    const row3 = new LogRow({ index: 3, lat: 50.3, lon: 8.8, timecode: 10 });
    component.validRows = [row1, row2, row3];
    component.validCoords = [[50.1, 8.6], [50.2, 8.7], [50.3, 8.8]];

    component.onScrub({ target: { value: '2' } });
    expect(component.replayCurrentIndex).toBe(2);
    expect(component.replayCurrentTime).toBe(10);
  });
});
