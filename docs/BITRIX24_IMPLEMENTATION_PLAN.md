# Bitrix24 Integration - Security Implementation Plan

This document provides actionable steps to address all findings from the security audit.

## Phase 1: Critical Security Fixes (COMPLETED ✅)

### 1.1 Remove Exposed Credentials ✅
- [x] Remove .env from git tracking
- [x] Add .env to .gitignore explicitly
- [x] Create .env.example with dummy values
- [x] Document environment setup in README

**Action Required by Repository Owner**:
1. Rotate Supabase anon key immediately:
   - Go to Supabase Dashboard → Project Settings → API
   - Click "Reset anon key"
   - Update .env with new key
2. Review git history for exposed secrets:
   ```bash
   git log --all --full-history -- .env
   ```
3. Consider using BFG Repo-Cleaner to remove from history if needed

---

## Phase 2: Add Bitrix24 Signature Validation

### 2.1 Create Signature Validation Utility

**File**: `supabase/functions/_shared/bitrix24-auth.ts`

```typescript
import { createHash } from "node:crypto";

export interface Bitrix24Event {
  event?: string;
  auth?: {
    access_token?: string;
    domain?: string;
    member_id?: string;
    application_token?: string;
  };
  data?: unknown;
  ts?: string;
}

/**
 * Validates Bitrix24 event signature
 * 
 * @param body - Raw request body
 * @param signature - Signature from X-Bitrix-Signature header
 * @param applicationToken - Application token from integration config
 * @returns true if signature is valid
 */
export function validateBitrix24Signature(
  body: string,
  signature: string | null,
  applicationToken: string
): boolean {
  if (!signature || !applicationToken) {
    return false;
  }

  // Bitrix24 signature format: HMAC-SHA256(body, application_token)
  const hmac = createHash('sha256');
  hmac.update(body + applicationToken);
  const expectedSignature = hmac.digest('hex');

  // Constant-time comparison to prevent timing attacks
  return timingSafeEqual(signature, expectedSignature);
}

/**
 * Timing-safe string comparison
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Extract integration ID from event payload
 */
export function extractIntegrationId(payload: Bitrix24Event): string | null {
  return payload.auth?.member_id || payload.auth?.domain || null;
}
```

### 2.2 Update bitrix24-events to Use Validation

**File**: `supabase/functions/bitrix24-events/index.ts`

Add at the top:
```typescript
import { validateBitrix24Signature, extractIntegrationId } from "../_shared/bitrix24-auth.ts";
```

Add validation after parsing payload:
```typescript
// Get signature from header
const signature = req.headers.get("x-bitrix-signature");

// Extract integration ID
const integrationId = extractIntegrationId(payload);

if (integrationId) {
  // Load integration to get application_token
  const { data: integration } = await supabase
    .from("integrations")
    .select("config")
    .eq("type", "bitrix24")
    .eq("config->>member_id", integrationId)
    .maybeSingle();

  if (integration?.config?.application_token) {
    // Validate signature
    const isValid = validateBitrix24Signature(
      bodyText,
      signature,
      integration.config.application_token
    );

    if (!isValid) {
      console.error("Invalid Bitrix24 signature");
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 401, headers: corsHeaders }
      );
    }
  }
}
```

### 2.3 Add Rate Limiting

**File**: `supabase/functions/_shared/rate-limiter.ts`

```typescript
interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export async function checkRateLimit(
  key: string,
  config: RateLimitConfig = { maxRequests: 100, windowMs: 60000 }
): Promise<{ allowed: boolean; resetAt: number }> {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  // Clean up expired entries
  if (entry && entry.resetAt < now) {
    rateLimitStore.delete(key);
  }

  const current = rateLimitStore.get(key);

  if (!current) {
    // First request in window
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + config.windowMs
    });
    return { allowed: true, resetAt: now + config.windowMs };
  }

  if (current.count >= config.maxRequests) {
    // Rate limit exceeded
    return { allowed: false, resetAt: current.resetAt };
  }

  // Increment counter
  current.count++;
  rateLimitStore.set(key, current);
  return { allowed: true, resetAt: current.resetAt };
}
```

Use in bitrix24-events:
```typescript
// Rate limit by integration_id
const rateLimitKey = `bitrix24:${integrationId}`;
const rateLimit = await checkRateLimit(rateLimitKey);

if (!rateLimit.allowed) {
  return new Response(
    JSON.stringify({ 
      error: "Rate limit exceeded",
      resetAt: new Date(rateLimit.resetAt).toISOString()
    }),
    { 
      status: 429,
      headers: {
        ...corsHeaders,
        "Retry-After": Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString()
      }
    }
  );
}
```

---

## Phase 3: TypeScript Type Safety

### 3.1 Create Bitrix24 Type Definitions

**File**: `src/types/bitrix24.d.ts`

