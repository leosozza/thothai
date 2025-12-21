# Bitrix24 Integration Improvements

This document describes the improvements made to the Bitrix24 integration to fix iframe embedding issues, improve connector activation flow, and add robust debugging capabilities.

## Changes Summary

### 1. Enhanced Headers for Iframe Embedding (`bitrix24-connector-settings`)

**Problem:** Bitrix24 Contact Center opens the PLACEMENT_HANDLER in an iframe, requiring specific CSP headers for proper embedding.

**Solution:**
- Updated `Content-Security-Policy` header with specific `frame-ancestors` directive
- Configured CSP to allow embedding from all Bitrix24 domains:
  - `*.bitrix24.com`
  - `*.bitrix24.com.br`
  - `*.bitrix24.eu`
  - `*.bitrix24.es`
  - `*.bitrix24.de`
- Removed deprecated `X-Frame-Options` header (conflicts with CSP)
- Added meta CSP tags in HTML as fallback for CDN/proxy overrides

**Headers Configuration:**
```http
Content-Security-Policy: default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: blob:; connect-src *; frame-ancestors 'self' https://*.bitrix24.com https://*.bitrix24.com.br https://*.bitrix24.eu https://*.bitrix24.es https://*.bitrix24.de; font-src * data:
Content-Type: text/html; charset=utf-8
```

### 2. Improved Connector Activation Flow (`bitrix24-register`)

**Problem:** Discrepancy between `ACTIVE: "Y"` field and `connector_active: false` in API responses, making it difficult to verify if connector is truly active.

**Solution:**
- Enhanced `imconnector.activate` API integration with detailed step logging
- Added verification step using `imopenlines.config.list.get` API
- Check both `ACTIVE` field and `connector_active` field
- Store verified status in integration config with `connector_active` and `activation_verified` fields
- Added `last_activation_check` timestamp for troubleshooting

**Activation Flow:**
```
1. Call imconnector.activate with CONNECTOR, LINE, ACTIVE parameters
2. Call imconnector.connector.data.set to configure webhook URL
3. Verify activation via imopenlines.config.list.get
4. Check both ourLine.ACTIVE === "Y" and ourLine.connector_active === true
5. Store verified status in database
```

### 3. Enhanced Debug Logging

**Added logging in `bitrix24-connector-settings`:**
- Request method (GET/POST)
- Timestamp
- Request headers (referer, origin, user-agent, content-type)
- Parsed parameters (AUTH_ID, DOMAIN, member_id, PLACEMENT)
- Connector ID, Line ID, Active Status during activation
- Step-by-step activation results
- Status verification results

**Added logging in `bitrix24-register`:**
- Request method and timestamp
- Full request body
- Action type
- Connector activation steps with detailed API responses
- imopenlines.config.list.get verification results
- ACTIVE field vs connector_active field comparison

### 4. New Test Endpoint (`bitrix24-iframe-test`)

A minimalist endpoint for validating iframe embedding and header configuration.

**Features:**
- HTML format: Interactive test page with status indicators
- JSON format: Machine-readable header information
- Automatic tests for:
  - Iframe detection
  - BX24 API availability
  - Document referrer
  - CSP meta tag presence
- Real-time timestamp updates
- Request header logging

**Usage:**

HTML format (interactive):
```
GET https://<your-domain>/functions/v1/bitrix24-iframe-test
```

JSON format (programmatic):
```
GET https://<your-domain>/functions/v1/bitrix24-iframe-test?format=json
```

Embedded test:
```
GET https://<your-domain>/functions/v1/bitrix24-iframe-test?embed=true
```

### 5. Enhanced Test Functions (`bitrix24-test`)

**Updated `check_connector` action:**
- Added imopenlines.config.list.get verification
- Check both `ACTIVE` field and `connector_active` field
- Provide detailed status summary with both fields
- Enhanced diagnosis messages with emoji indicators

## Testing Instructions

### 1. Test Iframe Headers

```bash
# Direct access
curl -i https://<your-domain>/functions/v1/bitrix24-iframe-test

# JSON format
curl https://<your-domain>/functions/v1/bitrix24-iframe-test?format=json
```

Check for:
- `Content-Security-Policy` header with correct `frame-ancestors`
- `Content-Type: text/html; charset=utf-8`
- No `X-Frame-Options` header (deprecated)

### 2. Test Connector Activation

```bash
# Register connector (will activate automatically)
curl -X POST https://<your-domain>/functions/v1/bitrix24-register \
  -H "Content-Type: application/json" \
  -d '{
    "member_id": "your-member-id",
    "connector_id": "thoth_whatsapp",
    "instance_id": "your-instance-id",
    "integration_id": "your-integration-id"
  }'
```

Look for:
- `connector_active: true` in response
- `activation_verified: true`
- `status_verification: "VERIFIED_ACTIVE"`

### 3. Check Connector Status

```bash
# Check connector status
curl -X POST https://<your-domain>/functions/v1/bitrix24-test \
  -H "Content-Type: application/json" \
  -d '{
    "integration_id": "your-integration-id",
    "action": "check_connector"
  }'
```

Look for:
- `connector_active: true` field
- `status_summary.overall_active: true`
- Diagnosis message with ✓ indicator

## Troubleshooting

### Iframe Not Loading

1. Check browser console for CSP violations
2. Test with `bitrix24-iframe-test` endpoint
3. Verify Bitrix24 domain is in allowed `frame-ancestors`
4. Check if CDN/proxy is overriding headers

### Connector Shows as Inactive

1. Use `check_connector` action in `bitrix24-test`
2. Check both `ACTIVE` and `connector_active` fields
3. Verify via Bitrix24 UI: Contact Center → Open Lines
4. Re-activate using activation flow

## API Changes

### New Fields in Integration Config

```typescript
{
  connector_active: boolean;           // Verified active status
  activation_verified: boolean;        // Indicates verification was done
  last_activation_check: string;       // ISO timestamp of last check
}
```

### New Response Fields

**bitrix24-register response:**
```typescript
{
  connector_active: boolean;
  status_verification: "VERIFIED_ACTIVE" | "PENDING_MANUAL_ACTIVATION";
}
```

**bitrix24-test check_connector response:**
```typescript
{
  line_config: { ACTIVE: string; connector_active: boolean };
  status_summary: {
    registered: boolean;
    active_via_status: boolean;
    active_via_config: boolean;
    overall_active: boolean;
  };
}
```

## References

- [Bitrix24 REST API Documentation](https://dev.1c-bitrix.ru/rest_help/)
- [Content Security Policy (CSP)](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [Bitrix24 Connector API](https://dev.1c-bitrix.ru/rest_help/scope_im/imconnector/)
- [Bitrix24 Open Lines API](https://dev.1c-bitrix.ru/rest_help/scope_im/imopenlines/)
