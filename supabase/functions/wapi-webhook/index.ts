import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// HKDF Expand function for WhatsApp media decryption
async function hkdfExpand(key: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  // Step 1: Extract (PRK = HMAC(salt, key)) - salt is zeros
  const salt = new Uint8Array(32);
  const hmacKeyExtract = await crypto.subtle.importKey(
    "raw", salt.buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const prkBuffer = await crypto.subtle.sign("HMAC", hmacKeyExtract, key.buffer as ArrayBuffer);
  const prk = new Uint8Array(prkBuffer);
  
  // Step 2: Expand
  let keyStream = new Uint8Array(0);
  let keyBlock = new Uint8Array(0);
  let blockIndex = 1;
  
  const prkKey = await crypto.subtle.importKey(
    "raw", prk.buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  
  while (keyStream.length < length) {
    const blockData = new Uint8Array(keyBlock.length + info.length + 1);
    blockData.set(keyBlock);
    blockData.set(info, keyBlock.length);
    blockData[keyBlock.length + info.length] = blockIndex;
    
    const blockBuffer = await crypto.subtle.sign("HMAC", prkKey, blockData.buffer as ArrayBuffer);
    keyBlock = new Uint8Array(blockBuffer);
    const newStream = new Uint8Array(keyStream.length + keyBlock.length);
    newStream.set(keyStream);
    newStream.set(keyBlock, keyStream.length);
    keyStream = newStream;
    blockIndex++;
  }
  
  return keyStream.slice(0, length);
}

// Decrypt WhatsApp media using mediaKey (HKDF + AES-256-CBC)
async function decryptWhatsAppMedia(
  encryptedData: Uint8Array,
  mediaKeyBase64: string,
  messageType: string = "audio"
): Promise<Uint8Array> {
  console.log("Decrypting WhatsApp media, type:", messageType, "encrypted size:", encryptedData.length);
  
  // 1. Decode mediaKey from base64
  const mediaKey = Uint8Array.from(atob(mediaKeyBase64), c => c.charCodeAt(0));
  console.log("MediaKey decoded, length:", mediaKey.length);
  
  // 2. Get the info string based on message type
  const infoMap: Record<string, string> = {
    audio: "WhatsApp Audio Keys",
    ptt: "WhatsApp Audio Keys",
    image: "WhatsApp Image Keys",
    video: "WhatsApp Video Keys",
    document: "WhatsApp Document Keys",
    sticker: "WhatsApp Image Keys"
  };
  const infoString = infoMap[messageType] || "WhatsApp Audio Keys";
  const info = new TextEncoder().encode(infoString);
  console.log("Using info string:", infoString);
  
  // 3. HKDF expand the mediaKey to 112 bytes
  const expandedKey = await hkdfExpand(mediaKey, info, 112);
  console.log("Expanded key length:", expandedKey.length);
  
  // 4. Extract IV (bytes 0-16) and Key (bytes 16-48)
  const iv = expandedKey.slice(0, 16);
  const key = expandedKey.slice(16, 48);
  console.log("IV length:", iv.length, "Key length:", key.length);
  
  // 5. Remove last 10 bytes (MAC/checksum)
  const encryptedFile = encryptedData.slice(0, -10);
  console.log("Encrypted file size after removing MAC:", encryptedFile.length);
  
  // 6. Decrypt using AES-256-CBC
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "AES-CBC" }, false, ["decrypt"]
  );
  
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv }, cryptoKey, encryptedFile
  );
  
  console.log("Decryption successful, decrypted size:", decrypted.byteLength);
  return new Uint8Array(decrypted);
}

// Download decrypted media from W-API (fallback method)
async function downloadMediaFromWAPI(
  messageId: string,
  wapiInstanceKey: string,
  wapiApiKey: string
): Promise<ArrayBuffer | null> {
  const WAPI_BASE_URL = "https://api.w-api.app/v1";
  
  console.log("Downloading decrypted media from W-API for message:", messageId);
  
  try {
    const response = await fetch(
      `${WAPI_BASE_URL}/message/download-media?instanceId=${wapiInstanceKey}&messageId=${messageId}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${wapiApiKey}`,
        },
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error("W-API media download failed:", response.status, errorText);
      return null;
    }
    
    const arrayBuffer = await response.arrayBuffer();
    console.log("W-API media downloaded successfully, size:", arrayBuffer.byteLength, "bytes");
    return arrayBuffer;
  } catch (error) {
    console.error("Error downloading media from W-API:", error);
    return null;
  }
}

