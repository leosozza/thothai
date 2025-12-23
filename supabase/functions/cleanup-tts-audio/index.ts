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

    console.log("=== CLEANUP MEDIA (TTS Audio & Images) ===");
    console.log(`TTL: ${TTL_HOURS} hours`);

    const cutoffDate = new Date(Date.now() - TTL_HOURS * 60 * 60 * 1000);
    console.log(`Deleting files older than: ${cutoffDate.toISOString()}`);

    let totalDeleted = 0;
    const errors: string[] = [];

    // Clean up TTS audio files
    console.log("--- Cleaning TTS audio files ---");
    const { data: ttsFolders, error: ttsFoldersError } = await supabase.storage
      .from("assets")
      .list("tts", { limit: 1000 });

    if (ttsFoldersError) {
      console.error("Error listing tts folders:", ttsFoldersError);
      errors.push("Failed to list tts folders");
    } else if (ttsFolders && ttsFolders.length > 0) {
      for (const folder of ttsFolders) {
        if (!folder.name) continue;

        const folderPath = `tts/${folder.name}`;
        
        const { data: files, error: filesError } = await supabase.storage
          .from("assets")
          .list(folderPath, { limit: 1000 });

        if (filesError) {
          console.error(`Error listing files in ${folderPath}:`, filesError);
          errors.push(`Failed to list ${folderPath}`);
          continue;
        }

        if (!files || files.length === 0) continue;

        const oldFiles = files.filter(file => {
          if (!file.created_at) return false;
          const fileDate = new Date(file.created_at);
          return fileDate < cutoffDate;
        });

        if (oldFiles.length === 0) continue;

        const pathsToDelete = oldFiles.map(f => `${folderPath}/${f.name}`);
        console.log(`Deleting ${pathsToDelete.length} TTS files from ${folderPath}`);

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
    }

    // Clean up image files
    console.log("--- Cleaning image files ---");
    const { data: imageFolders, error: imageFoldersError } = await supabase.storage
      .from("assets")
      .list("images", { limit: 1000 });

    if (imageFoldersError) {
      console.error("Error listing images folders:", imageFoldersError);
      errors.push("Failed to list images folders");
    } else if (imageFolders && imageFolders.length > 0) {
      for (const folder of imageFolders) {
        if (!folder.name) continue;

        const folderPath = `images/${folder.name}`;
        
        const { data: files, error: filesError } = await supabase.storage
          .from("assets")
          .list(folderPath, { limit: 1000 });

        if (filesError) {
          console.error(`Error listing files in ${folderPath}:`, filesError);
          errors.push(`Failed to list ${folderPath}`);
          continue;
        }

        if (!files || files.length === 0) continue;

        const oldFiles = files.filter(file => {
          if (!file.created_at) return false;
          const fileDate = new Date(file.created_at);
          return fileDate < cutoffDate;
        });

        if (oldFiles.length === 0) continue;

        const pathsToDelete = oldFiles.map(f => `${folderPath}/${f.name}`);
        console.log(`Deleting ${pathsToDelete.length} image files from ${folderPath}`);

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
    }

    console.log(`Cleanup complete. Deleted ${totalDeleted} files total.`);

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
