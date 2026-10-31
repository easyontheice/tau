export type YearDesignation = "BCE" | "CE";
export type Calendar = "gregorian" | "julian";
export type DatePrecision = "year" | "month" | "day";

export type HistoricalDate = {
  year: number;
  yearDesignation: YearDesignation;
  month: number | null;
  day: number | null;
  calendar: Calendar;
  precision: DatePrecision;
};

export type HistoricalDateInput = Omit<HistoricalDate, "precision">;
export type AbsoluteDayRange = { absoluteMin: number; absoluteMax: number };
export type AbsoluteDistanceRange = { minimum: number; maximum: number };
export type SyntheticDuration = { years: number; months: number; days: number };
export type CivilDate = { year: number; month: number; day: number };

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTH_ABBREVIATIONS = MONTH_NAMES.map((name) => name.slice(0, 3));

function floorDivide(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

export function astronomicalYear(year: number, yearDesignation: YearDesignation): number {
  return yearDesignation === "CE" ? year : 1 - year;
}

export function historicalYear(year: number): Pick<HistoricalDate, "year" | "yearDesignation"> {
  return year > 0 ? { year, yearDesignation: "CE" } : { year: 1 - year, yearDesignation: "BCE" };
}

export function isLeapYear(year: number, calendar: Calendar): boolean {
  return calendar === "gregorian" ? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) : year % 4 === 0;
}

