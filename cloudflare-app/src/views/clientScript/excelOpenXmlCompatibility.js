// ExcelJS가 일부 표준 OOXML 표현을 읽지 못하는 경우에만 브라우저에서 호환 형태로 정규화한다.
export function excelOpenXmlCompatibilityScript() {
  return `
      function excelRelationshipSourceDirectory(relationshipPath) {
        if (relationshipPath === '_rels/.rels') return [];
        var marker = '/_rels/';
        var markerIndex = relationshipPath.indexOf(marker);
        if (markerIndex < 0) return [];
        var source = relationshipPath.slice(0, markerIndex).split('/');
        source.push(relationshipPath.slice(markerIndex + marker.length, -'.rels'.length));
        source.pop();
        return source;
      }

      function excelRelativeRelationshipTarget(relationshipPath, absoluteTarget) {
        var source = excelRelationshipSourceDirectory(relationshipPath);
        var target = absoluteTarget.replace(/^\\/+/, '').split('/');
        var common = 0;
        while (common < source.length && common < target.length && source[common] === target[common]) common += 1;
        var relative = [];
        for (var index = common; index < source.length; index += 1) relative.push('..');
        return relative.concat(target.slice(common)).join('/');
      }

      async function excelNormalizeOpenXml(buffer) {
        if (!window.JSZip) return { changed: false, buffer: buffer };
        var zip = await window.JSZip.loadAsync(buffer);
        var names = Object.keys(zip.files);
        var namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
        var changed = false;
        for (var index = 0; index < names.length; index += 1) {
          var name = names[index];
          var entry = zip.files[name];
          if (!entry || entry.dir || (!name.endsWith('.xml') && !name.endsWith('.rels'))) continue;
          var original = await entry.async('string');
          var compatible = original;
          if (name.endsWith('.xml') && compatible.indexOf('xmlns:x="' + namespace + '"') >= 0) {
            compatible = compatible
              .replace(/<(\\/?)x:/g, '<$1')
              .replace(' xmlns:x="' + namespace + '"', ' xmlns="' + namespace + '"');
          }
          if (name.endsWith('.rels')) {
            compatible = compatible.replace(/Target=(["'])\\/(xl\\/[^"'#?]+)\\1/g, function (_, quote, target) {
              return 'Target=' + quote + excelRelativeRelationshipTarget(name, target) + quote;
            });
          }
          if (compatible !== original) {
            zip.file(name, compatible);
            changed = true;
          }
        }
        if (!changed) return { changed: false, buffer: buffer };
        return { changed: true, buffer: await zip.generateAsync({ type: 'arraybuffer' }) };
      }

      async function excelLoadWorkbook(buffer) {
        var workbook = new window.ExcelJS.Workbook();
        try {
          await workbook.xlsx.load(buffer);
          return workbook;
        } catch (originalError) {
          var normalized;
          try {
            normalized = await excelNormalizeOpenXml(buffer);
          } catch {
            throw originalError;
          }
          if (!normalized.changed) throw originalError;
          workbook = new window.ExcelJS.Workbook();
          try {
            await workbook.xlsx.load(normalized.buffer);
            return workbook;
          } catch (normalizedError) {
            throw new Error('엑셀 파일 구조를 읽을 수 없습니다. Excel에서 다시 저장한 뒤 시도하세요. (' + normalizedError.message + ')');
          }
        }
      }
  `;
}