```typescript
declare global {
  interface Window {
    BX24?: Bitrix24SDK;
  }
}

export interface Bitrix24SDK {
  init(callback: () => void): void;
  fitWindow(): void;
  resizeWindow(width: number, height: number): void;
  closeApplication(params?: { result?: string }): void;
  
  callMethod<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    callback: (result: BX24Result<T>) => void
  ): void;
  
  callBatch<T = Record<string, unknown>>(
    calls: Record<string, [string, Record<string, unknown>]>,
    callback: (result: BX24BatchResult<T>) => void
  ): void;
}

export interface BX24Result<T> {
  data(): T;
  error(): string | null;
  more(): boolean;
  total(): number;
}

export interface BX24BatchResult<T> {
  [key: string]: T;
}

export interface BX24AppInfo {
  member_id: string;
  DOMAIN: string;
  LANG: string;
  status: string;
}

export interface BX24ConnectorInfo {
  ID: string;
  NAME: string;
  ICON_PATH: string;
}

export interface BX24OpenLine {
  ID: string;
  NAME: string;
  ACTIVE: "Y" | "N";
  connector_active?: boolean | string | number;
  CAN_UPDATE_NAME: boolean;
}

export {};
```

### 3.2 Fix Bitrix24App.tsx Types

Replace `any` types:
```typescript
// Before
window.BX24.callMethod("app.info", {}, (result: any) => {

// After
import type { BX24Result, BX24AppInfo } from "@/types/bitrix24";

window.BX24?.callMethod<BX24AppInfo>(
  "app.info", 
  {}, 
  (result: BX24Result<BX24AppInfo>) => {
    const appInfo = result.data();
    if (appInfo?.member_id) setMemberId(appInfo.member_id);
    if (appInfo?.DOMAIN) setDomain(appInfo.DOMAIN);
  }
);
```

### 3.3 Fix @ts-ignore Comments

Replace all `@ts-ignore` with `@ts-expect-error`:
```typescript
// Before
// @ts-ignore - Bitrix24 JS SDK
window.BX24.init(() => { ... });

// After
// @ts-expect-error - Bitrix24 JS SDK types will be available after types/bitrix24.d.ts is processed
window.BX24?.init(() => { ... });
```

---

## Phase 4: Improve RLS Policies

### 4.1 Fix bitrix_debug_logs Policy

**File**: New migration `supabase/migrations/YYYYMMDDHHMMSS_fix_rls_policies.sql`

```sql
-- Drop old policy
DROP POLICY IF EXISTS "Users can view logs of their workspaces" ON public.bitrix_debug_logs;

-- Create stricter policy for workspace logs
CREATE POLICY "Users can view workspace logs"
ON public.bitrix_debug_logs
FOR SELECT
USING (
  workspace_id IS NOT NULL 
  AND EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id = bitrix_debug_logs.workspace_id
    AND wm.user_id = auth.uid()
  )
);

-- Create policy for system logs (admin only)
CREATE POLICY "Admins can view system logs"
ON public.bitrix_debug_logs
FOR SELECT
USING (
  workspace_id IS NULL
  AND EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
  )
);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_bitrix_debug_logs_workspace 
ON public.bitrix_debug_logs(workspace_id) 
WHERE workspace_id IS NOT NULL;
```

### 4.2 Add Token Encryption

**File**: New migration `supabase/migrations/YYYYMMDDHHMMSS_encrypt_tokens.sql`

```sql
-- Enable pgcrypto extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create function to encrypt sensitive data
CREATE OR REPLACE FUNCTION encrypt_secret(secret TEXT, key TEXT DEFAULT current_setting('app.encryption_key'))
RETURNS TEXT AS $$
BEGIN
  RETURN encode(pgp_sym_encrypt(secret, key), 'base64');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to decrypt sensitive data
CREATE OR REPLACE FUNCTION decrypt_secret(encrypted TEXT, key TEXT DEFAULT current_setting('app.encryption_key'))
RETURNS TEXT AS $$
BEGIN
  RETURN pgp_sym_decrypt(decode(encrypted, 'base64'), key);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL; -- Return NULL if decryption fails
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comment
COMMENT ON FUNCTION encrypt_secret IS 'Encrypts sensitive data using symmetric encryption';
COMMENT ON FUNCTION decrypt_secret IS 'Decrypts sensitive data encrypted with encrypt_secret';
```

Update Edge Functions to use encryption:
```typescript
// Encrypt before storing
await supabase
  .from("integrations")
  .update({
    config: {
      ...config,
      access_token: await encryptToken(data.access_token),
      refresh_token: await encryptToken(data.refresh_token),
    }
  });

// Decrypt after reading
const decryptedToken = await decryptToken(integration.config.access_token);
```

---

## Phase 5: Improve Error Handling

### 5.1 Create Standard Response Helpers

