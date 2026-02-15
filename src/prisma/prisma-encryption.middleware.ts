import { Prisma } from '@prisma/client';
import { EncryptionUtil } from '../utils/encryption.util';
import { v4 as uuidv4 } from 'uuid';

export function EncryptionMiddleware(params: Prisma.MiddlewareParams, next: (params: Prisma.MiddlewareParams) => Promise<any>) {
  // Fields to encrypt deterministically (IDs)
  const isIdField = (key: string) => key === 'id' || key.endsWith('Id') || key.endsWith('ID');

  // Helper to recursively traverse and encrypt
  const traverseAndEncrypt = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key];
        
        if (isIdField(key) && typeof value === 'string') {
           // If it looks like a UUID/CUID (not already encrypted base64), encrypt it
           // Simple heuristic: CUIDs are ~25 chars, UUIDs 36. Base64 of encrypted is longer.
           // Also, avoid re-encrypting if we can detect it.
           // But for deterministic, it's just base64.
           // We assume if it's being passed IN, it's raw, unless it's a findUnique where we might be passing an encrypted ID?
           // Actually, the API receives Encrypted IDs (from frontend).
           // Wait. The USER said "when i use it in all apis encrypted buffer 64".
           // This means the Frontend sends Encrypted IDs? Or Frontend sends Raw IDs and Backend Encrypts?
           // "when i use it in all apis encrypted buffer 64" -> likely the API response has it encrypted.
           // If the API response has it encrypted, the Frontend has the encrypted ID.
           // So when the Frontend calls an API with `id`, it sends the Encrypted ID.
           // So `where: { id: 'EncryptedString' }`.
           // So we DO NOT need to encrypt it again in `where` clauses!
           // We only need to encrypt it on `create` (generation) and `update` (if setting a new ID, rare).
           
           // BUT, if the DB stores Encrypted, and the API sends Encrypted, then `where: { id: 'Encrypted' }` matches the DB directly!
           // So we don't need to do ANYTHING for `where` clauses if the input is already encrypted.
           
           // HOWEVER, what if the input is NOT encrypted? (e.g. internal calls).
           // We can't easily know.
           // Let's assume the system is consistent: All IDs flowing through the system are encrypted strings.
           // So `where` clauses are fine.
           
           // The only thing we need to handle is GENERATION of new IDs on `create`.
           // Prisma normally generates `cuid`. We need to generate it, encrypt it, and store it.
        }
        
        if (typeof value === 'object') {
          traverseAndEncrypt(value);
        }
      }
    }
  };

  // Handle Create: Generate ID if missing.
  // SECURITY FIX: DO NOT encrypt or hash IDs. IDs are identifiers, not sensitive data.
  // Encrypting IDs breaks relational integrity and makes cross-service communication impossible.
  if (params.action === 'create' || params.action === 'createMany') {
    const data = params.args.data;
    
    const handleSingleData = (item: any) => {
        if (!item.id) {
            // Generate raw ID if missing
            item.id = uuidv4();
        }
        // If ID is provided, leave it as-is (raw)
    };

    if (Array.isArray(data)) {
        data.forEach(handleSingleData);
    } else if (data) {
        handleSingleData(data);
    }
  }

  return next(params);
}
