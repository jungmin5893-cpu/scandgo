// 시프트 기반 "근무일(workday)" 계산 — 클라이언트 미러
// 단일 소스 진실은 DB의 resolve_shift 함수. 여기서는 표시/필터링용.
import { dayjs, kst, fmtDate } from './time.js';

/**
 * 직원의 weekday → shift_type 매핑을 받아 특정 시각이 속한 근무일을 결정.
 * @param {{weekday:number, shift:{start_time:string,end_time:string,is_overnight:boolean}|null, effective_from:string, effective_to:string|null}[]} assignments
 * @param {Date|string|dayjs.Dayjs} ts
 * @returns {{workday:string, shift_type_id?:string}|null}
 */
export function resolveShiftLocal(assignments, ts) {
  const local = kst(ts);
  const today = local.format('YYYY-MM-DD');
  const yday = local.subtract(1, 'day').format('YYYY-MM-DD');
  const ydayDow = local.subtract(1, 'day').day();
  const todayDow = local.day();
  const time = local.format('HH:mm:ss');

  const inRange = (a, dayStr) => {
    if (!a.effective_from || dayStr < a.effective_from) return false;
    if (a.effective_to && dayStr > a.effective_to) return false;
    return true;
  };

  // 1) 어제 야간조에 속하는지
  for (const a of assignments) {
    if (a.weekday !== ydayDow || !a.shift || !a.shift.is_overnight) continue;
    if (!inRange(a, yday)) continue;
    const start = dayjs.tz(`${yday}T${a.shift.start_time}`, 'Asia/Seoul');
    const end = dayjs.tz(`${today}T${a.shift.end_time}`, 'Asia/Seoul');
    if (local.isAfter(start) && local.isBefore(end)) {
      return { workday: yday, shift_type_id: a.shift.id };
    }
  }

  // 2) 오늘 시프트
  for (const a of assignments) {
    if (a.weekday !== todayDow || !a.shift) continue;
    if (!inRange(a, today)) continue;
    const s = a.shift.start_time;
    const e = a.shift.end_time;
    if (!a.shift.is_overnight && time >= s && time < e) {
      return { workday: today, shift_type_id: a.shift.id };
    }
    if (a.shift.is_overnight && time >= s) {
      return { workday: today, shift_type_id: a.shift.id };
    }
  }

  return null;
}

// 시프트 미할당 폴백
export function fallbackWorkday(ts) {
  return fmtDate(ts);
}

// 야간/주간 라벨
export function shiftLabel(shift) {
  if (!shift) return '미할당';
  return `${shift.name} (${shift.start_time.slice(0,5)}~${shift.end_time.slice(0,5)})`;
}
