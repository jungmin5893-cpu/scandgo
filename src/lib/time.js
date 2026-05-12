import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import 'dayjs/locale/ko';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.locale('ko');

export const KST = 'Asia/Seoul';

export const kst = (d) => dayjs(d).tz(KST);

export const fmt = (d, pattern = 'YYYY-MM-DD HH:mm') => kst(d).format(pattern);
export const fmtTime = (d) => kst(d).format('HH:mm');
export const fmtDate = (d) => kst(d).format('YYYY-MM-DD');
export const fmtMonth = (d) => kst(d).format('YYYY년 M월');
export const fmtKor = (d) => kst(d).format('M월 D일 (dd)');

export function nowKst() { return dayjs().tz(KST); }

export function minutesToHm(min) {
  if (!min || min < 0) return '0시간 0분';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}시간 ${m}분`;
}

export function diffMinutes(a, b) {
  return Math.max(0, dayjs(b).diff(dayjs(a), 'minute'));
}

export { dayjs };
