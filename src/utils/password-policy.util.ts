import { BadRequestException } from '@nestjs/common';

/**
 * Password Policy Configuration
 * SECURITY FIX: Strong password requirements
 */
export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  maxLength?: number;
  preventCommonPasswords: boolean;
  preventUserInfo: boolean; // Prevent password containing username/email
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  maxLength: 128,
  preventCommonPasswords: true,
  preventUserInfo: true,
};

/**
 * Common weak passwords that should be rejected
 */
const COMMON_PASSWORDS = [
  'password',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'abc123',
  'password123',
  'admin123',
  'letmein',
  'welcome123',
  'monkey123',
  '123456789a',
  'password1',
  'qwerty',
  '1234567',
  'sunshine',
  'princess',
  'football',
  'iloveyou',
  '123123',
];

/**
 * Validates password against policy
 * @param password - Password to validate
 * @param policy - Password policy (defaults to DEFAULT_PASSWORD_POLICY)
 * @param userInfo - Optional user info (email, username) to check against
 * @returns Validation result with isValid flag and errors array
 */
export function validatePassword(
  password: string,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
  userInfo?: { email?: string; username?: string }
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!password || typeof password !== 'string') {
    errors.push('Password is required');
    return { isValid: false, errors };
  }

  // Check minimum length
  if (password.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters long`);
  }

  // Check maximum length
  if (policy.maxLength && password.length > policy.maxLength) {
    errors.push(`Password must be no more than ${policy.maxLength} characters long`);
  }

  // Check uppercase
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  // Check lowercase
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  // Check numbers
  if (policy.requireNumbers && !/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  // Check special characters
  if (policy.requireSpecialChars && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character (!@#$%^&*()_+-=[]{}|;:,.<>?)');
  }

  // Check common passwords
  if (policy.preventCommonPasswords) {
    const lowerPassword = password.toLowerCase();
    if (COMMON_PASSWORDS.some(common => lowerPassword.includes(common.toLowerCase()))) {
      errors.push('Password is too common. Please choose a more unique password');
    }
  }

  // Check against user info
  if (policy.preventUserInfo && userInfo) {
    const lowerPassword = password.toLowerCase();
    if (userInfo.email) {
      const emailLocal = userInfo.email.split('@')[0].toLowerCase();
      if (lowerPassword.includes(emailLocal) && emailLocal.length >= 3) {
        errors.push('Password cannot contain your email address');
      }
    }
    if (userInfo.username) {
      const lowerUsername = userInfo.username.toLowerCase();
      if (lowerPassword.includes(lowerUsername) && lowerUsername.length >= 3) {
        errors.push('Password cannot contain your username');
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validates password and throws BadRequestException if invalid
 * @param password - Password to validate
 * @param policy - Password policy
 * @param userInfo - Optional user info
 * @throws BadRequestException if password is invalid
 */
export function validatePasswordOrThrow(
  password: string,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
  userInfo?: { email?: string; username?: string }
): void {
  const result = validatePassword(password, policy, userInfo);
  if (!result.isValid) {
    throw new BadRequestException(result.errors.join('. '));
  }
}

