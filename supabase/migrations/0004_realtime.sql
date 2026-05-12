-- ============================================================
-- Realtime publication: 대시보드 출퇴근 실시간 갱신
-- ============================================================
-- Supabase는 기본 publication 이름이 supabase_realtime
alter publication supabase_realtime add table attendances;
alter publication supabase_realtime add table requests;
