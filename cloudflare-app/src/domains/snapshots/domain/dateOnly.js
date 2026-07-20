// 제·개정일은 현지 자정이 아니라 calendar date다. Asia/Seoul에서도 하루가 밀리지 않게 UTC로만 왕복한다.

export function dateOnlyToUtcDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

export function utcDateToDateOnly(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function excelSerialToDateOnly(serial, { date1904 = false } = {}) {
  const number = Number(serial);
  if (!Number.isFinite(number)) return "";
  const epoch = date1904
    ? Date.UTC(1904, 0, 1)
    : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.round(number * 86400000));
  return utcDateToDateOnly(date);
}

export function isValidDateOnly(value) {
  return dateOnlyToUtcDate(value) !== null;
}
