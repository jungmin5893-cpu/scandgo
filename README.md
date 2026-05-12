# TAGIN — B2B 출퇴근 관리 SaaS (PWA)

QR 출퇴근, 직원별·요일별 시프트 기반 근무일 컷오프, 자동 급여계산, 멀티테넌트.
무료 티어 100% (Supabase + Vercel/Netlify).

## 한 번에 보는 구조

| 영역 | 기술 |
|---|---|
| 프론트엔드 | Vanilla JS + Vite, ES 모듈 (`/src/pages/{login,owner,employee}`) |
| 백엔드 | **없음**. Supabase (PostgreSQL + Auth + Realtime + Edge Functions) |
| 인증 | Supabase Auth (이메일+비밀번호). JWT custom claim에 `tenant_id`, `role` |
| 격리 | RLS — 모든 테이블이 `tenant_id = current_tenant_id()` 정책 |
| 시프트 컷오프 | `resolve_shift(employee_id, ts)` SQL 함수 (어제 야간조 우선 검사) |
| QR | `check_in_or_out(store_id, qr_secret)` RPC가 출/퇴근 자동 판정 |
| PWA | vite-plugin-pwa (Workbox 캐시, manifest) |
| 결제 | 토스페이먼츠 + Supabase Edge Function 웹훅 |

## 빠른 시작

### 1. 패키지 설치
```bash
cd C:\Users\user\Desktop\tapin2
npm install
```

### 2. Supabase 프로젝트 셋업
1. https://supabase.com/dashboard 에서 새 프로젝트 생성 (무료)
2. **API** 메뉴에서 두 값 복사 → `.env.local`에 저장
3. `supabase/migrations/` 폴더의 SQL 4개 파일을 Dashboard SQL Editor에서 순서대로 실행:
   - `0001_schema.sql` → `0002_rls.sql` → `0003_functions.sql` → `0004_realtime.sql`
4. **Authentication → Hooks → Custom Access Token** 활성화, function으로 `public.set_jwt_claims` 선택
5. **Authentication → Providers → Email**에서 "Confirm email"은 개발 중 OFF 권장

자세한 설명: `supabase/README.md`

### 3. 환경변수
```bash
cp .env.example .env.local
# .env.local 편집:
# VITE_SUPABASE_URL=https://xxx.supabase.co
# VITE_SUPABASE_ANON_KEY=eyJ...
```

### 4. 개발 서버
```bash
npm run dev
```
- 랜딩: http://localhost:5173/index.html
- 로그인: http://localhost:5173/login.html
- 사장 대시보드: http://localhost:5173/dashboard.html
- 직원 앱: http://localhost:5173/employee.html

## 검증 시나리오

1. **사장 가입**: `/login.html` → "사장님" → "무료체험 시작" → 이름·사업장·업종·이메일·비밀번호 입력 → 대시보드 진입 (7일 D-day 배지 확인)
2. **매장 추가 + QR**: 대시보드 좌측 "매장/QR" → 매장 추가 → QR 자동 생성 → PNG 다운로드
3. **직원 초대**: "직원 관리" → 전화번호 + 매장 선택 → 6자리 가입 코드 발급
4. **직원 가입**: 다른 브라우저에서 `/login.html` → "직원" → "여기서 가입" → 전화번호+코드+비밀번호 → 직원 앱
5. **QR 출근**: 직원 앱에서 "출근하기" → QR 스캔 → "출근 완료" 토스트, 사장 대시보드에 실시간 갱신
6. **시프트 변경**: 사장 "시프트" → 시프트 타입 추가(예: 야간 22~07) → 그리드에서 직원·요일 셀 클릭 → 시프트 선택
7. **야간 검증**: 사장이 직원에게 야간조 할당 → 시스템 시계를 22:30 KST로 가정한 시각 출근 → 다음날 새벽 5시 퇴근 → DB에서 같은 `attendances` row, `workday`=출근일 확인
8. **엑셀 내보내기**: 사장 "근태 관리" → 월 선택 → 조회 → 엑셀 다운로드
9. **급여 계산**: 사장 "급여" → 집계 다시 계산 → 야간/연장 자동 분리 확인

## 핵심 SQL 함수

- `resolve_shift(employee_id, ts)` → 직원의 그 시각이 속한 시프트와 근무일 반환. 야간조면 시프트 시작일이 workday.
- `check_in_or_out(store_id, qr_secret, lat, lng)` → 클라이언트가 호출. 자동으로 출/퇴근 판정.
- `bootstrap_owner(business_name, business_type, owner_name)` → 사장 가입 직후 호출. 테넌트·프로필·기본 시프트 생성.
- `claim_employee_invite(phone, code, name)` → 직원 가입 시 코드 검증 후 프로필 생성.
- `set_jwt_claims(event)` → Auth Hook. JWT에 `tenant_id`, `role` 주입.

## 디렉토리

```
tapin2/
├── index.html              # 랜딩
├── login.html              # 통합 로그인/가입
├── dashboard.html          # 사장 대시보드 셸
├── employee.html           # 직원 앱
├── package.json
├── vite.config.js
├── public/
│   ├── manifest.json       # PWA
│   └── icons/              # 192/512 PNG (배포 전 생성 필요)
├── src/
│   ├── lib/                # supabase, auth, workday, shifts, time, toast
│   └── pages/
│       ├── login/login.js
│       ├── owner/dashboard.js + views/*
│       └── employee/employee.js
└── supabase/
    ├── migrations/         # 4개 SQL 파일
    └── functions/
        └── toss-webhook/   # 토스 결제 웹훅
```

## 다음 단계 (3주차)

- [ ] 토스 결제 위젯을 대시보드 "설정"에 통합 (`@tosspayments/payment-widget-sdk`)
- [ ] `toss-webhook` Edge Function 배포 + 환경변수 설정
- [ ] 7일 체험 만료 시 사장 대시보드에 잠금 배너 추가
- [ ] PDF 명세서 Edge Function (`pdf-lib` + 한글 폰트 임베드)
- [ ] Web Push (VAPID) — 직원 출퇴근 시 사장에게 알림
- [ ] PWA 아이콘 PNG (`public/icons/icon-192.png`, `icon-512.png`)
- [ ] Vercel/Netlify 배포 + 커스텀 도메인
- [ ] Playwright E2E 1개 (가입 → QR 체크인 → 대시보드 노출)

## 배포 (Vercel 예시)

```bash
npm run build
# vercel CLI: vercel --prod
# 또는 GitHub 연동 → 환경변수에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 등록
```

## 운영 메모

- **6 AM 컷오프**: 직원별·요일별로 결정됨. 야간조(시작>=종료) 시프트가 할당된 요일은 시프트 시작 시각이 컷오프.
- **시프트 미할당 직원**: KST 자정 기준으로 폴백.
- **시프트 변경**: 새 row를 insert하고 이전 row의 `effective_to`를 어제로 닫음 → 과거 기록은 그대로 유지.
- **동시 체크인 방지**: `attendances (employee_id, workday) where check_out_at is null` unique index로 race 차단.
