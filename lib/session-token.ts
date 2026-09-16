import { createClient } from '@/lib/supabase-client'

/** Token di sessione Supabase da mandare come Bearer alle API interne. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await createClient().auth.getSession()
  return data.session?.access_token ?? null
}
