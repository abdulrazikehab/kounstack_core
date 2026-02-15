
import { Logger } from '@nestjs/common';

const SENSITIVE_KEYS = [
  'password',
  'token',
  'secret',
  'otp',
  'verificationCode',
  'authorization',
  'apiKey',
  'api_key',
  'client_secret',
  'access_token',
  'refresh_token',
  'cvv',
  'cvc',
  'credit_card',
  'card_number',
];

/**
 * Deeply redact sensitive keys in an object.
 * Returns a new object/value with sensitive data replaced by '[REDACTED]'.
 */
export function redactSensitive(obj: any): any {
  if (!obj) return obj;

  if (typeof obj === 'string') {
    // Basic heuristic: if it looks like a long token or contains sensitive keywords in a query string structure
    // This is hard to do perfectly on strings without context, so we primarily handle objects.
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(redactSensitive);
  }

  if (typeof obj === 'object') {
    const newObj: any = {};
    for (const key of Object.keys(obj)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.some((s) => lowerKey.includes(s))) {
        newObj[key] = '[REDACTED]';
      } else {
        newObj[key] = redactSensitive(obj[key]);
      }
    }
    return newObj;
  }

  return obj;
}

/**
 * Safely stringify an object with redaction and length limit.
 */
export function safeStringify(obj: any, maxLength = 2048): string {
  try {
    const redacted = redactSensitive(obj);
    const str = JSON.stringify(redacted);
    if (str.length > maxLength) {
      return str.substring(0, maxLength) + '... [TRUNCATED]';
    }
    return str;
  } catch (err) {
    return '[Unable to stringify object]';
  }
}

/**
 * Helper to log data safely.
 */
export function safeLog(logger: Logger, message: string, data?: any) {
  if (data) {
    logger.log(`${message} ${safeStringify(data)}`);
  } else {
    logger.log(message);
  }
}
