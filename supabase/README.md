# Supabase 셋업

## 1) 새 프로젝트 생성
1. https://supabase.com/dashboard 에서 새 프로젝트 만들기
2. 프로젝트 Settings → API 에서 다음 두 값 복사하여 `.env.local`에 입력
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public` 키 → `VITE_SUPABASE_ANON_KEY`

## 2) 마이그레이션 적용
**옵션 A. Supabase CLI (권장)**
```bash
npm i -g supabase
supabase login
supabase link --project-ref <YOUR-REF>
supabase db push
```

**옵션 B. Dashboard SQL Editor**
`supabase/migrations` 폴더의 `0001_schema.sql` → `0002_rls.sql` → `0003_functions.sql` → `0004_realtime.sql` 순서로 SQL Editor에 붙여넣고 실행.

## 3) Auth Hook 설정 (필수)
JWT에 `tenant_id`와 `role` claim을 주입해야 RLS가 동작합니다.

1. Dashboard → Authentication → Hooks (Beta)
2. "Custom Access Token" 활성화
3. Function: `public.set_jwt_claims` 선택 → Save

## 4) Authentication Provider
- Dashboard → Authentication → Providers
- **Email**: 활성화. "Confirm email" 옵션은 개발 중에는 꺼두는 것을 추천 (운영 시 켜기)

## 5) Realtime
`0004_realtime.sql`이 publication에 attendances, requests를 추가했습니다. Dashboard → Database → Replication 에서 `supabase_realtime` 항목 확인.

## 6) Edge Functions (3주차)
`supabase/functions/` 안의 함수들을 배포:
```bash
supabase functions deploy toss-webhook
supabase functions deploy generate-payslip
```

## 7) 동작 확인
SQL Editor에서 직접 RPC 테스트:
```sql
-- 사장 가입 시뮬 (auth.users에 행이 있다고 가정)
select bootstrap_owner('테스트사업장','office','홍길동');

-- 시프트 해상도 테스트
select * from resolve_shift('<employee_uuid>', '2026-05-11 22:30:00+09'::timestamptz);
```
