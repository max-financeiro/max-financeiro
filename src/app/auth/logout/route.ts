import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await logAuditEvent(supabase, {
      action: 'logout',
      entityType: 'auth.users',
      entityId: user.id,
    });
  }

  await supabase.auth.signOut();

  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}

// Bloqueia GET pra evitar logout via link (CSRF-ish via image src etc)
export const GET = () =>
  NextResponse.json({ error: 'Use POST' }, { status: 405 });
