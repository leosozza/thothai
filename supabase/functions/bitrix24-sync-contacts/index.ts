import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper to refresh Bitrix24 token if expired
async function refreshBitrixToken(integration: any, supabase: any): Promise<string | null> {
  const config = integration.config as Record<string, any>;
  const tokenExpiresAt = config?.token_expires_at;
  
  if (tokenExpiresAt && new Date(tokenExpiresAt) > new Date()) {
    return config.access_token;
  }

  const refreshToken = config?.refresh_token;
  const clientEndpoint = config?.client_endpoint;
  
  if (!refreshToken || !clientEndpoint) {
    console.error("Missing refresh token or client endpoint");
    return null;
  }

  try {
    const refreshUrl = `${clientEndpoint}oauth/token/?grant_type=refresh_token&refresh_token=${refreshToken}`;
    const response = await fetch(refreshUrl);
    const data = await response.json();

    if (data.access_token) {
      const newExpiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
      
      await supabase
        .from("integrations")
        .update({
          config: {
            ...config,
            access_token: data.access_token,
            refresh_token: data.refresh_token || refreshToken,
            token_expires_at: newExpiresAt,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration.id);

      return data.access_token;
    }
  } catch (error) {
    console.error("Error refreshing Bitrix24 token:", error);
  }

  return null;
}

// Small URL helpers
function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

// Get Bitrix24 API endpoint (OAuth mode base)
function getBitrixEndpoint(integration: any): string {
  const config = integration.config as Record<string, any>;
  const endpoint = config?.client_endpoint || `https://${config?.domain}/rest/`;
  return ensureTrailingSlash(endpoint);
}

function buildBitrixMethodUrl(
  endpoint: string,
  method: string,
  accessToken: string | null,
  query: string
): string {
  const base = ensureTrailingSlash(endpoint);
  const qs = accessToken
    ? `auth=${encodeURIComponent(accessToken)}${query ? `&${query}` : ""}`
    : query;

  return `${base}${method}${qs ? `?${qs}` : ""}`;
}

// Fetch contacts from Bitrix24 CRM
async function fetchBitrixContacts(
  accessToken: string | null,
  endpoint: string,
  start: number = 0
): Promise<any> {
  const query = `start=${start}&select[]=ID&select[]=NAME&select[]=LAST_NAME&select[]=PHONE&select[]=EMAIL&select[]=PHOTO`;
  const url = buildBitrixMethodUrl(endpoint, "crm.contact.list", accessToken, query);

  console.log(
    "Fetching Bitrix24 contacts from:",
    accessToken ? url.replace(accessToken, "***") : url
  );

  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    throw new Error(`Bitrix24 API error: ${data.error_description || data.error}`);
  }

  return data;
}

// Normalize phone number for comparison
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").replace(/^0+/, "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { workspace_id, instance_id, direction = "both" } = body;
    // direction: "to_bitrix" | "from_bitrix" | "both"

    console.log("Contact sync request:", { workspace_id, instance_id, direction });

    if (!workspace_id) {
      return new Response(
        JSON.stringify({ error: "workspace_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get Bitrix24 integration
    const { data: integration, error: intError } = await supabase
      .from("integrations")
      .select("*")
      .eq("workspace_id", workspace_id)
      .eq("type", "bitrix24")
      .eq("is_active", true)
      .maybeSingle();

    if (intError || !integration) {
      return new Response(
        JSON.stringify({ error: "No active Bitrix24 integration found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const config = integration.config as Record<string, any>;
    const targetInstanceId = instance_id || config?.instance_id;

    if (!targetInstanceId) {
      return new Response(
        JSON.stringify({ error: "No instance configured for Bitrix24 integration" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve Bitrix24 API auth mode
    let accessToken: string | null = null;
    let endpoint: string;

    if (config?.webhook_url) {
      // Webhook mode (local/inbound webhook) - auth is embedded in the URL
      endpoint = ensureTrailingSlash(config.webhook_url);
      console.log("Using Bitrix24 webhook mode for contact sync");
    } else {
      // OAuth mode
      accessToken = await refreshBitrixToken(integration, supabase);
      if (!accessToken) {
        return new Response(
          JSON.stringify({
            error: "Failed to get Bitrix24 access token",
            hint: "Para Bitrix24 local, configure um Webhook de Entrada (REST) e salve a URL na integração.",
          }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      endpoint = getBitrixEndpoint(integration);
    }
    const stats = {
      synced_to_bitrix: 0,
      synced_from_bitrix: 0,
      updated: 0,
      errors: 0,
    };

    // SYNC FROM BITRIX24 TO LOCAL CONTACTS
    if (direction === "from_bitrix" || direction === "both") {
      console.log("Syncing contacts FROM Bitrix24...");
      
      let allBitrixContacts: any[] = [];
      let start = 0;
      let hasMore = true;

      // Paginate through all Bitrix24 contacts
      while (hasMore) {
        const result = await fetchBitrixContacts(accessToken, endpoint, start);
        
        if (result.result && Array.isArray(result.result)) {
          allBitrixContacts = [...allBitrixContacts, ...result.result];
          
          if (result.next) {
            start = result.next;
          } else {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }

        // Safety limit
        if (allBitrixContacts.length > 5000) {
          console.log("Reached 5000 contacts limit");
          break;
        }
      }

      console.log(`Found ${allBitrixContacts.length} contacts in Bitrix24 CRM`);

      // Get existing local contacts for this instance
      const { data: localContacts } = await supabase
        .from("contacts")
        .select("*")
        .eq("instance_id", targetInstanceId);

      const localContactsByPhone = new Map(
        (localContacts || []).map(c => [normalizePhone(c.phone_number), c])
      );

      // Process Bitrix24 contacts
      for (const bitrixContact of allBitrixContacts) {
        const phones = bitrixContact.PHONE || [];
        const primaryPhone = phones[0]?.VALUE;
        
        if (!primaryPhone) continue;

        const normalizedPhone = normalizePhone(primaryPhone);
        const existingContact = localContactsByPhone.get(normalizedPhone);
        
        const fullName = [bitrixContact.NAME, bitrixContact.LAST_NAME]
          .filter(Boolean)
          .join(" ")
          .trim();

        if (existingContact) {
          // Update existing contact with Bitrix24 data
          const metadata = existingContact.metadata || {};
          
          if (!metadata.bitrix24_contact_id || metadata.bitrix24_contact_id !== bitrixContact.ID) {
            const { error: updateError } = await supabase
              .from("contacts")
              .update({
                name: existingContact.name || fullName,
                metadata: {
                  ...metadata,
                  bitrix24_contact_id: bitrixContact.ID,
                  bitrix24_synced_at: new Date().toISOString(),
                },
                updated_at: new Date().toISOString(),
              })
              .eq("id", existingContact.id);

            if (updateError) {
              console.error("Error updating contact:", updateError);
              stats.errors++;
            } else {
              stats.updated++;
            }
          }
        } else {
          // Create new local contact from Bitrix24
          const { error: insertError } = await supabase
            .from("contacts")
            .insert({
              instance_id: targetInstanceId,
              phone_number: primaryPhone,
              name: fullName,
              metadata: {
                bitrix24_contact_id: bitrixContact.ID,
                bitrix24_synced_at: new Date().toISOString(),
                source: "bitrix24",
              },
            });

          if (insertError) {
            console.error("Error creating contact:", insertError);
            stats.errors++;
          } else {
            stats.synced_from_bitrix++;
          }
        }
      }
    }

    // SYNC FROM LOCAL CONTACTS TO BITRIX24
    if (direction === "to_bitrix" || direction === "both") {
      console.log("Syncing contacts TO Bitrix24...");
      
      // Get local contacts without Bitrix24 ID
      const { data: unsyncedContacts } = await supabase
        .from("contacts")
        .select("*")
        .eq("instance_id", targetInstanceId)
        .or("metadata->bitrix24_contact_id.is.null,metadata.is.null");

      console.log(`Found ${unsyncedContacts?.length || 0} contacts to sync to Bitrix24`);

      for (const contact of unsyncedContacts || []) {
        try {
          // Check if contact already exists in Bitrix24 by phone
          const searchUrl = buildBitrixMethodUrl(
            endpoint,
            "crm.contact.list",
            accessToken,
            `filter[PHONE]=${encodeURIComponent(contact.phone_number)}`
          );
          const searchResponse = await fetch(searchUrl);
          const searchResult = await searchResponse.json();

          if (searchResult.result && searchResult.result.length > 0) {
            // Contact exists in Bitrix24, update local with ID
            const bitrixId = searchResult.result[0].ID;
            
            await supabase
              .from("contacts")
              .update({
                metadata: {
                  ...(contact.metadata || {}),
                  bitrix24_contact_id: bitrixId,
                  bitrix24_synced_at: new Date().toISOString(),
                },
                updated_at: new Date().toISOString(),
              })
              .eq("id", contact.id);

            stats.updated++;
          } else {
            // Create new contact in Bitrix24
            const nameParts = (contact.name || contact.push_name || "").split(" ");
            const firstName = nameParts[0] || "Contato";
            const lastName = nameParts.slice(1).join(" ") || "";

            const createUrl = buildBitrixMethodUrl(endpoint, "crm.contact.add", accessToken, "");
            const createResponse = await fetch(createUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                fields: {
                  NAME: firstName,
                  LAST_NAME: lastName,
                  PHONE: [{ VALUE: contact.phone_number, VALUE_TYPE: "MOBILE" }],
                  SOURCE_ID: "WEB",
                  COMMENTS: "Importado do WhatsApp via Thoth",
                },
              }),
            });

            const createResult = await createResponse.json();

            if (createResult.result) {
              await supabase
                .from("contacts")
                .update({
                  metadata: {
                    ...(contact.metadata || {}),
                    bitrix24_contact_id: createResult.result,
                    bitrix24_synced_at: new Date().toISOString(),
                  },
                  updated_at: new Date().toISOString(),
                })
                .eq("id", contact.id);

              stats.synced_to_bitrix++;
            } else if (createResult.error) {
              console.error("Bitrix24 create contact error:", createResult.error_description);
              stats.errors++;
            }
          }
        } catch (error) {
          console.error("Error syncing contact to Bitrix24:", error);
          stats.errors++;
        }
      }
    }

    console.log("Sync completed:", stats);

    return new Response(
      JSON.stringify({
        success: true,
        stats,
        message: `Sync completed: ${stats.synced_from_bitrix} imported, ${stats.synced_to_bitrix} exported, ${stats.updated} updated`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Contact sync error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
