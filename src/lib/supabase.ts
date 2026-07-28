import { createClient } from '@supabase/supabase-js';

// NEXT_PUBLIC_ vars are embedded in the client bundle — safe as fallbacks
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://mzbicxpiyfjfamstplqm.supabase.co';
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_publishable_VcTkKDtvLzibrPlbfeg63A_vahbZb_d';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
