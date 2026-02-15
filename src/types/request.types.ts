import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  tenantId: string;
  user: {
    sub?: string;
    name?: string;
    avatar?: string;
    id: string;
    tenantId: string;
    role: string;
    email: string;
  };
  tenantDetectedFrom?: string;
}