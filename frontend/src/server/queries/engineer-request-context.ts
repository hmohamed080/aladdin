import "server-only";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
const schema = z.object({
  location: z.string(),
  showroomIds: z.array(z.string().uuid()),
});
export async function loadEngineerRequestContext(requestId: string) {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("engineer_request_context_read", {
    p_request_id: requestId,
  });
  if (error) throw error;
  return schema.parse(data);
}
