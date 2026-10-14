export type TimeZoneMode = 'local' | 'utc';
export type TimeSelection = { mode: 'today' | 'day'; date?: string; zone: TimeZoneMode } | { mode: 'range'; start: string; end: string; zone: TimeZoneMode };
export type SearchWindow = { start: number; end: number };

function fields(value: string, time: boolean): number[] {
    const match = (time ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2})$/).exec(value);
    if (!match) throw new Error('Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss as appropriate.');
    return match.slice(1).map(Number);
}

function parts(date: Date, zone: TimeZoneMode): number[] {
    return zone === 'utc'
        ? [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
        : [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()];
}

function construct(values: number[], zone: TimeZoneMode): Date {
    const [year, month, day, hour = 0, minute = 0, second = 0] = values;
    // setFullYear avoids Date's special interpretation of years 00–99.
    const date = new Date(0);
    if (zone === 'utc') {
        date.setUTCFullYear(year, month - 1, day);
        date.setUTCHours(hour, minute, second, 0);
    } else {
        date.setFullYear(year, month - 1, day);
        date.setHours(hour, minute, second, 0);
    }
    return date;
}

function parse(value: string, zone: TimeZoneMode, time = false): Date {
    const values = fields(value, time);
    const date = construct(values, zone);
    if (!Number.isFinite(date.getTime()) || values.some((value, index) => parts(date, zone)[index] !== value)) {
        throw new Error('Invalid date or nonexistent local time.');
    }
    return date;
}

function nextMidnight(day: Date, zone: TimeZoneMode): Date {
    const values = parts(day, zone).slice(0, 3);
    values[2]++;
    return construct(values, zone);
}

function checkSeconds(value: number): number {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error('Time must be within the OpenPGP uint32 timestamp range.');
    return value;
}

export function resolveSearchWindow(selection: TimeSelection, now: Date, notBefore?: Date): SearchWindow {
    if (!Number.isFinite(now.getTime()) || (notBefore && !Number.isFinite(notBefore.getTime()))) throw new Error('Invalid clock or lower bound.');
    let start: number;
    let end: number;
    if (selection.mode === 'range') {
        start = parse(selection.start, selection.zone, true).getTime() / 1000;
        end = parse(selection.end, selection.zone, true).getTime() / 1000;
    } else {
        const today = parts(now, selection.zone).slice(0, 3).map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0')).join('-');
        const day = parse(selection.mode === 'today' ? today : selection.date ?? '', selection.zone);
        start = day.getTime() / 1000;
        end = nextMidnight(day, selection.zone).getTime() / 1000 - 1;
    }
    checkSeconds(start);
    checkSeconds(end);
    if (start > end) throw new Error('Search range is reversed.');
    end = Math.min(end, Math.floor(now.getTime() / 1000));
    if (notBefore) start = Math.max(start, Math.ceil(notBefore.getTime() / 1000));
    if (start > end) throw new Error('Search range is empty after excluding future times and times before the primary key.');
    return { start: checkSeconds(start), end: checkSeconds(end) };
}

export function resolveExpiration(date: string, zone: TimeZoneMode): Date {
    const result = nextMidnight(parse(date, zone), zone);
    checkSeconds(result.getTime() / 1000);
    return result;
}
