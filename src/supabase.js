
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://kjvutonzarckuggkfidy.supabase.co";

const supabaseKey = "sb_publishable_g6lesi7ohz6q-vw5ZsIWsw_BRpxTfAp";

export const supabase = createClient(
  supabaseUrl,
  supabaseKey
);
