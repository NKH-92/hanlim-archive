import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { excelOpenXmlCompatibilityScript } from "../src/views/clientScript/excelOpenXmlCompatibility.js";

const HEADERS = [
  "문서번호", "개정번호", "제/개정일", "폐기 예정 년도", "문서명", "문서종류", "랙 위치 (번호)",
  "랙 위치 (열)", "랙 위치 (선반)", "랙 위치 (단면)", "태그", "비고", "상태"
];
const MAIN_NAMESPACE = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function compatibilityApi() {
  return new Function("window", `${excelOpenXmlCompatibilityScript()}; return { excelLoadWorkbook };`)({ ExcelJS, JSZip });
}

async function prefixedAbsoluteRelationshipWorkbook() {
  const source = new ExcelJS.Workbook();
  const sheet = source.addWorksheet("업로드양식");
  sheet.addTable({
    name: "UploadTable",
    ref: "A1",
    headerRow: true,
    columns: HEADERS.map((name) => ({ name })),
    rows: [["DOC-001", "Rev.0", new Date("2026-01-02T00:00:00Z"), 2031, "시험 문서", "PV", "1-02", 1, 1, "A", "원본보관", "", "active"]]
  });
  const zip = await JSZip.loadAsync(await source.xlsx.writeBuffer());
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (!entry || entry.dir) continue;
    if (name.endsWith(".xml")) {
      let xml = await entry.async("string");
      if (xml.includes(`xmlns="${MAIN_NAMESPACE}"`)) {
        xml = xml
          .replace(`xmlns="${MAIN_NAMESPACE}"`, `xmlns:x="${MAIN_NAMESPACE}"`)
          .replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)(?=[\s/>])/g, "<$1x:$2");
        zip.file(name, xml);
      }
    } else if (name === "_rels/.rels") {
      const rels = (await entry.async("string")).replace(/Target="xl\//g, 'Target="/xl/');
      zip.file(name, rels);
    } else if (name === "xl/_rels/workbook.xml.rels") {
      let rels = await entry.async("string");
      rels = rels.replace(/Target="(worksheets|styles|theme|sharedStrings)\//g, 'Target="/xl/$1/');
      rels = rels.replace(/Target="(styles|sharedStrings)\.xml/g, 'Target="/xl/$1.xml');
      zip.file(name, rels);
    } else if (name.startsWith("xl/worksheets/_rels/") && name.endsWith(".rels")) {
      const rels = (await entry.async("string")).replace(/Target="\.\.\/tables\//g, 'Target="/xl/tables/');
      zip.file(name, rels);
    }
  }
  return zip.generateAsync({ type: "arraybuffer" });
}

test("브라우저 엑셀 파서는 접두사 XML과 절대 relationship을 쓰는 유효한 XLSX도 읽는다", async () => {
  const input = await prefixedAbsoluteRelationshipWorkbook();
  const incompatible = new ExcelJS.Workbook();
  await assert.rejects(incompatible.xlsx.load(input), /undefined/);

  const { excelLoadWorkbook } = compatibilityApi();
  const workbook = await excelLoadWorkbook(input);
  const sheet = workbook.getWorksheet("업로드양식");
  assert.ok(sheet);
  assert.equal(sheet.actualRowCount, 2);
  assert.deepEqual(sheet.getRow(1).values.slice(1), HEADERS);
  assert.equal(sheet.getCell("A2").value, "DOC-001");
});

test("브라우저 엑셀 파서는 일반 ExcelJS 파일을 변경 없이 읽는다", async () => {
  const source = new ExcelJS.Workbook();
  const sheet = source.addWorksheet("문서데이터");
  sheet.addRow(HEADERS);
  sheet.addRow(["DOC-002", "Rev.1"]);

  const { excelLoadWorkbook } = compatibilityApi();
  const workbook = await excelLoadWorkbook(await source.xlsx.writeBuffer());
  assert.equal(workbook.getWorksheet("문서데이터").getCell("A2").value, "DOC-002");
});
