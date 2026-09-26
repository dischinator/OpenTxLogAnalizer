import {ILogRow, Log} from "./open-tx-log-parser";
import {Injectable} from "@angular/core";
import {Duration} from "luxon";
import * as _ from "underscore";

@Injectable()
export class SrtParser {
  parse(text: string): Log {
    const normalizedText = text.replace(/\r/g, "");
    const blocks = normalizedText.split(/\n\s*\n/).filter(b => b.trim().length > 0);
    const rows: ILogRow[] = [];

    for (const block of blocks) {
      const lines = block.trim().split("\n");
      if (lines.length < 3) continue;

      const rowIndex = parseInt(lines[0].trim());
      if (isNaN(rowIndex)) continue;

      const timePart = lines[1].trim().split(" ")[0].replace(",", ".");
      let timecode = Duration.fromISOTime(timePart);
      if (!timecode.isValid) {
        timecode = Duration.fromISOTime(lines[1].trim().split(" ")[0]);
      }

      const dataLine = lines.slice(2).join(" ");
      const fields = dataLine.trim().split(/\s+/);
      const resultRow: ILogRow = {
        index: rowIndex,
        timecode: timecode.isValid ? timecode.as("seconds") : 0,
        Time: timecode
      };
      rows.push(resultRow);

      for (let f of fields) {
        const sepIdx = f.search(/[:=]/);
        if (sepIdx < 0) continue;
        const key = f.substring(0, sepIdx).trim().toLowerCase();
        const rawVal = f.substring(sepIdx + 1).trim();
        const numVal = parseFloat(rawVal);
        if (isNaN(numVal)) continue;

        switch (key) {
          case "signal":
            resultRow.vtxSignal = resultRow.djiSignal = numVal;
            break;
          case "ch":
            resultRow.vtxChannel = resultRow.djiChannel = numVal;
            break;
          case "hz":
            resultRow.vtxFrequency = numVal;
            break;
          case "flighttime":
            resultRow.vtxFlightTime = numVal;
            break;
          case "sp":
            resultRow.vtxPower = numVal;
            break;
          case "gp":
            resultRow.vtxGroundPower = numVal;
            break;
          case "sbat":
          case "uavbat":
            resultRow.vtxSkyBattery = numVal;
            break;
          case "gbat":
          case "glsbat":
            resultRow.vtxGoggleBattery = resultRow.djiGoggleBattery = numVal;
            break;
          case "delay":
            resultRow.vtxDelay = resultRow.djiDelay = numVal;
            break;
          case "bitrate":
            resultRow.vtxBitrate = resultRow.djiBitrate = numVal;
            break;
          case "distance":
            resultRow.vtxDistance = numVal;
            break;
          case "rcsignal":
            resultRow.vtxRcSignal = numVal;
            break;
        }
      }
    }

    return new Log({rows: rows, duration: _.last(rows)?.Time, capacityUsed: 0, powerUsed: 0, powerAvailable: 0, correction: 1});
  }
}