export function daysInMonth(year: number, month: number, calendar: Calendar): number {
  if (month < 1 || month > 12) throw new RangeError("Month must be between 1 and 12.");
  if (month === 2) return isLeapYear(year, calendar) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function normalizeHistoricalDate(input: HistoricalDateInput): HistoricalDate {
  if (!Number.isInteger(input.year) || input.year < 1) throw new RangeError("Year must be a positive integer.");
  if (input.day !== null && input.month === null) throw new RangeError("A day requires a month.");
  if (input.month !== null && (!Number.isInteger(input.month) || input.month < 1 || input.month > 12)) throw new RangeError("Month must be between 1 and 12.");
  const mathematicalYear = astronomicalYear(input.year, input.yearDesignation);
  if (input.day !== null && (!Number.isInteger(input.day) || input.day < 1 || input.day > daysInMonth(mathematicalYear, input.month!, input.calendar))) {
    throw new RangeError("Day is not valid for the selected month, year, and calendar.");
  }
  return {
    ...input,
    precision: input.day !== null ? "day" : input.month !== null ? "month" : "year",
  };
}

/**
 * Integer Julian day number (JDN), conventionally changing at noon UTC. It is
 * used here solely as a calendar-independent civil-day index; adding one is
 * always one civil day, including across the BCE/CE boundary.
 */
export function civilDateToAbsoluteDay(date: CivilDate, calendar: Calendar): number {
  const adjustment = floorDivide(14 - date.month, 12);
  const year = date.year + 4800 - adjustment;
  const month = date.month + 12 * adjustment - 3;
  const common = date.day + floorDivide(153 * month + 2, 5) + 365 * year + floorDivide(year, 4);
  return calendar === "gregorian" ? common - floorDivide(year, 100) + floorDivide(year, 400) - 32045 : common - 32083;
}

export function absoluteDayToGregorian(absoluteDay: number): CivilDate {
  const a = absoluteDay + 32044;
  const b = floorDivide(4 * a + 3, 146097);
  const c = a - floorDivide(146097 * b, 4);
  const d = floorDivide(4 * c + 3, 1461);
  const e = c - floorDivide(1461 * d, 4);
  const monthIndex = floorDivide(5 * e + 2, 153);
  return {
    day: e - floorDivide(153 * monthIndex + 2, 5) + 1,
    month: monthIndex + 3 - 12 * floorDivide(monthIndex, 10),
    year: 100 * b + d - 4800 + floorDivide(monthIndex, 10),
  };
}

export function absoluteDayToJulian(absoluteDay: number): CivilDate {
  const c = absoluteDay + 32082;
  const d = floorDivide(4 * c + 3, 1461);
  const e = c - floorDivide(1461 * d, 4);
  const monthIndex = floorDivide(5 * e + 2, 153);
  return {
    day: e - floorDivide(153 * monthIndex + 2, 5) + 1,
    month: monthIndex + 3 - 12 * floorDivide(monthIndex, 10),
    year: d - 4800 + floorDivide(monthIndex, 10),
  };
}

export function historicalDateRange(date: HistoricalDate): AbsoluteDayRange {
  const mathematicalYear = astronomicalYear(date.year, date.yearDesignation);
  const startMonth = date.month ?? 1;
  const endMonth = date.month ?? 12;
  const startDay = date.day ?? 1;
  const endDay = date.day ?? daysInMonth(mathematicalYear, endMonth, date.calendar);
  return {
    absoluteMin: civilDateToAbsoluteDay({ year: mathematicalYear, month: startMonth, day: startDay }, date.calendar),
    absoluteMax: civilDateToAbsoluteDay({ year: mathematicalYear, month: endMonth, day: endDay }, date.calendar),
  };
}

export function elapsedDayRange(first: AbsoluteDayRange, second: AbsoluteDayRange): AbsoluteDayRange {
  return { absoluteMin: second.absoluteMin - first.absoluteMax, absoluteMax: second.absoluteMax - first.absoluteMin };
}

export function absoluteDistanceRange(first: AbsoluteDayRange, second: AbsoluteDayRange): AbsoluteDistanceRange {
  const minimum = first.absoluteMax < second.absoluteMin
    ? second.absoluteMin - first.absoluteMax
    : second.absoluteMax < first.absoluteMin ? first.absoluteMin - second.absoluteMax : 0;
  return {
    minimum,
    maximum: Math.max(Math.abs(second.absoluteMax - first.absoluteMin), Math.abs(first.absoluteMax - second.absoluteMin)),
  };
}

export function decomposeSyntheticDuration(days: number): SyntheticDuration {
  const years = Math.floor(days / 360);
  const remainder = days % 360;
  return { years, months: Math.floor(remainder / 30), days: remainder % 30 };
}

export function formatSyntheticDuration(days: number): string {
  const duration = decomposeSyntheticDuration(days);
  return `${duration.years}y ${duration.months}m ${duration.days}d`;
}

export function convertExactCalendar(date: HistoricalDate, calendar: Calendar): HistoricalDate {
  if (date.precision !== "day" || date.month === null || date.day === null) throw new RangeError("Calendar conversion requires an exact day.");
  const absoluteDay = historicalDateRange(date).absoluteMin;
  const civil = calendar === "gregorian" ? absoluteDayToGregorian(absoluteDay) : absoluteDayToJulian(absoluteDay);
  return normalizeHistoricalDate({ ...historicalYear(civil.year), month: civil.month, day: civil.day, calendar });
}

export function absoluteDayToTimelinePosition(absoluteDay: number): number {
  const civil = absoluteDayToGregorian(absoluteDay);
  const start = civilDateToAbsoluteDay({ year: civil.year, month: 1, day: 1 }, "gregorian");
  const span = isLeapYear(civil.year, "gregorian") ? 366 : 365;
  const displayYear = civil.year > 0 ? civil.year : civil.year - 1;
  return displayYear + (absoluteDay - start) / span;
}

export function historicalDateTimelinePosition(date: HistoricalDate): number {
  const range = historicalDateRange(date);
  return absoluteDayToTimelinePosition((range.absoluteMin + range.absoluteMax) / 2);
}

export function timelinePositionToAbsoluteDay(position: number): number {
  const displayYear = position >= 1 ? Math.floor(position) : Math.floor(position);
  const civilYear = displayYear > 0 ? displayYear : displayYear + 1;
  const fraction = position - displayYear;
  const start = civilDateToAbsoluteDay({ year: civilYear, month: 1, day: 1 }, "gregorian");
  const span = isLeapYear(civilYear, "gregorian") ? 366 : 365;
  return start + Math.floor(Math.max(0, Math.min(span - 1, fraction * span)));
}

export function legacyTimelineDate(position: number): HistoricalDate {
  const absoluteDay = timelinePositionToAbsoluteDay(position);
  const civil = absoluteDayToGregorian(absoluteDay);
  return normalizeHistoricalDate({ ...historicalYear(civil.year), month: civil.month, day: civil.day, calendar: "gregorian" });
}

export function formatHistoricalDate(date: HistoricalDate, includeCalendar = false): string {
  const prefix = date.precision === "day" ? `${MONTH_NAMES[date.month! - 1]} ${date.day}, ` : date.precision === "month" ? `${MONTH_NAMES[date.month! - 1]} ` : "";
  return `${prefix}${date.year} ${date.yearDesignation}${includeCalendar ? ` · ${date.calendar === "gregorian" ? "Gregorian" : "Julian"}` : ""}`;
}
