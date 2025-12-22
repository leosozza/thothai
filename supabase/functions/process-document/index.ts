import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHUNK_SIZE = 1000; // characters per chunk
const CHUNK_OVERLAP = 200; // overlap between chunks

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { document_id } = await req.json();

    if (!document_id) {
      return new Response(
        JSON.stringify({ error: "document_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing document: ${document_id}`);

    // Get document details
    const { data: doc, error: docError } = await supabase
      .from("knowledge_documents")
      .select("*")
      .eq("id", document_id)
      .single();

    if (docError || !doc) {
      console.error("Document not found:", docError);
      return new Response(
        JSON.stringify({ error: "Document not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update status to processing
    await supabase
      .from("knowledge_documents")
      .update({ status: "processing" })
      .eq("id", document_id);

    let extractedText = "";

    // Handle different source types
    if (doc.source_type === "manual" && doc.content) {
      // Manual text - already have content
      extractedText = doc.content;
      console.log("Using manual content, length:", extractedText.length);
    } else if (doc.source_type === "url" && doc.source_url) {
      // URL - fetch and extract text
      extractedText = await extractFromUrl(doc.source_url, lovableApiKey);
      console.log("Extracted from URL, length:", extractedText.length);
    } else if (doc.source_type === "document" && doc.file_path) {
      // File - download and extract
      extractedText = await extractFromFile(supabase, doc.file_path, doc.file_type, lovableApiKey);
      console.log("Extracted from file, length:", extractedText.length);
    } else {
      throw new Error("No valid content source found");
    }

    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error("No text could be extracted from document");
    }

    // Split into chunks
    const chunks = splitIntoChunks(extractedText, CHUNK_SIZE, CHUNK_OVERLAP);
    console.log(`Created ${chunks.length} chunks`);

    // Delete existing chunks for this document
    await supabase
      .from("knowledge_chunks")
      .delete()
      .eq("document_id", document_id);

    // Insert new chunks
    const chunkRecords = chunks.map((content, index) => ({
      document_id,
      chunk_index: index,
      content,
      tokens_count: Math.ceil(content.length / 4), // Rough token estimate
    }));

    const { error: insertError } = await supabase
      .from("knowledge_chunks")
      .insert(chunkRecords);

    if (insertError) {
      console.error("Error inserting chunks:", insertError);
      throw insertError;
    }

    // Update document status and content
    await supabase
      .from("knowledge_documents")
      .update({
        status: "completed",
        content: extractedText.substring(0, 10000), // Store first 10k chars
        chunks_count: chunks.length,
      })
      .eq("id", document_id);

    console.log(`Document ${document_id} processed successfully`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        chunks_count: chunks.length,
        text_length: extractedText.length 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error processing document:", error);

    // Update document status to failed
    try {
      const { document_id } = await req.clone().json();
      if (document_id) {
        await supabase
          .from("knowledge_documents")
          .update({ status: "failed" })
          .eq("id", document_id);
      }
    } catch (e) {
      console.error("Failed to update document status:", e);
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Processing failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Split text into overlapping chunks
function splitIntoChunks(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  const cleanText = text.replace(/\s+/g, " ").trim();
  
  if (cleanText.length <= chunkSize) {
    return [cleanText];
  }

  let start = 0;
  while (start < cleanText.length) {
    let end = start + chunkSize;
    
    // Try to break at sentence or word boundary
    if (end < cleanText.length) {
      const lastPeriod = cleanText.lastIndexOf(".", end);
      const lastNewline = cleanText.lastIndexOf("\n", end);
      const lastSpace = cleanText.lastIndexOf(" ", end);
      
      if (lastPeriod > start + chunkSize / 2) {
        end = lastPeriod + 1;
      } else if (lastNewline > start + chunkSize / 2) {
        end = lastNewline + 1;
      } else if (lastSpace > start) {
        end = lastSpace + 1;
      }
    }

    chunks.push(cleanText.slice(start, end).trim());
    start = end - overlap;
    
    if (start < 0) start = 0;
    if (start >= cleanText.length) break;
  }

  return chunks.filter(chunk => chunk.length > 50); // Filter out tiny chunks
}

// Extract text from URL using AI
async function extractFromUrl(url: string, apiKey: string | undefined): Promise<string> {
  try {
    // First try to fetch the page directly
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ThothBot/1.0)",
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status}`);
    }

    const html = await response.text();
    
    // Simple HTML to text extraction
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();

    // If we have Lovable AI, use it to clean up the text
    if (apiKey && text.length > 100) {
      text = await cleanTextWithAI(text.substring(0, 15000), apiKey);
    }

    return text;
  } catch (error) {
    console.error("Error extracting from URL:", error);
    throw error;
  }
}

// Extract text from file
async function extractFromFile(
  supabase: any, 
  filePath: string, 
  fileType: string | null,
  apiKey: string | undefined
): Promise<string> {
  try {
    // Download file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("knowledge-documents")
      .download(filePath);

    if (downloadError) {
      console.error("Download error:", downloadError);
      throw new Error("Failed to download file");
    }

    const fileBuffer = await fileData.arrayBuffer();
    const extension = filePath.split(".").pop()?.toLowerCase() || "";
    
    // Handle text-based files directly
    if (["txt", "csv", "md", "json"].includes(extension) || 
        fileType?.includes("text/")) {
      const decoder = new TextDecoder("utf-8");
      return decoder.decode(fileBuffer);
    }

    // For PDF and Word files, use AI to extract text from base64
    const base64Content = btoa(
      new Uint8Array(fileBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
    );

    if (apiKey) {
      // Use AI to extract and summarize document content
      return await extractWithAI(base64Content, extension, apiKey);
    }

    // Fallback: try to decode as text
    try {
      const decoder = new TextDecoder("utf-8");
      const text = decoder.decode(fileBuffer);
      // Check if it's readable text
      if (text.match(/[\x00-\x08\x0E-\x1F]/)) {
        throw new Error("Binary file detected");
      }
      return text;
    } catch {
      throw new Error(`Cannot extract text from ${extension} files without AI processing`);
    }
  } catch (error) {
    console.error("Error extracting from file:", error);
    throw error;
  }
}

// Use Lovable AI to extract text from document
async function extractWithAI(base64Content: string, fileType: string, apiKey: string): Promise<string> {
  // For PDFs and complex documents, we describe the extraction task
  const prompt = `You are a document text extractor. The user has uploaded a ${fileType.toUpperCase()} document.
  
Your task is to:
1. Extract all readable text content from this document
2. Preserve the document structure (headings, paragraphs, lists)
3. Remove any formatting artifacts or garbage characters
4. Return clean, readable text

The document content is encoded in base64. Extract and return the text content only.

Note: If this is a binary file that cannot be parsed, describe what you can see and provide any extractable text.`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: prompt },
          { 
            role: "user", 
            content: `Please extract the text from this ${fileType} document. Base64 content (first 10000 chars): ${base64Content.substring(0, 10000)}`
          },
        ],
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI extraction error:", response.status, errorText);
      throw new Error(`AI extraction failed: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  } catch (error) {
    console.error("AI extraction error:", error);
    throw error;
  }
}

// Clean up extracted text using AI
async function cleanTextWithAI(rawText: string, apiKey: string): Promise<string> {
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { 
            role: "system", 
            content: "You are a text cleaner. Extract the main content from the provided webpage text, removing navigation, ads, footers, and other non-content elements. Return only the main article/page content in clean, readable format." 
          },
          { role: "user", content: rawText },
        ],
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      console.error("AI cleanup failed, using raw text");
      return rawText;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || rawText;
  } catch {
    return rawText;
  }
}
