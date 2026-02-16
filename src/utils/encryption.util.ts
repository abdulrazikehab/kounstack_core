import { scryptSync, randomBytes, createCipheriv, createDecipheriv, createHmac } from 'crypto';

const ALGORITHM = 'aes-256-cbc'; // Keep consistency for legacy declaration if needed, but we use GCM

// Lazy loading of key to avoid initialization issues during import
let ENCRYPTION_KEY: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (ENCRYPTION_KEY) return ENCRYPTION_KEY;

  const ENCRYPTION_KEY_RAW = process.env.ENCRYPTION_KEY;

  if (!ENCRYPTION_KEY_RAW) {
    throw new Error('ENCRYPTION_KEY environment variable is required. It should be at least 16 characters long.');
  }

  if (ENCRYPTION_KEY_RAW.length === 32) {
    // Use key directly if exactly 32 characters
    ENCRYPTION_KEY = Buffer.from(ENCRYPTION_KEY_RAW, 'utf8');
  } else if (ENCRYPTION_KEY_RAW.length < 16) {
    throw new Error('ENCRYPTION_KEY must be at least 16 characters long (32 characters recommended for optimal security).');
  } else {
    // Utilize a random salt from env. REQUIRE IT for security.
    const salt = process.env.ENCRYPTION_SALT;
    if (!salt) {
      throw new Error('ENCRYPTION_SALT environment variable is required when ENCRYPTION_KEY is not 32 chars.');
    }
    ENCRYPTION_KEY = scryptSync(ENCRYPTION_KEY_RAW, salt, 32);
  }
  
  return ENCRYPTION_KEY;
}

// Separate key for HMAC to avoid key reuse issues in deterministic encryption
let HMAC_KEY: Buffer | null = null;
function getHmacKey(): Buffer {
  if (HMAC_KEY) return HMAC_KEY;
  
  const ENCRYPTION_KEY_RAW = process.env.ENCRYPTION_KEY;
  const salt = process.env.ENCRYPTION_SALT || 'default-hmac-salt-for-search';
  
  if (!ENCRYPTION_KEY_RAW) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }

  // Derive a separate key for HMAC using a different salt or info string
  HMAC_KEY = scryptSync(ENCRYPTION_KEY_RAW, salt + ':hmac', 32);
  return HMAC_KEY;
}

const IV_LENGTH = 16;
// SECURITY NOTE: DETERMINISTIC_IV is ONLY used for legacy decryption compatibility (line 115).
// All NEW encryption uses secure HMAC-derived IVs (encryptDeterministic, line 136) or random IVs (encrypt, line 56).
// This legacy path should be removed once all old data is migrated.
const DETERMINISTIC_IV = Buffer.alloc(IV_LENGTH, 0); 

export class EncryptionUtil {
  static encrypt(text: string): string {
    const iv = randomBytes(IV_LENGTH);
    // GCM needs auth tag
    const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    
    // Format: IV:AuthTag:EncryptedData
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  static decrypt(text: string): string {
    const parts = text.split(':');
    // Handle migration/legacy formats
    if (parts.length === 2) {
      // Legacy CBC format: IV:Encrypted
      return this.decryptLegacy(text);
    }
    
    if (parts.length !== 3) {
       // Fallback or error
       if (parts.length === 1 && parts[0].length > 32) return this.decryptLegacy(text); // Try deterministic legacy
       throw new Error('Invalid encryption format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // Legacy decryption for backward compatibility during migration
  private static decryptLegacy(text: string): string {
     try {
        // Try old CBC decryption
        const textParts = text.split(':');
        let iv: Buffer;
        let encryptedText: Buffer;
        const legacyAlgo = 'aes-256-cbc';
        
        if (textParts.length === 2) {
            iv = Buffer.from(textParts.shift()!, 'hex');
            encryptedText = Buffer.from(textParts.join(':'), 'base64');
        } else {
             // Deterministic legacy (derived IV or fixed IV)
             if (text.length > 32) {
                iv = Buffer.from(text.substring(0, 32), 'hex');
                encryptedText = Buffer.from(text.substring(32), 'hex');
             } else {
                  // VERY OLD LEGACY: Uses fixed zero IV (INSECURE)
                  // SECURITY WARNING: This method is kept ONLY for backward compatibility with 
                  // data encrypted prior to security hardening. All new data should use GCM.
                  iv = Buffer.alloc(16, 0); 
                  encryptedText = Buffer.from(text, 'hex');
                 if (encryptedText.length === 0) encryptedText = Buffer.from(text, 'base64');
             }
        }

        const decipher = createDecipheriv(legacyAlgo, getEncryptionKey(), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
     } catch (e) {
         throw new Error('Decryption failed');
     }
  }

  static encryptDeterministic(text: string, salt: string = ''): string {
    if (!text) return text;
    // For deterministic encryption (needed for searching), we use HMAC to derive IV
    // SECURITY: Use a separate HMAC key derived from the master key to avoid key reuse
    // and include an optional salt (like tenantId) to prevent frequency analysis
    const hmacKey = getHmacKey();
    const iv = createHmac('sha256', hmacKey).update(text + salt).digest().slice(0, 16);
    const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    // Return hex string IV+AuthTag+Data
    return iv.toString('hex') + authTag + encrypted;
  }

  static decryptDeterministic(text: string): string {
    if (!text) return text;
    
    // Check format
    // IV(32hex) + Tag(32hex) + Data
    if (text.length > 64) {
        try {
            const iv = Buffer.from(text.substring(0, 32), 'hex');
            const authTag = Buffer.from(text.substring(32, 64), 'hex');
            const encrypted = text.substring(64);
            
            const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
            decipher.setAuthTag(authTag);
            
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (e) {
            // Fallback to legacy
        }
    }
    
    return this.decryptLegacy(text);
  }
  
  static isEncrypted(text: string): boolean {
      // Logic to detect if string is encrypted
      // Check for GCM format (2 colons) or Legacy CBC (1 colon) or Deterministic (long hex)
      return text.includes(':') || (text.length > 32 && /^[0-9a-fA-F]+$/.test(text));
  }
}
