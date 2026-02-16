import { Prisma } from '@prisma/client';
import { EncryptionUtil } from '../utils/encryption.util';
import { v4 as uuidv4 } from 'uuid';

export function EncryptionMiddleware(params: Prisma.MiddlewareParams, next: (params: Prisma.MiddlewareParams) => Promise<any>) {
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