**File**: `supabase/functions/_shared/responses.ts`

```typescript
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  timestamp: string;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  details?: unknown;
  timestamp: string;
  requestId?: string;
}

export function apiSuccess<T>(data: T, status = 200): Response {
  const response: ApiSuccessResponse<T> = {
    success: true,
    data,
    timestamp: new Date().toISOString()
  };
  
  return new Response(
    JSON.stringify(response),
    { 
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    }
  );
}

export function apiError(
  error: string, 
  status = 400,
  details?: unknown,
  requestId?: string
): Response {
  const response: ApiErrorResponse = {
    success: false,
    error,
    details,
    timestamp: new Date().toISOString(),
    requestId
  };
  
  return new Response(
    JSON.stringify(response),
    { 
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    }
  );
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8"
    }
  });
}
```

Usage:
```typescript
// Success response
return apiSuccess({ 
  integration_id: integration.id,
  status: "active"
});

// Error response
return apiError(
  "Integration not found",
  404,
  { member_id: memberId },
  requestId
);
```

---

## Phase 6: Add Database Constraints

### 6.1 Add CHECK Constraints

**File**: New migration `supabase/migrations/YYYYMMDDHHMMSS_add_constraints.sql`

```sql
-- Add CHECK constraint for bitrix_debug_logs level
ALTER TABLE public.bitrix_debug_logs
ADD CONSTRAINT valid_log_level 
CHECK (level IN ('debug', 'info', 'warn', 'error', 'api_call', 'api_response'));

-- Add CHECK constraint for integrations type
ALTER TABLE public.integrations
ADD CONSTRAINT valid_integration_type
CHECK (type IN ('bitrix24', 'gupshup', 'elevenlabs', 'openai'));

-- Add NOT NULL constraints where appropriate
ALTER TABLE public.bitrix_debug_logs
ALTER COLUMN function_name SET NOT NULL,
ALTER COLUMN level SET NOT NULL,
ALTER COLUMN message SET NOT NULL;

-- Add CHECK for valid JSON in config columns
ALTER TABLE public.integrations
ADD CONSTRAINT valid_config_json
CHECK (jsonb_typeof(config) = 'object');

-- Comment
COMMENT ON CONSTRAINT valid_log_level ON public.bitrix_debug_logs 
IS 'Ensures log level is one of the allowed values';
```

---

## Phase 7: React Best Practices

### 7.1 Fix useEffect Dependencies

**File**: `src/pages/Bitrix24App.tsx`

```typescript
// Before
useEffect(() => {
  if (memberId) {
    loadData();
  }
}, [memberId, domain]);  // ❌ Missing loadData

// After - Wrap loadData in useCallback
const loadData = useCallback(async () => {
  try {
    setView("loading");
    
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/bitrix24-install?member_id=${encodeURIComponent(memberId || "")}&include_instances=true`
    );
    // ... rest of the code
  } catch (err) {
    console.error("Error loading data:", err);
    setError("Erro ao carregar dados");
    setView("token");
  }
}, [memberId]); // Only depends on memberId

useEffect(() => {
  if (memberId) {
    loadData();
  } else {
    // ... timeout logic
  }
}, [memberId, domain, loadData]);  // ✅ All dependencies included
```

### 7.2 Fix Fast Refresh Warnings

Move constants outside components:
```typescript
// Before (inside component)
const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  // ...
];

// After (outside component)
const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  // ...
] as const;

export default function Bitrix24App() {
  // Use NAV_ITEMS
}
```

---

## Phase 8: Enable Strict TypeScript

### 8.1 Update tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    /* Linting - Enable ALL strict checks */
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "forceConsistentCasingInFileNames": true,
    
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

---

## Testing Checklist

After implementing fixes, test:

- [ ] OAuth flow (Marketplace app)
- [ ] Webhook flow (Local app)
- [ ] Token validation
- [ ] Signature validation
- [ ] Rate limiting
- [ ] RLS policies
- [ ] Iframe embedding
- [ ] Connector activation
- [ ] Event handling
- [ ] Error responses
- [ ] TypeScript compilation
- [ ] ESLint passes

---

## Monitoring & Maintenance

### Add Health Check Endpoint

**File**: `supabase/functions/health/index.ts`

```typescript
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    services: {
      database: await checkDatabase(),
      storage: await checkStorage(),
    }
  };

  return apiSuccess(health);
});
```

### Add Log Retention Policy

```sql
-- Auto-delete logs older than 30 days
CREATE OR REPLACE FUNCTION cleanup_old_debug_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM public.bitrix_debug_logs
  WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule cleanup (using pg_cron extension)
SELECT cron.schedule(
  'cleanup-debug-logs',
  '0 2 * * *',  -- 2 AM daily
  $$SELECT cleanup_old_debug_logs()$$
);
```

---

**End of Implementation Plan**
