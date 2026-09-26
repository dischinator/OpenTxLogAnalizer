import { SrtParser } from './srt-parser';

describe('SrtParser', () => {
  let parser: SrtParser;

  beforeEach(() => {
    parser = new SrtParser();
  });

  it('should parse DJI SRT format correctly', () => {
    const djiSample = `1
00:00:00,050 --> 00:00:00,100
signal:4 ch:1 flightTime:1 uavBat:20.3V glsBat:10.6V uavBatCells:5 glsBatCells:3 delay:23ms bitrate:50.8Mbps rcSignal:0

2
00:00:00,100 --> 00:00:00,316
signal:4 ch:1 flightTime:1 uavBat:20.3V glsBat:10.6V uavBatCells:5 glsBatCells:3 delay:29ms bitrate:50.8Mbps rcSignal:0
`;

    const log = parser.parse(djiSample);
    expect(log.rows.length).toBe(2);

    const row0 = log.rows[0];
    expect(row0.vtxSignal).toBe(4);
    expect(row0.djiSignal).toBe(4);
    expect(row0.vtxChannel).toBe(1);
    expect(row0.vtxFlightTime).toBe(1);
    expect(row0.vtxSkyBattery).toBe(20.3);
    expect(row0.vtxGoggleBattery).toBe(10.6);
    expect(row0.djiGoggleBattery).toBe(10.6);
    expect(row0.vtxDelay).toBe(23);
    expect(row0.djiDelay).toBe(23);
    expect(row0.vtxBitrate).toBe(50.8);
    expect(row0.djiBitrate).toBe(50.8);
    expect(row0.vtxRcSignal).toBe(0);
  });

  it('should parse Walksnail Avatar SRT format correctly', () => {
    const avatarSample = `1
00:00:00,000 --> 00:00:00,150
Signal:4 CH:7 FlightTime:0 SBat:11.5V GBat:12.0V Delay:36ms Bitrate:25.0Mbps Distance:0m

2
00:00:00,150 --> 00:00:00,300
Signal:4 CH:7 FlightTime:0 SBat:11.5V GBat:12.0V Delay:35ms Bitrate:25.0Mbps Distance:0m
`;

    const log = parser.parse(avatarSample);
    expect(log.rows.length).toBe(2);

    const row0 = log.rows[0];
    expect(row0.vtxSignal).toBe(4);
    expect(row0.vtxChannel).toBe(7);
    expect(row0.vtxFlightTime).toBe(0);
    expect(row0.vtxSkyBattery).toBe(11.5);
    expect(row0.vtxGoggleBattery).toBe(12.0);
    expect(row0.vtxDelay).toBe(36);
    expect(row0.vtxBitrate).toBe(25.0);
    expect(row0.vtxDistance).toBe(0);

    const row1 = log.rows[1];
    expect(row1.vtxDelay).toBe(35);
  });

  it('should parse Walksnail Ascent SRT format correctly', () => {
    const ascentSample = `1
00:00:00,000 --> 00:00:00,384
Signal:4 CH:5 Hz:5620000 FlightTime:0 Sp=31 Gp=32 SBat:16.5V GBat:11.6V Delay:198ms Bitrate:11.0Mbps Distance:1m

2
00:00:00,384 --> 00:00:00,534
Signal:4 CH:5 Hz:5620000 FlightTime:0 Sp=31 Gp=32 SBat:16.5V GBat:11.6V Delay:63ms Bitrate:21.0Mbps Distance:1m
`;

    const log = parser.parse(ascentSample);
    expect(log.rows.length).toBe(2);

    const row0 = log.rows[0];
    expect(row0.vtxSignal).toBe(4);
    expect(row0.vtxChannel).toBe(5);
    expect(row0.vtxFrequency).toBe(5620000);
    expect(row0.vtxFlightTime).toBe(0);
    expect(row0.vtxPower).toBe(31);
    expect(row0.vtxGroundPower).toBe(32);
    expect(row0.vtxSkyBattery).toBe(16.5);
    expect(row0.vtxGoggleBattery).toBe(11.6);
    expect(row0.vtxDelay).toBe(198);
    expect(row0.vtxBitrate).toBe(11.0);
    expect(row0.vtxDistance).toBe(1);

    const row1 = log.rows[1];
    expect(row1.vtxDelay).toBe(63);
    expect(row1.vtxBitrate).toBe(21.0);
  });
});
