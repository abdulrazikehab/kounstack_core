import { Controller } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('admin')
export class AdminController {
  constructor(private prisma: PrismaService) {}

  // CRITICAL SECURITY FIX: All destructive admin endpoints have been removed.
  // This controller is now intentionally empty to prevent data destruction.
  
  /*
  // Methods removed:
  // - clearAllProducts
  // - clearAllCategories
  // - clearAllOrders
  // - clearAllData
  // - clearDomains
  // - clearTenants
  // - resetDatabase
  */
}