// Download and store image to Supabase storage
async function downloadAndStoreImage(
  imageUrl: string,
  supabase: any,
  workspaceId: string,
  messageId?: string,
  wapiInstanceKey?: string,
  wapiApiKey?: string,
  mediaKey?: string
): Promise<string | null> {
  console.log("Downloading image for storage...");
  
  let imageData: ArrayBuffer | null = null;
  let mimeType = "image/jpeg";
  
  // Method 1: Local decryption using mediaKey (preferred)
  if (mediaKey && imageUrl) {
    console.log("Attempting local image decryption using mediaKey...");
    try {
      const encryptedResponse = await fetch(imageUrl);
      if (encryptedResponse.ok) {
        const encryptedData = new Uint8Array(await encryptedResponse.arrayBuffer());
        console.log("Downloaded encrypted image, size:", encryptedData.length);
        
        const decryptedImage = await decryptWhatsAppMedia(encryptedData, mediaKey, "image");
        imageData = decryptedImage.buffer as ArrayBuffer;
        console.log("Image decrypted successfully, size:", imageData.byteLength);
      }
    } catch (decryptError) {
      console.error("Local image decryption failed:", decryptError);
    }
  }
  
  // Method 2: W-API download (fallback)
  if (!imageData && messageId && wapiInstanceKey && wapiApiKey) {
    console.log("Attempting to download image via W-API...");
    imageData = await downloadMediaFromWAPI(messageId, wapiInstanceKey, wapiApiKey);
  }
  
  // Method 3: Direct URL download (last resort)
  if (!imageData && imageUrl) {
    console.log("Attempting direct image download...");
    try {
      const response = await fetch(imageUrl);
      if (response.ok) {
        imageData = await response.arrayBuffer();
        mimeType = response.headers.get("content-type") || "image/jpeg";
        console.log("Direct image download successful, size:", imageData.byteLength);
      }
    } catch (err) {
      console.error("Direct image download failed:", err);
    }
  }
  
  if (!imageData || imageData.byteLength === 0) {
    console.error("Failed to download image from all methods");
    return null;
  }
  
  // Validate image size (max 10MB)
  if (imageData.byteLength > 10 * 1024 * 1024) {
    console.error("Image too large:", imageData.byteLength);
    return null;
  }
  
  // Upload to Supabase storage
  try {
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(7);
    const extension = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
    const fileName = `images/${workspaceId}/${timestamp}_${randomId}.${extension}`;
    
    const { error: uploadError } = await supabase.storage
      .from("assets")
      .upload(fileName, imageData, {
        contentType: mimeType,
        upsert: false,
      });
    
    if (uploadError) {
      console.error("Error uploading image to storage:", uploadError);
      return null;
    }
    
    // Get public URL
    const { data: publicData } = supabase.storage
      .from("assets")
      .getPublicUrl(fileName);
    
    console.log("Image uploaded successfully:", publicData.publicUrl);
    return publicData.publicUrl;
  } catch (storageError) {
    console.error("Storage upload error:", storageError);
    return null;
  }
}

// Transcribe audio using ElevenLabs STT
async function transcribeAudio(audioData: ArrayBuffer, languageCode: string = "por"): Promise<string | null> {
  const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
  if (!ELEVENLABS_API_KEY) {
    console.log("ELEVENLABS_API_KEY not configured; skipping transcription");
    return null;
  }

  const audioBlob = new Blob([audioData], { type: "audio/ogg" });
  console.log("Transcribing audio, size:", audioBlob.size, "bytes, language:", languageCode);

  const apiFormData = new FormData();
  apiFormData.append("file", audioBlob, "audio.ogg");
  apiFormData.append("model_id", "scribe_v1");
  apiFormData.append("language_code", languageCode);
  apiFormData.append("tag_audio_events", "false");
  apiFormData.append("diarize", "false");

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
    },
    body: apiFormData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("ElevenLabs STT error:", response.status, errorText);
    throw new Error(`ElevenLabs STT error (${response.status}): ${errorText}`);
  }

  const result = await response.json().catch(() => null) as { text?: string } | null;
  const text = (result?.text || "").trim();

  console.log("Transcription:", text ? text.substring(0, 120) : "<empty>");
  return text || null;
}

