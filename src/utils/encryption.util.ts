import * as crypto from 'crypto';

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
    // Utilize a random salt from env if available, otherwise fallback to legacy hardcoded salt for app-core compatibility
    const salt = process.env.ENCRYPTION_SALT || 'kawn-encryption-salt';
    ENCRYPTION_KEY = crypto.scryptSync(ENCRYPTION_KEY_RAW, salt, 32);
  }
  
  return ENCRYPTION_KEY;
}

// Separate key for HMAC to avoid key reuse issues in deterministic encryption
let HMAC_KEY: Buffer | null = null;
function getHmacKey(): Buffer {
  if (HMAC_KEY) return HMAC_KEY;
  
  const ENCRYPTION_KEY_RAW = process.env.ENCRYPTION_KEY;
  const salt = process.env.ENCRYPTION_SALT || 'koun-encryption-salt';
  
  if (!ENCRYPTION_KEY_RAW) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }

  // Derive a separate key for HMAC using a different salt or info string
  HMAC_KEY = crypto.scryptSync(ENCRYPTION_KEY_RAW, salt + ':hmac', 32);
  return HMAC_KEY;
}

const IV_LENGTH = 16;

export class EncryptionUtil {
  static encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    
    // Format: IV:AuthTag:EncryptedData
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  static decrypt(text: string): string {
    const parts = text.split(':');
    
    if (parts.length === 3) {
      // GCM format: IV:AuthTag:EncryptedData
      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];

      const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }
    
    if (parts.length === 2) {
      // Legacy CBC format: IV:Encrypted
      return this.decryptLegacy(text);
    }
    
    // Check for deterministic format (no colons, long hex)
    if (parts.length === 1 && text.length > 64) {
      return this.decryptDeterministic(text);
    }

    throw new Error('Invalid encryption format');
  }

  private static decryptLegacy(text: string): string {
    try {
      const textParts = text.split(':');
      const iv = Buffer.from(textParts.shift()!, 'hex');
      const encryptedText = Buffer.from(textParts.join(':'), 'base64');
      const decipher = crypto.createDecipheriv('aes-256-cbc', getEncryptionKey(), iv);
      let decrypted = decipher.update(encryptedText);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      return decrypted.toString();
    } catch (e) {
      throw new Error('Decryption failed');
    }
  }

  static encryptDeterministic(text: string, salt: string = ''): string {
    if (!text) return text;
    const hmacKey = getHmacKey();
    const iv = crypto.createHmac('sha256', hmacKey).update(text + salt).digest().slice(0, 16);
    const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return iv.toString('hex') + authTag + encrypted;
  }

  static decryptDeterministic(text: string): string {
    if (!text) return text;
    
    if (text.length > 64) {
      try {
        const iv = Buffer.from(text.substring(0, 32), 'hex');
        const authTag = Buffer.from(text.substring(32, 64), 'hex');
        const encrypted = text.substring(64);
        
        const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
      } catch (e) {
        // Fallback to legacy or return as-is if not actually encrypted
      }
    }
    
    return text;
  }
  
  static isEncrypted(text: string): boolean {
    return text.includes(':') || (text.length > 64 && /^[0-9a-fA-F]+$/.test(text));
  }
}

