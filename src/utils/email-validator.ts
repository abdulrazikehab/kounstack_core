/**
 * Email Validator Utility
 * Checks for disposable/fake email addresses and validates email format
 * ENHANCED: Now includes domain MX record validation
 * - Local check: disposable-email-domains (fast)
 * - API check: Kickbox (only on signup)
 */

import * as dns from 'dns';
import { randomInt } from 'crypto';
import { promisify } from 'util';
import disposableDomains from 'disposable-email-domains';
import * as Kickbox from 'kickbox';

const resolveMx = promisify(dns.resolveMx);

// Initialize Kickbox client (only if API key is provided)
let kickboxClient: any = null;
const KICKBOX_API_KEY = process.env.KICKBOX_API_KEY;
if (KICKBOX_API_KEY) {
  kickboxClient = Kickbox.client(KICKBOX_API_KEY).kickbox();
}

// Use disposable-email-domains package for comprehensive list
// This is a fast local check
// The package exports an array of domain strings
const DISPOSABLE_EMAIL_DOMAINS_SET = new Set(disposableDomains as string[]);

// Additional suspicious domains not in the package
const ADDITIONAL_SUSPICIOUS_DOMAINS = [
  'test.com', 'example.com', 'example.org', 'example.net',
  'asd.com', 'asdf.com', 'qwerty.com', 'abc.com', 'xyz.com',
  'fake.com', 'test.org', 'testing.com', 'noemail.com', 'none.com',
];

// Suspicious email patterns
const SUSPICIOUS_PATTERNS = [
  /^test/i,
  /^fake/i,
  /^temp/i,
  /^spam/i,
  /^trash/i,
  /^junk/i,
  /^asdf/i,
  /^qwerty/i,
  /^xxx/i,
  /^asd$/i,
  /^abc$/i,
  /^\d{10,}@/,  // Emails starting with lots of numbers
  /^[a-z]{1,2}\d{5,}@/i,  // Pattern like a12345@
];

// Known valid email providers (skip MX check for these)
const KNOWN_VALID_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com',
  'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'protonmail.com', 'proton.me', 'zoho.com', 'mail.com',
  'gmx.com', 'gmx.net', 'yandex.com', 'yandex.ru', 'fastmail.com',
];

export interface EmailValidationResult {
  isValid: boolean;
  reason?: string;
  isFake?: boolean;
  isDisposable?: boolean;
  isSuspicious?: boolean;
  hasMxRecord?: boolean;
  kickboxResult?: {
    result: string;
    reason: string;
    role: boolean;
    free: boolean;
    disposable: boolean;
    acceptAll: boolean;
    didYouMean?: string;
  };
}

/**
 * Validates an email address for format and checks if it's disposable/fake
 * Synchronous version (no MX check)
 */
export function validateEmail(email: string): EmailValidationResult {
  if (!email || typeof email !== 'string') {
    return {
      isValid: false,
      reason: 'Email is required',
      isFake: true,
    };
  }

  // Basic format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return {
      isValid: false,
      reason: 'Invalid email format',
      isFake: true,
    };
  }

  const normalizedEmail = email.toLowerCase().trim();
  const [localPart, domain] = normalizedEmail.split('@');

  // Check for disposable domains using disposable-email-domains package (fast local check)
  if (DISPOSABLE_EMAIL_DOMAINS_SET.has(domain) || ADDITIONAL_SUSPICIOUS_DOMAINS.includes(domain)) {
    return {
      isValid: false,
      reason: 'Disposable email addresses are not allowed',
      isDisposable: true,
      isFake: true,
    };
  }

  // Check for suspicious patterns in local part
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(localPart)) {
      return {
        isValid: false,
        reason: 'Email appears to be fake or temporary',
        isSuspicious: true,
        isFake: true,
      };
    }
  }

  // Check for very short or very long local parts
  if (localPart.length < 2 || localPart.length > 64) {
    return {
      isValid: false,
      reason: 'Invalid email format',
      isFake: true,
    };
  }

  // Check for suspicious domain patterns
  if (domain.includes('temp') || domain.includes('fake') || domain.includes('trash')) {
    return {
      isValid: false,
      reason: 'Suspicious email domain',
      isDisposable: true,
      isFake: true,
    };
  }

  // Check for too many numbers in domain (often fake)
  const domainNumberCount = (domain.match(/\d/g) || []).length;
  if (domainNumberCount > 4) {
    return {
      isValid: false,
      reason: 'Suspicious email domain',
      isSuspicious: true,
      isFake: true,
    };
  }

  // Check for very short domains (likely fake)
  const domainParts = domain.split('.');
  if (domainParts[0].length < 3 && !KNOWN_VALID_DOMAINS.includes(domain)) {
    return {
      isValid: false,
      reason: 'Suspicious email domain',
      isSuspicious: true,
      isFake: true,
    };
  }

  return {
    isValid: true,
    isFake: false,
    isDisposable: false,
    isSuspicious: false,
  };
}

