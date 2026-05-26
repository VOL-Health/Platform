import { createClient } from "@supabase/supabase-js";

let clientPromise;

export async function getSupabaseClient() {
  if (!clientPromise) {
    clientPromise = fetch("/api/supabase-public-config", {
      headers: { Accept: "application/json" },
      cache: "no-store"
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load access configuration");
        }

        return createClient(payload.url, payload.anonKey, {
          auth: {
            autoRefreshToken: true,
            detectSessionInUrl: true,
            persistSession: true
          }
        });
      });
  }

  return clientPromise;
}
