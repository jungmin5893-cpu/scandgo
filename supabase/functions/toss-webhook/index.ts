// Supabase Edge Function — 토스페이먼츠 결제 웹훅
// 배포: supabase functions deploy toss-webhook --no-verify-jwt
// 환경변수 (Dashboard → Edge Functions → toss-webhook → Settings):
//   TOSS_SECRET_KEY=test_sk_... (또는 운영 키)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (기본 주입)
//
// 토스페이먼츠 빌링키 발급/자동결제 흐름:
//   1) 클라이언트 (대시보드 결제 페이지)에서 PaymentWidget으로 카드 등록 → billingKey 발급
//   2) billingKey를 이 함수로 POST → /v1/billing/{billingKey}로 첫 결제 → subscriptions row 갱신
//   3) 매월 cron Edge Function이 billingKey로 다시 결제

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TOSS_SECRET = Deno.env.get('TOSS_SECRET_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TOSS_BASE = 'https://api.tosspayments.com';

serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  try {
    const body = await req.json();
    const { tenant_id, billingKey, customerKey, plan, amount } = body;
    if (!tenant_id || !billingKey || !customerKey) {
      return new Response(JSON.stringify({ error: 'MISSING_FIELDS' }), { status: 400, headers: cors });
    }

    // 1) 토스 빌링키로 첫 결제 실행
    const auth = 'Basic ' + btoa(`${TOSS_SECRET}:`);
    const payRes = await fetch(`${TOSS_BASE}/v1/billing/${billingKey}`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerKey,
        amount,
        orderId: `scandgo-${tenant_id}-${Date.now()}`,
        orderName: `SCAN&GO ${plan || 'standard'} 월 구독`,
      }),
    });
    const payJson = await payRes.json();
    if (!payRes.ok) {
      console.error('Toss payment failed', payJson);
      return new Response(JSON.stringify({ error: 'TOSS_FAILED', detail: payJson }), { status: 402, headers: cors });
    }

    // 2) DB 업데이트
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const periodEnd = new Date(); periodEnd.setMonth(periodEnd.getMonth() + 1);
    await supa.from('subscriptions').upsert({
      tenant_id,
      toss_billing_key: billingKey,
      toss_customer_key: customerKey,
      plan: plan || 'standard',
      amount,
      status: 'active',
      current_period_start: new Date().toISOString(),
      current_period_end: periodEnd.toISOString(),
      next_billing_at: periodEnd.toISOString(),
    }, { onConflict: 'tenant_id' });

    await supa.from('tenants').update({
      plan: plan || 'standard',
      subscription_status: 'active',
    }).eq('id', tenant_id);

    return new Response(JSON.stringify({ ok: true, payment: payJson }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors });
  }
});
