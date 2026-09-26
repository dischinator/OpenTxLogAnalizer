import { AssGenerator } from './ass-generator.service';
import { ILog } from './open-tx-log-parser';

describe('AssGenerator', () => {
  let generator: AssGenerator;

  beforeEach(() => {
    generator = new AssGenerator();
  });

  it('should handle missing variables and missing stats without throwing', () => {
    const emptyLog: ILog = {
      timestamp: undefined,
      rows: [
        { timecode: 1 } as any
      ],
      stats: {} as any,
      capacityUsed: 0,
      powerUsed: 0,
      correction: 1,
      powerAvailable: 0
    };

    // Test with missing fields in template: default, padded, and bar format
    const template = `#!x:10,y:710,font:Courier New,fontSize:30,color:ffffff
|VTX|{vtxDelay,8}ms | {vtxDelay,10,bar} | {missingField} |`;

    expect(() => {
      const result = generator.exportAss(emptyLog, template);
      expect(result).toBeDefined();
      expect(result).toContain('----------'); // 10 dashes for bar format with padding 10
      expect(result).toContain('        ms'); // 8 spaces padding preserved
    }).not.toThrow();
  });
});
