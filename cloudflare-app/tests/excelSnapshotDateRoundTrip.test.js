import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

import {
  dateOnlyToUtcDate,
  excelSerialToDateOnly,
  utcDateToDateOnly
} from "../src/domains/snapshots/index.js";

const DATES = ["1900-03-01", "2024-02-29", "2026-01-01", "2026-07-20", "2026-12-31"];
const TIMEZONES = ["UTC", "Asia/Seoul", "America/Los_Angeles"];
const SNAPSHOTS_INDEX = fileURLToPath(new URL("../src/domains/snapshots/index.js", import.meta.url));

async function excelJsRoundTrip(dateOnly, { date1904 = false } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.properties.date1904 = date1904;
  const sheet = workbook.addWorksheet("문서데이터");
  const cell = sheet.getCell(1, 1);
  cell.value = dateOnlyToUtcDate(dateOnly);
  cell.numFmt = "yyyy-mm-dd";
  const buffer = await workbook.xlsx.writeBuffer();

  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer);
  const loadedCell = loaded.getWorksheet("문서데이터").getCell(1, 1);
  const value = loadedCell.value;
  if (value instanceof Date) {
    return utcDateToDateOnly(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return excelSerialToDateOnly(value, { date1904: !!loaded.properties.date1904 });
  }
  return String(value || "").trim();
}

test("날짜 전용 값은 ExcelJS workbook 왕복 후에도 YYYY-MM-DD를 보존한다", async () => {
  for (const date1904 of [false, true]) {
    for (const value of DATES) {
      const roundTripped = await excelJsRoundTrip(value, { date1904 });
      assert.equal(roundTripped, value, `date1904=${date1904} value=${value}`);
      const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
      const serial = (dateOnlyToUtcDate(value).getTime() - epoch) / 86400000;
      assert.equal(excelSerialToDateOnly(serial, { date1904 }), value);
    }
  }
});

test("Asia/Seoul·UTC·Los_Angeles 하위 프로세스에서도 ExcelJS 날짜 왕복이 동일하다", () => {
  const modulePath = SNAPSHOTS_INDEX.replace(/\\/g, "/");
  const script = `
    import assert from "node:assert/strict";
    import { pathToFileURL } from "node:url";
    import ExcelJS from "exceljs";
    const mod = await import(pathToFileURL(${JSON.stringify(modulePath)}).href);
    const { dateOnlyToUtcDate, excelSerialToDateOnly, utcDateToDateOnly } = mod;
    const dates = ${JSON.stringify(DATES)};
    for (const date1904 of [false, true]) {
      for (const value of dates) {
        const workbook = new ExcelJS.Workbook();
        workbook.properties.date1904 = date1904;
        const sheet = workbook.addWorksheet("문서데이터");
        sheet.getCell(1, 1).value = dateOnlyToUtcDate(value);
        sheet.getCell(1, 1).numFmt = "yyyy-mm-dd";
        const buffer = await workbook.xlsx.writeBuffer();
        const loaded = new ExcelJS.Workbook();
        await loaded.xlsx.load(buffer);
        const cell = loaded.getWorksheet("문서데이터").getCell(1, 1);
        let out = "";
        if (cell.value instanceof Date) out = utcDateToDateOnly(cell.value);
        else if (typeof cell.value === "number") out = excelSerialToDateOnly(cell.value, { date1904: !!loaded.properties.date1904 });
        else out = String(cell.value || "").trim();
        assert.equal(out, value, "tz=" + process.env.TZ + " date1904=" + date1904 + " value=" + value);
      }
    }
  `;
  for (const tz of TIMEZONES) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, TZ: tz },
      encoding: "utf8"
    });
    assert.equal(result.status, 0, `TZ=${tz}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  }
});