/**
 * Validates an email address with MX record check
 * Async version - use this for thorough validation
 */
export async function validateEmailWithMx(email: string): Promise<EmailValidationResult> {
  // First run basic validation (includes disposable-email-domains check)
  const basicResult = validateEmail(email);
  if (!basicResult.isValid) {
    return basicResult;
  }

  const normalizedEmail = email.toLowerCase().trim();
  const domain = normalizedEmail.split('@')[1];

  // Skip MX check for known valid domains
  if (KNOWN_VALID_DOMAINS.includes(domain)) {
    return {
      ...basicResult,
      hasMxRecord: true,
    };
  }

  // Check MX records
  try {
    const mxRecords = await resolveMx(domain);
    if (!mxRecords || mxRecords.length === 0) {
      return {
        isValid: false,
        reason: 'Email domain does not have valid mail servers',
        isFake: true,
        hasMxRecord: false,
      };
    }
    return {
      ...basicResult,
      hasMxRecord: true,
    };
  } catch (error) {
    // DNS lookup failed - domain likely doesn't exist or has no MX records
    return {
      isValid: false,
      reason: 'Email domain is not valid or does not accept emails',
      isFake: true,
      hasMxRecord: false,
    };
  }
}

/**
 * Validates an email address with Kickbox API (only on signup)
 * This is an additional API check after local validation
 */
export async function validateEmailWithKickbox(email: string): Promise<EmailValidationResult> {
  // First run local validation (fast check)
  const localResult = await validateEmailWithMx(email);
  if (!localResult.isValid) {
    return localResult;
  }

  // If Kickbox is not configured, return local validation result
  if (!kickboxClient) {
    return localResult;
  }

  // Run Kickbox API check
  try {
    return new Promise((resolve) => {
      kickboxClient.verify(email, (err: any, response: any) => {
        if (err) {
          // If API error, fall back to local validation
          console.warn('Kickbox API error:', err);
          resolve(localResult);
          return;
        }

        const kickboxResult = response.body;
        const result = kickboxResult.result; // 'deliverable', 'undeliverable', 'risky', 'unknown'

        // Kickbox result meanings:
        // - deliverable: Email is valid and can receive mail
        // - undeliverable: Email is invalid or cannot receive mail
        // - risky: Email might be valid but has some risk factors
        // - unknown: Could not determine (treat as valid to avoid false positives)

        if (result === 'undeliverable') {
          resolve({
            isValid: false,
            reason: kickboxResult.reason || 'Email address is not deliverable',
            isFake: true,
            isDisposable: kickboxResult.disposable || false,
            kickboxResult: {
              result: kickboxResult.result,
              reason: kickboxResult.reason || '',
              role: kickboxResult.role || false,
              free: kickboxResult.free || false,
              disposable: kickboxResult.disposable || false,
              acceptAll: kickboxResult.accept_all || false,
              didYouMean: kickboxResult.did_you_mean,
            },
          });
          return;
        }

        // For 'risky', we can still allow but log it
        if (result === 'risky') {
          console.warn(`Risky email detected: ${email}`, kickboxResult);
        }

        // 'deliverable' or 'unknown' - treat as valid
        resolve({
          ...localResult,
          kickboxResult: {
            result: kickboxResult.result,
            reason: kickboxResult.reason || '',
            role: kickboxResult.role || false,
            free: kickboxResult.free || false,
            disposable: kickboxResult.disposable || false,
            acceptAll: kickboxResult.accept_all || false,
            didYouMean: kickboxResult.did_you_mean,
          },
        });
      });
    });
  } catch (error) {
    // If Kickbox check fails, fall back to local validation
    console.warn('Kickbox validation error:', error);
    return localResult;
  }
}

/**
 * Generates a unique recovery ID for account recovery
 * Format: XXXX-XXXX-XXXX-XXXX (16 alphanumeric characters)
 */
export function generateRecoveryId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing characters like 0, O, 1, I
  let result = '';
  const charsLength = chars.length;
  
  for (let i = 0; i < 16; i++) {
    const randomIndex = randomInt(0, charsLength);
    result += chars.charAt(randomIndex);
    if ((i + 1) % 4 === 0 && i < 15) {
      result += '-';
    }
  }
  
  return result;
}

/**
 * Normalizes recovery ID for comparison (removes dashes, uppercase)
 */
export function normalizeRecoveryId(recoveryId: string): string {
  return recoveryId.replace(/-/g, '').toUpperCase();
}
