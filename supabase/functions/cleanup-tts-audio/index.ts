import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// TTL in hours - delete files older than this
const TTL_HOURS = 24;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("=== CLEANUP TTS AUDIO ===");
    console.log(`TTL: ${TTL_HOURS} hours`);

    // List all files in the tts folder
    const { data: folders, error: foldersError } = await supabase.storage
      .from("assets")
      .list("tts", { limit: 1000 });

    if (foldersError) {
      console.error("Error listing tts folders:", foldersError);
      throw foldersError;
    }

    if (!folders || folders.length === 0) {
      console.log("No TTS folders found");
      return new Response(JSON.stringify({ 
        success: true, 
        deleted: 0,
        message: "No TTS folders found" 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cutoffDate = new Date(Date.now() - TTL_HOURS * 60 * 60 * 1000);
    console.log(`Deleting files older than: ${cutoffDate.toISOString()}`);

    let totalDeleted = 0;
    const errors: string[] = [];

    // Iterate through workspace folders
    for (const folder of folders) {
      if (!folder.name) continue;

      const folderPath = `tts/${folder.name}`;
      
      // List files in each workspace folder
      const { data: files, error: filesError } = await supabase.storage
        .from("assets")
        .list(folderPath, { limit: 1000 });

      if (filesError) {
        console.error(`Error listing files in ${folderPath}:`, filesError);
        errors.push(`Failed to list ${folderPath}`);
        continue;
      }

      if (!files || files.length === 0) continue;

      // Find old files
      const oldFiles = files.filter(file => {
        if (!file.created_at) return false;
        const fileDate = new Date(file.created_at);
        return fileDate < cutoffDate;
      });

      if (oldFiles.length === 0) continue;

      // Delete old files
      const pathsToDelete = oldFiles.map(f => `${folderPath}/${f.name}`);
      console.log(`Deleting ${pathsToDelete.length} files from ${folderPath}`);

      const { error: deleteError } = await supabase.storage
        .from("assets")
        .remove(pathsToDelete);

      if (deleteError) {
        console.error(`Error deleting files from ${folderPath}:`, deleteError);
        errors.push(`Failed to delete from ${folderPath}`);
      } else {
        totalDeleted += pathsToDelete.length;
      }
    }

    console.log(`Cleanup complete. Deleted ${totalDeleted} files.`);

    return new Response(JSON.stringify({ 
      success: true, 
      deleted: totalDeleted,
      errors: errors.length > 0 ? errors : undefined,
      ttl_hours: TTL_HOURS
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Cleanup error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
