// Type definitions for Bitrix24 JavaScript SDK
// Based on: https://dev.1c-bitrix.ru/rest_help/js_library/index.php

declare global {
  interface Window {
    BX24?: Bitrix24SDK;
  }
}

/**
 * Main Bitrix24 SDK interface
 */
export interface Bitrix24SDK {
  /**
   * Initialize the Bitrix24 application
   * Must be called before using any other BX24 methods
   */
  init(callback: () => void): void;

  /**
   * Resize the iframe to fit the content
   */
  fitWindow(): void;

  /**
   * Resize the iframe to specific dimensions
   */
  resizeWindow(width: number, height: number): void;

  /**
   * Close the application slider/popup
   * @param params - Optional parameters including result status
   */
  closeApplication(params?: { result?: string }): void;

  /**
   * Call a Bitrix24 REST API method
   * @param method - The REST API method name (e.g., "user.current", "crm.deal.list")
   * @param params - Parameters to pass to the method
   * @param callback - Callback function to handle the result
   */
  callMethod<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    callback: (result: BX24Result<T>) => void
  ): void;
}

/**
 * Result object returned from REST API calls
 */
export interface BX24Result<T> {
  /**
   * Get the data returned from the API call
   */
  data(): T;

  /**
   * Get error message if the call failed
   * Returns null if successful
   */
  error(): string | null;
}

/**
 * Application info returned from app.info method
 */
export interface BX24AppInfo {
  member_id?: string;
  DOMAIN?: string;
  LANG?: string;
  status?: string;
}

/**
 * Open Line (Channel) information
 */
export interface BX24OpenLine {
  ID: string;
  NAME: string;
  ACTIVE: "Y" | "N";
  connector_active?: boolean | string | number;
}

// Export empty object to make this a module
export {};