// Main transcription function - tries local decryption first, then W-API, then direct URL
async function transcribeAudioFromUrl(
  audioUrl: string, 
  languageCode: string = "por",
  messageId?: string,
  wapiInstanceKey?: string,
  wapiApiKey?: string,
  mediaKey?: string,
  messageType: string = "audio"
): Promise<string | null> {
  
  // Method 1: Local decryption using mediaKey (preferred)
  if (mediaKey && audioUrl) {
    console.log("Attempting local decryption using mediaKey...");
    try {
      // Download encrypted file
      const encryptedResponse = await fetch(audioUrl);
      if (encryptedResponse.ok) {
        const encryptedData = new Uint8Array(await encryptedResponse.arrayBuffer());
        console.log("Downloaded encrypted audio, size:", encryptedData.length);
        
        // Decrypt using mediaKey
        const decryptedAudio = await decryptWhatsAppMedia(encryptedData, mediaKey, messageType);
        
        // Transcribe decrypted audio
        const audioArrayBuffer = new ArrayBuffer(decryptedAudio.byteLength);
        new Uint8Array(audioArrayBuffer).set(decryptedAudio);
        return await transcribeAudio(audioArrayBuffer, languageCode);
      } else {
        console.error("Failed to download encrypted audio:", encryptedResponse.status);
      }
    } catch (decryptError) {
      console.error("Local decryption failed:", decryptError);
    }
  }
  
  // Method 2: W-API download (fallback)
  if (messageId && wapiInstanceKey && wapiApiKey) {
    console.log("Attempting to download decrypted audio via W-API...");
    const decryptedAudio = await downloadMediaFromWAPI(messageId, wapiInstanceKey, wapiApiKey);
    
    if (decryptedAudio) {
      return await transcribeAudio(decryptedAudio, languageCode);
    }
    console.log("W-API download failed, trying direct URL...");
  }
  
  // Method 3: Direct URL (last resort - usually fails for encrypted files)
  const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
  if (!ELEVENLABS_API_KEY) {
    console.log("ELEVENLABS_API_KEY not configured; skipping transcription");
    return null;
  }

  console.log("Fetching audio for transcription (direct URL - may fail for encrypted files):", audioUrl);
  try {
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      const t = await audioResponse.text().catch(() => "");
      throw new Error(`Failed to fetch audio from URL (${audioResponse.status}): ${t}`);
    }

    const audioBuffer = await audioResponse.arrayBuffer();
    return await transcribeAudio(audioBuffer, languageCode);
  } catch (directError) {
    console.error("Direct URL transcription failed:", directError);
    return null;
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);

    // Parse payload once (we may need it for health checks and for instance_id fallback)
    const payload = await req.json().catch(() => null) as any;

    // Lightweight health check (used by the Diagnostics screen)
    if (payload?.action === "health_check") {
      return new Response(JSON.stringify({ status: "ok", function: "wapi-webhook" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const instanceId = url.searchParams.get("instance_id") || payload?.instance_id || payload?.instanceId;

    if (!instanceId) {
      console.error("Missing instance_id in webhook");
      return new Response(JSON.stringify({ error: "Missing instance_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!payload) {
      return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("W-API Webhook received:", JSON.stringify(payload, null, 2));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify instance exists
    const { data: instance, error: instanceError } = await supabase
      .from("instances")
      .select("*")
      .eq("id", instanceId)
      .single();

    if (instanceError || !instance) {
      console.error("Instance not found:", instanceId);
      return new Response(JSON.stringify({ error: "Instance not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const event = payload.event || payload.type;
    console.log("Processing event:", event);

    switch (event) {
      // =====================
      // W-API specific events
      // =====================
      
      case "webhookReceived": {
        // W-API format: incoming message
        console.log("Processing webhookReceived event");
        
        const isGroup = payload.isGroup === true;
        if (isGroup) {
          console.log("Skipping group message");
          break;
        }

        const senderPhone = payload.sender?.id || payload.chat?.id;
        if (!senderPhone) {
          console.error("No sender phone found in payload");
          break;
        }

        // Clean phone number (remove any non-digits)
        const contactPhone = senderPhone.replace(/\D/g, "");
        const isFromMe = payload.fromMe === true;
        const messageId = payload.messageId;
        const pushName = payload.sender?.pushName || "";
        const profilePic = payload.sender?.profilePicture || payload.chat?.profilePicture;

        // Handle outgoing messages (fromMe=true)
        if (isFromMe) {
          // Check if this message was sent by our system (bot, app, or API)
          const { data: existingOurMessage } = await supabase
            .from("messages")
            .select("id, is_from_bot, metadata")
            .eq("whatsapp_message_id", messageId)
            .maybeSingle();

          if (existingOurMessage) {
            // Message already exists in DB - was sent by our system (echo)
            console.log("Skipping - message sent by our system:", existingOurMessage.metadata?.source || "unknown");
            break;
          }

          // Message from WhatsApp but NOT in our DB = sent via phone/manual
          console.log("Detected message from human agent via WhatsApp mobile");
          
          // Get or create contact for this conversation
          const { data: manualContact } = await supabase
            .from("contacts")
            .select("*")
            .eq("instance_id", instanceId)
            .ilike("phone_number", `%${contactPhone.slice(-10)}`)
            .maybeSingle();

          if (manualContact) {
            // Get conversation
            const { data: manualConversation } = await supabase
              .from("conversations")
              .select("*")
              .eq("instance_id", instanceId)
              .eq("contact_id", manualContact.id)
              .maybeSingle();

            if (manualConversation) {
              // Extract message content
              const manualMsgContent = payload.msgContent?.conversation ||
                payload.msgContent?.extendedTextMessage?.text || "";

              // Save message as human agent message
              await supabase.from("messages").insert({
                instance_id: instanceId,
                contact_id: manualContact.id,
                conversation_id: manualConversation.id,
                whatsapp_message_id: messageId,
                direction: "outgoing",
                message_type: "text",
                content: manualMsgContent,
                status: "sent",
                is_from_bot: false,
                metadata: { source: "whatsapp_manual" }
              });

              // Switch to human mode - agent took over via WhatsApp
              await supabase.from("conversations").update({
                attendance_mode: "human",
                assigned_to: "whatsapp_manual",
                last_message_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }).eq("id", manualConversation.id);

              console.log("Human agent assumed via WhatsApp - switched to human mode");
            }
          }
          
          break;
        }

        // Determine message type
        let messageType = "text";
        if (payload.msgContent?.imageMessage) messageType = "image";
        else if (payload.msgContent?.audioMessage) messageType = "audio";
        else if (payload.msgContent?.videoMessage) messageType = "video";
        else if (payload.msgContent?.documentMessage) messageType = "document";
        else if (payload.msgContent?.stickerMessage) messageType = "sticker";

        // Extract message content from W-API format
        let msgContent = payload.msgContent?.conversation ||
          payload.msgContent?.extendedTextMessage?.text ||
          payload.msgContent?.imageMessage?.caption ||
          payload.msgContent?.videoMessage?.caption ||
          payload.msgContent?.documentMessage?.caption ||
          "";

        // Transcribe audio messages using local decryption with mediaKey
        let audioTranscription: string | null = null;
        let audioUrl: string | null = null;
        if (messageType === "audio" && payload.msgContent?.audioMessage?.url) {
          audioUrl = payload.msgContent.audioMessage.url;
          const audioMessage = payload.msgContent.audioMessage;
          const mediaKey = audioMessage.mediaKey; // Base64 encoded key for decryption
          
          try {
            console.log("Transcribing audio message...");
            console.log("Audio URL:", audioUrl);
            console.log("MediaKey present:", !!mediaKey);
            
            // Get W-API credentials from instance (fallback method)
            const wapiInstanceKey = instance.instance_key;
            
            // Get W-API API key from integrations or use environment variable
            let wapiApiKey = Deno.env.get("WAPI_API_KEY");
            
            if (!wapiApiKey && instance.workspace_id) {
              // Try to get from integrations table
              const { data: wapiIntegration } = await supabase
                .from("integrations")
                .select("config")
                .eq("workspace_id", instance.workspace_id)
                .eq("type", "wapi")
                .eq("is_active", true)
                .maybeSingle();
              
              wapiApiKey = (wapiIntegration?.config as any)?.api_key || null;
            }
            
            // Determine audio subtype (ptt = voice note, audio = regular audio)
            const audioType = audioMessage.ptt ? "ptt" : "audio";
            
            // Use local decryption with mediaKey (preferred), fallback to W-API, then direct URL
            audioTranscription = await transcribeAudioFromUrl(
              audioUrl!, 
              "por",
              messageId,
              wapiInstanceKey || undefined,
              wapiApiKey || undefined,
              mediaKey || undefined,
              audioType
            );
            
            if (audioTranscription) {
              msgContent = audioTranscription; // Use transcription as message content for AI
              console.log("Audio transcribed successfully:", audioTranscription.substring(0, 100));
            } else {
              console.log("Audio transcription returned empty - message will be processed without text content");
            }
          } catch (transcribeErr) {
            console.error("Audio transcription failed:", transcribeErr);
            // Continue processing - message will be saved even without transcription
          }
        }

        // Handle image messages - download and store for AI processing
        let imageUrl: string | null = null;
        let storedImageUrl: string | null = null;
        if (messageType === "image" && payload.msgContent?.imageMessage?.url) {
          imageUrl = payload.msgContent.imageMessage.url;
          const imageMessage = payload.msgContent.imageMessage;
          const mediaKey = imageMessage.mediaKey;
          
          try {
            console.log("Processing image message...");
            console.log("Image URL:", imageUrl);
            console.log("MediaKey present:", !!mediaKey);
            
            // Get W-API credentials
            const wapiInstanceKey = instance.instance_key;
            let wapiApiKey = Deno.env.get("WAPI_API_KEY");
            
            if (!wapiApiKey && instance.workspace_id) {
              const { data: wapiIntegration } = await supabase
                .from("integrations")
                .select("config")
                .eq("workspace_id", instance.workspace_id)
                .eq("type", "wapi")
                .eq("is_active", true)
                .maybeSingle();
              
              wapiApiKey = (wapiIntegration?.config as any)?.api_key || null;
            }
            
            // Download and store image
            storedImageUrl = await downloadAndStoreImage(
              imageUrl!,
              supabase,
              instance.workspace_id,
              messageId,
              wapiInstanceKey || undefined,
              wapiApiKey || undefined,
              mediaKey || undefined
            );
            
            if (storedImageUrl) {
              console.log("Image stored successfully:", storedImageUrl);
            } else {
              console.log("Failed to store image - will try to use original URL");
              storedImageUrl = imageUrl; // Fallback to original URL
            }
          } catch (imageErr) {
            console.error("Image processing failed:", imageErr);
            storedImageUrl = imageUrl; // Fallback to original URL
          }
        }

        console.log(`Message from ${contactPhone}: ${msgContent} (type: ${messageType})`);

        // Get or create contact
        let { data: contact } = await supabase
          .from("contacts")
          .select("*")
          .eq("instance_id", instanceId)
          .eq("phone_number", contactPhone)
          .maybeSingle();

        if (!contact) {
          console.log("Creating new contact:", contactPhone);
          const { data: newContact, error: contactError } = await supabase
            .from("contacts")
            .insert({
              instance_id: instanceId,
              phone_number: contactPhone,
              push_name: pushName || null,
              profile_picture_url: profilePic || null,
            })
            .select()
            .single();

          if (contactError) {
            console.error("Error creating contact:", contactError);
            break;
          }
          contact = newContact;
        } else if ((pushName && pushName !== contact.push_name) || (profilePic && profilePic !== contact.profile_picture_url)) {
          // Update contact info if changed
          await supabase
            .from("contacts")
            .update({ 
              push_name: pushName || contact.push_name,
              profile_picture_url: profilePic || contact.profile_picture_url 
            })
            .eq("id", contact.id);
        }

        // Get or create conversation
        let { data: conversation } = await supabase
          .from("conversations")
          .select("*")
          .eq("instance_id", instanceId)
          .eq("contact_id", contact.id)
          .maybeSingle();

        let isFirstMessage = false;
        if (!conversation) {
          console.log("Creating new conversation for contact:", contact.id);
          isFirstMessage = true;
          const { data: newConversation, error: convError } = await supabase
            .from("conversations")
            .insert({
              instance_id: instanceId,
              contact_id: contact.id,
              status: "open",
              last_message_at: new Date().toISOString(),
            })
            .select()
            .single();

          if (convError) {
            console.error("Error creating conversation:", convError);
            break;
          }
          conversation = newConversation;
        }

        // Check if message already exists (avoid duplicates)
        if (messageId) {
          const { data: existingMsg } = await supabase
            .from("messages")
            .select("id")
            .eq("whatsapp_message_id", messageId)
            .maybeSingle();

          if (existingMsg) {
            console.log("Message already exists, skipping:", messageId);
            break;
          }
        }

        // Insert message
        const { data: savedMessage, error: msgError } = await supabase
          .from("messages")
          .insert({
            instance_id: instanceId,
            contact_id: contact.id,
            conversation_id: conversation.id,
            whatsapp_message_id: messageId,
            direction: isFromMe ? "outgoing" : "incoming",
            message_type: messageType,
            content: msgContent,
            media_url: storedImageUrl || audioUrl, // Store image URL or audio URL
            audio_transcription: audioTranscription,
            status: isFromMe ? "sent" : "delivered",
            is_from_bot: false,
          })
          .select()
          .single();

        if (msgError) {
          console.error("Error inserting message:", msgError);
          break;
        }

        // Update conversation
        const unreadIncrement = isFromMe ? 0 : 1;
        await supabase
          .from("conversations")
          .update({
            last_message_at: new Date().toISOString(),
            unread_count: (conversation.unread_count || 0) + unreadIncrement,
          })
          .eq("id", conversation.id);

        console.log("Message saved successfully:", messageId);

        // Check if workspace has Bitrix24 integration active - send incoming messages to Bitrix24
        if (!isFromMe) {
          try {
            const { data: bitrixIntegration } = await supabase
              .from("integrations")
              .select("*")
              .eq("workspace_id", instance.workspace_id)
              .eq("type", "bitrix24")
              .eq("is_active", true)
              .maybeSingle();

            if (bitrixIntegration) {
              console.log("Sending message to Bitrix24...");
              
              const bitrixResponse = await fetch(`${supabaseUrl}/functions/v1/bitrix24-send`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  integration_id: bitrixIntegration.id,
                  instance_id: instanceId,
                  contact_phone: contactPhone,
                  contact_name: pushName || contactPhone,
                  contact_picture: profilePic,
                  message: msgContent,
                  message_type: messageType,
                  message_id: messageId,
                  create_lead: true,
                  is_first_message: isFirstMessage,
                }),
              });

              const bitrixResult = await bitrixResponse.json();
              console.log("Bitrix24 send result:", bitrixResult);
            }
          } catch (bitrixErr) {
            console.error("Error sending to Bitrix24:", bitrixErr);
          }
        }

        // Check attendance mode before processing with AI
        const attendanceMode = conversation.attendance_mode || 'ai';
        const assignedTo = conversation.assigned_to;
        
        // Trigger AI processing if message has content OR has an image
        const hasContent = msgContent || storedImageUrl;
        if (hasContent) {
          const shouldProcessWithAI = attendanceMode === 'ai' || 
            (attendanceMode === 'hybrid' && !assignedTo);
          
          if (shouldProcessWithAI) {
            // ANTI-LOOP: Check if bot responded recently (cooldown of 3 seconds)
            const { data: recentBotMessage } = await supabase
              .from("messages")
              .select("created_at")
              .eq("conversation_id", conversation.id)
              .eq("direction", "outgoing")
              .eq("is_from_bot", true)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (recentBotMessage) {
              const timeSinceLastBot = Date.now() - new Date(recentBotMessage.created_at).getTime();
              if (timeSinceLastBot < 3000) {
                console.log("ANTI-LOOP: Skipping AI - bot responded recently:", timeSinceLastBot, "ms ago");
                break;
              }
            }

            console.log("Triggering flow-engine for incoming message (mode:", attendanceMode, ")");
            
            try {
              const flowResponse = await fetch(`${supabaseUrl}/functions/v1/flow-engine`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  message_id: savedMessage.id,
                  conversation_id: conversation.id,
                  instance_id: instanceId,
                  contact_id: contact.id,
                  content: msgContent,
                  workspace_id: instance.workspace_id,
                  is_first_message: isFirstMessage,
                  original_message_type: messageType,
                  image_url: storedImageUrl, // Pass image URL for AI vision
                }),
              });

              if (!flowResponse.ok) {
                const flowError = await flowResponse.text();
                console.error("Flow engine error:", flowError);
              } else {
                const flowResult = await flowResponse.json();
                console.log("Flow engine result:", flowResult);
              }
            } catch (flowErr) {
              console.error("Error calling flow-engine:", flowErr);
            }
          } else {
            console.log("Skipping AI - attendance mode is:", attendanceMode, ", assigned_to:", assignedTo);
          }
        }
        
        break;
      }

      case "webhookStatus": {
        // W-API format: message status update (DELIVERY, READ, etc)
        console.log("Processing webhookStatus event");
        
        const msgId = payload.messageId;
        const status = payload.status; // DELIVERY, READ, PLAYED
        const contactPhone = payload.chat?.id?.replace(/\D/g, "") || "";
        
        let statusText = "sent";
        if (status === "DELIVERY" || status === "delivered") statusText = "delivered";
        if (status === "READ" || status === "read") statusText = "read";
        if (status === "PLAYED" || status === "played") statusText = "read";

        if (msgId) {
          // Update message status in database
          const { data: updatedMessage, error } = await supabase
            .from("messages")
            .update({ status: statusText })
            .eq("whatsapp_message_id", msgId)
            .select("metadata")
            .maybeSingle();
          
          if (error) {
            console.error("Error updating message status:", error);
          } else {
            console.log(`Message ${msgId} status updated to: ${statusText}`);

            // Sync status to Bitrix24 if integration is active
            if (statusText === "delivered" || statusText === "read") {
              try {
                const { data: bitrixIntegration } = await supabase
                  .from("integrations")
                  .select("*")
                  .eq("workspace_id", instance.workspace_id)
                  .eq("type", "bitrix24")
                  .eq("is_active", true)
                  .maybeSingle();

                if (bitrixIntegration) {
                  // Get the Bitrix24 message ID from metadata if available
                  const bitrixMessageId = updatedMessage?.metadata?.bitrix24_message_id;
                  
                  if (bitrixMessageId) {
                    console.log(`Syncing ${statusText} status to Bitrix24 for message:`, bitrixMessageId);
                    
                    const statusResponse = await fetch(`${supabaseUrl}/functions/v1/bitrix24-status`, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        type: statusText === "delivered" ? "delivery" : "reading",
                        integration_id: bitrixIntegration.id,
                        contact_phone: contactPhone,
                        message_ids: [bitrixMessageId],
                      }),
                    });

                    const statusResult = await statusResponse.json();
                    console.log("Bitrix24 status sync result:", statusResult);
                  }
                }
              } catch (bitrixErr) {
                console.error("Error syncing status to Bitrix24:", bitrixErr);
              }
            }
          }
        }
        break;
      }

      case "webhookConnected": {
        // W-API: instance connected
        console.log("Instance connected via webhookConnected:", instanceId);
        
        const phoneNumber = payload.connectedPhone || payload.phone;
        const profilePic = payload.profilePicture;
        
        await supabase
          .from("instances")
          .update({
            status: "connected",
            phone_number: phoneNumber || instance.phone_number,
            profile_picture_url: profilePic || instance.profile_picture_url,
            qr_code: null,
            updated_at: new Date().toISOString()
          })
          .eq("id", instanceId);
        break;
      }

      case "webhookDisconnected": {
        // W-API: instance disconnected
        console.log("Instance disconnected via webhookDisconnected:", instanceId);
        
        await supabase
          .from("instances")
          .update({
            status: "disconnected",
            qr_code: null,
            updated_at: new Date().toISOString()
          })
          .eq("id", instanceId);
        break;
      }

      case "webhookQrCode": {
        // W-API: QR code received
        console.log("QR Code received via webhookQrCode:", instanceId);
        
        const qrCode = payload.qrCode || payload.qr;
        
        await supabase
          .from("instances")
          .update({ 
            qr_code: qrCode,
            status: "qr_pending",
            updated_at: new Date().toISOString()
          })
          .eq("id", instanceId);
        break;
      }

      // =====================
      // Legacy/fallback events
      // =====================

      case "qr":
      case "qrcode":
        // QR Code received - update instance
        const qrCode = payload.qrcode || payload.data?.qrcode || payload.qr;
        console.log("QR Code event for instance:", instanceId);
        
        await supabase
          .from("instances")
          .update({ 
            qr_code: qrCode,
            status: "qr_pending",
            updated_at: new Date().toISOString()
          })
          .eq("id", instanceId);
        break;

      case "authenticated":
      case "connected":
      case "ready":
        // Instance connected successfully
        console.log("Instance connected:", instanceId);
        
        const connPhoneNumber = payload.phone || payload.data?.phone || payload.wid?.split("@")[0] || payload.connectedPhone;
        const connProfilePic = payload.profilePicUrl || payload.data?.profilePicUrl;
        
        await supabase
          .from("instances")
          .update({
            status: "connected",
            phone_number: connPhoneNumber || instance.phone_number,
            profile_picture_url: connProfilePic || instance.profile_picture_url,
            qr_code: null,
            updated_at: new Date().toISOString()
          })
          .eq("id", instanceId);
        break;

      case "disconnected":
      case "logout":
        // Instance disconnected
        console.log("Instance disconnected:", instanceId);
        
        await supabase
          .from("instances")
          .update({
            status: "disconnected",
            qr_code: null,
            updated_at: new Date().toISOString()
          })
          .eq("id", instanceId);
        break;

      case "message":
      case "messages.upsert": {
        // Legacy format: New message received
        const messageData = payload.data || payload.message || payload;
        console.log("Legacy message received:", JSON.stringify(messageData, null, 2));

        // Extract message details
        const remoteJid = messageData.key?.remoteJid || messageData.from || messageData.chatId;
        if (!remoteJid || remoteJid.includes("@g.us")) {
          // Skip group messages for now
          console.log("Skipping group message or invalid jid");
          break;
        }

        const contactPhone = remoteJid.replace("@s.whatsapp.net", "").replace("@c.us", "");
        const isFromMe = messageData.key?.fromMe || messageData.fromMe || false;
        const messageId = messageData.key?.id || messageData.id;
        const pushName = messageData.pushName || messageData.notifyName;

        // Get or create contact
        let { data: contact } = await supabase
          .from("contacts")
          .select("*")
          .eq("instance_id", instanceId)
          .eq("phone_number", contactPhone)
          .maybeSingle();

        if (!contact) {
          const { data: newContact, error: contactError } = await supabase
            .from("contacts")
            .insert({
              instance_id: instanceId,
              phone_number: contactPhone,
              push_name: pushName,
            })
            .select()
            .single();

          if (contactError) {
            console.error("Error creating contact:", contactError);
            break;
          }
          contact = newContact;
        } else if (pushName && pushName !== contact.push_name) {
          // Update push_name if changed
          await supabase
            .from("contacts")
            .update({ push_name: pushName })
            .eq("id", contact.id);
        }

        // Get or create conversation
        let { data: conversation } = await supabase
          .from("conversations")
          .select("*")
          .eq("instance_id", instanceId)
          .eq("contact_id", contact.id)
          .maybeSingle();

        if (!conversation) {
          const { data: newConversation, error: convError } = await supabase
            .from("conversations")
            .insert({
              instance_id: instanceId,
              contact_id: contact.id,
              status: "open",
              last_message_at: new Date().toISOString(),
            })
            .select()
            .single();

          if (convError) {
            console.error("Error creating conversation:", convError);
            break;
          }
          conversation = newConversation;
        }

        // Extract message content
        const msgContent = messageData.message?.conversation ||
          messageData.message?.extendedTextMessage?.text ||
          messageData.body ||
          messageData.content ||
          "";

        const messageType = messageData.message?.imageMessage ? "image" :
          messageData.message?.audioMessage ? "audio" :
          messageData.message?.videoMessage ? "video" :
          messageData.message?.documentMessage ? "document" :
          "text";

        // Insert message
        const { error: msgError } = await supabase
          .from("messages")
          .insert({
            instance_id: instanceId,
            contact_id: contact.id,
            conversation_id: conversation.id,
            whatsapp_message_id: messageId,
            direction: isFromMe ? "outgoing" : "incoming",
            message_type: messageType,
            content: msgContent,
            status: isFromMe ? "sent" : "delivered",
            is_from_bot: false,
          });

        if (msgError) {
          console.error("Error inserting message:", msgError);
          break;
        }

        // Update conversation
        const unreadIncrement = isFromMe ? 0 : 1;
        await supabase
          .from("conversations")
          .update({
            last_message_at: new Date().toISOString(),
            unread_count: (conversation.unread_count || 0) + unreadIncrement,
          })
          .eq("id", conversation.id);

        console.log("Message saved successfully");
        break;
      }

      case "message_ack":
      case "ack":
        // Message status update
        const ackMsgId = payload.id || payload.data?.id;
        const ackStatus = payload.ack || payload.data?.ack;
        
        let statusText = "sent";
        if (ackStatus === 2 || ackStatus === "delivered") statusText = "delivered";
        if (ackStatus === 3 || ackStatus === "read") statusText = "read";

        if (ackMsgId) {
          await supabase
            .from("messages")
            .update({ status: statusText })
            .eq("whatsapp_message_id", ackMsgId);
        }
        break;

      default:
        console.log("Unhandled event:", event);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
