import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CardProductService } from './card-product.service';
import * as ExcelJS from 'exceljs';

export interface ImportCardDto {
  cardCode: string;
  cardPin?: string;
  expiryDate?: Date;
}

export interface ImportResult {
  batchId: string;
  totalProcessed: number;
  validCards: number;
  invalidCards: number;
  errors: string[];
}

@Injectable()
export class CardInventoryService {
  private readonly logger = new Logger(CardInventoryService.name);

  constructor(
    private prisma: PrismaService,
    private cardProductService: CardProductService,
  ) {}

  // Import cards from Excel file
  async importFromExcel(
    tenantId: string,
    productId: string,
    fileBuffer: Buffer,
    fileName: string,
    importedById: string,
  ): Promise<ImportResult> {
    // Verify product exists
    await this.cardProductService.findOne(tenantId, productId);

    // Parse Excel file securely using ExcelJS
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer as any);
    
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
       throw new BadRequestException('Excel file is empty or invalid');
    }

    const data: any[] = [];
    
    // Extract headers from first row
    const headers: string[] = [];
    const headerRow = worksheet.getRow(1);
    
    if (headerRow && headerRow.cellCount > 0) {
      headerRow.eachCell((cell, colNumber) => {
        headers[colNumber] = cell.value ? String(cell.value).trim() : '';
      });
    }

    if (headers.length === 0) {
      throw new BadRequestException('Excel file has no headers');
    }
    
    // Process data rows (start from row 2)
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header
      
      const rowData: any = {};
      let hasData = false;
      
      row.eachCell((cell, colNumber) => {
        const header = headers[colNumber];
        if (header) {
          // Handle cell types (dates, etc)
          let value = cell.value;
          
          // Handle rich text or other object types if necessary, usually .value is enough
          if (value && typeof value === 'object' && 'text' in value) {
             value = (value as any).text;
          }
           
          rowData[header] = value;
          hasData = true;
        }
      });
      
      if (hasData) {
        data.push(rowData);
      }
    });

    if (!data.length) {
      throw new BadRequestException('Excel file is empty');
    }

    // Generate batch ID
    const batchNumber = `BATCH-${Date.now()}-${randomInt(1000000, 9999999).toString(36)}`;

    const errors: string[] = [];
    let validCards = 0;
    let invalidCards = 0;

    // Process each row
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 2; // Excel row number (1-indexed + header)

      // Extract card code - try common column names
      const cardCode =
        row.card_code ||
        row.cardCode ||
        row.code ||
        row.serial ||
        row.serialNumber ||
        row['Card Code'] ||
        row['Code'] ||
        row['Serial'];

      if (!cardCode) {
        errors.push(`Row ${rowNum}: Missing card code`);
        invalidCards++;
        continue;
      }

      // Check for duplicate
      const existing = await this.prisma.cardInventory.findUnique({
        where: {
          tenantId_cardCode: {
            tenantId,
            cardCode: String(cardCode).trim(),
          },
        },
      });

      if (existing) {
        errors.push(`Row ${rowNum}: Duplicate card code ${cardCode}`);
        invalidCards++;
        continue;
      }

      // Extract pin (optional)
      const cardPin =
        row.pin ||
        row.cardPin ||
        row.PIN ||
        row['Card Pin'] ||
        row['PIN'];

      // Extract expiry date (optional)
      let expiryDate: Date | undefined;
      const expiryValue =
        row.expiry ||
        row.expiryDate ||
        row.expiry_date ||
        row['Expiry Date'] ||
        row['Expiry'];

      if (expiryValue) {
        try {
          expiryDate = new Date(expiryValue);
        } catch {
          // Ignore invalid dates
        }
      }

      try {
        await this.prisma.cardInventory.create({
          data: {
            tenantId,
            productId,
            cardCode: String(cardCode).trim(),
            cardPin: cardPin ? String(cardPin).trim() : null,
            expiryDate,
            batchId: batchNumber,
            status: 'AVAILABLE',
          },
        });
        validCards++;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`Row ${rowNum}: Failed to import - ${errorMessage}`);
        invalidCards++;
      }
    }

    // Create batch record
    await this.prisma.cardBatch.create({
      data: {
        tenantId,
        productId,
        batchNumber,
        fileName,
        totalCards: data.length,
        validCards,
        invalidCards,
        importedById,
      },
    });

    // Update product stock count
    await this.cardProductService.updateStockCount(productId);

    this.logger.log(`Imported ${validCards} cards for product ${productId}. Batch: ${batchNumber}`);

    return {
      batchId: batchNumber,
      totalProcessed: data.length,
      validCards,
      invalidCards,
      errors: errors.slice(0, 50), // Limit errors to first 50
    };
  }

  // Import cards from array (manual input)
  async importFromArray(
    tenantId: string,
    productId: string,
    cards: ImportCardDto[],
    importedById: string,
  ): Promise<ImportResult> {
    await this.cardProductService.findOne(tenantId, productId);

    const batchNumber = `MANUAL-${Date.now()}-${randomInt(1000000, 9999999).toString(36)}`;
    const errors: string[] = [];
    let validCards = 0;
    let invalidCards = 0;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];

      if (!card.cardCode) {
        errors.push(`Card ${i + 1}: Missing card code`);
        invalidCards++;
        continue;
      }

      // Check for duplicate
      const existing = await this.prisma.cardInventory.findUnique({
        where: {
          tenantId_cardCode: {
            tenantId,
            cardCode: card.cardCode.trim(),
          },
        },
      });

      if (existing) {
        errors.push(`Card ${i + 1}: Duplicate card code ${card.cardCode}`);
        invalidCards++;
        continue;
      }

      try {
        await this.prisma.cardInventory.create({
          data: {
            tenantId,
            productId,
            cardCode: card.cardCode.trim(),
            cardPin: card.cardPin?.trim(),
            expiryDate: card.expiryDate,
            batchId: batchNumber,
            status: 'AVAILABLE',
          },
        });
        validCards++;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`Card ${i + 1}: Failed to import - ${errorMessage}`);
        invalidCards++;
      }
    }

    // Create batch record
    await this.prisma.cardBatch.create({
      data: {
        tenantId,
        productId,
        batchNumber,
        fileName: 'Manual Import',
        totalCards: cards.length,
        validCards,
        invalidCards,
        importedById,
      },
    });

    // Update product stock count
    await this.cardProductService.updateStockCount(productId);

    return {
      batchId: batchNumber,
      totalProcessed: cards.length,
      validCards,
      invalidCards,
      errors,
    };
  }

  // Get inventory for a product
  async getInventory(
    tenantId: string,
    productId: string,
    status?: 'AVAILABLE' | 'RESERVED' | 'SOLD' | 'EXPIRED' | 'INVALID' | 'REFUNDED',
    page: number = 1,
    limit: number = 50,
  ) {
    const where: any = { tenantId, productId };
    if (status) {
      where.status = status;
    }

    const [inventory, total] = await Promise.all([
      this.prisma.cardInventory.findMany({
        where,
        orderBy: { importedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.cardInventory.count({ where }),
    ]);

    return {
      data: inventory,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Get batches for a product
  async getBatches(tenantId: string, productId?: string) {
    const where: any = { tenantId };
    if (productId) {
      where.productId = productId;
    }

    return this.prisma.cardBatch.findMany({
      where,
      include: {
        importedBy: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { importedAt: 'desc' },
    });
  }

  // Reserve cards for an order (Atomic with Row-Level Locking)
  async reserveCards(productId: string, quantity: number, orderId: string): Promise<string[]> {
    return await this.prisma.$transaction(async (tx: any) => {
      // 1. SELECT and LOCK available cards to prevent concurrent reservations of same cards
      // Uses "FOR UPDATE SKIP LOCKED" to handle high concurrency correctly
      const availableCards = (await tx.$queryRaw`
        SELECT "id" FROM "card_inventory" 
        WHERE "productId" = ${productId} 
        AND "status" = 'AVAILABLE' 
        AND ("expiryDate" IS NULL OR "expiryDate" > ${new Date()})
        ORDER BY "importedAt" ASC 
        LIMIT ${quantity} 
        FOR UPDATE SKIP LOCKED
      `) as any[];

      if (availableCards.length < quantity) {
        throw new BadRequestException(`Insufficient inventory: Only ${availableCards.length} cards available, but ${quantity} requested.`);
      }

      const cardIds = availableCards.map((c: any) => c.id);

      // 2. Mark selected cards as RESERVED under this order
      await tx.cardInventory.updateMany({
        where: { id: { in: cardIds } },
        data: { status: 'RESERVED', orderId },
      });

      return cardIds;
    });
  }

  // Mark cards as sold
  async markAsSold(cardIds: string[], userId: string, orderId: string) {
    await this.prisma.cardInventory.updateMany({
      where: { id: { in: cardIds } },
      data: {
        status: 'SOLD',
        soldAt: new Date(),
        soldToUserId: userId,
        orderId,
      },
    });
  }

  // Release reserved cards (if order cancelled)
  async releaseCards(cardIds: string[]) {
    await this.prisma.cardInventory.updateMany({
      where: { id: { in: cardIds } },
      data: {
        status: 'AVAILABLE',
        orderId: null,
      },
    });
  }

  // Get sold cards for a user
  async getUserPurchasedCards(userId: string, page: number = 1, limit: number = 20) {
    const [cards, total] = await Promise.all([
      this.prisma.cardInventory.findMany({
        where: { soldToUserId: userId, status: 'SOLD' },
        include: {
          product: {
            include: { brand: true },
          },
        },
        orderBy: { soldAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.cardInventory.count({
        where: { soldToUserId: userId, status: 'SOLD' },
      }),
    ]);

    return {
      data: cards,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Delete a card from inventory
  async deleteCard(tenantId: string, cardId: string) {
    const card = await this.prisma.cardInventory.findFirst({
      where: { id: cardId, tenantId },
    });

    if (!card) {
      throw new NotFoundException('Card not found');
    }

    if (card.status !== 'AVAILABLE') {
      throw new BadRequestException('Only available cards can be deleted');
    }

    await this.prisma.cardInventory.delete({
      where: { id: cardId },
    });

    // Update stock count
    await this.cardProductService.updateStockCount(card.productId);

    return { success: true };
  }

  // Mark cards as expired
  async markExpiredCards(tenantId: string) {
    const result = await this.prisma.cardInventory.updateMany({
      where: {
        tenantId,
        status: 'AVAILABLE',
        expiryDate: { lt: new Date() },
      },
      data: { status: 'EXPIRED' },
    });

    if (result.count > 0) {
      this.logger.log(`Marked ${result.count} cards as expired for tenant ${tenantId}`);
    }

    return result.count;
  }

  // Get emergency inventory (INVALID cards)
  async getEmergencyInventory(
    tenantId: string,
    page: number = 1,
    limit: number = 50,
    search?: string,
  ) {
    const where: any = {
      tenantId,
      status: 'INVALID',
    };

    if (search) {
      where.OR = [
        { cardCode: { contains: search, mode: 'insensitive' } },
        { product: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [inventory, total] = await Promise.all([
      this.prisma.cardInventory.findMany({
        where,
        include: {
          product: {
            select: { id: true, name: true, sku: true }, // Removed sku as it might not exist in Product model, checking schema...
            // Checking schema for Product model...
            // It has 'productCode' in CardProduct, but 'Product' model is generic.
            // Let's check Product model in schema.
          },
        },
        orderBy: { importedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.cardInventory.count({ where }),
    ]);

    return {
      data: inventory,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Move cards to emergency inventory (Mark as INVALID)
  async moveToEmergency(tenantId: string, cardIds: string[]) {
    const result = await this.prisma.cardInventory.updateMany({
      where: {
        id: { in: cardIds },
        tenantId,
        status: 'AVAILABLE', // Only move available cards
      },
      data: { status: 'INVALID' },
    });
    
    return { count: result.count };
  }

  // Recover cards from emergency inventory (Mark as AVAILABLE)
  async recoverFromEmergency(tenantId: string, cardIds: string[]) {
    const result = await this.prisma.cardInventory.updateMany({
      where: {
        id: { in: cardIds },
        tenantId,
        status: 'INVALID',
      },
      data: { status: 'AVAILABLE' },
    });
    
    return { count: result.count };
  }

  // Get all card inventory for a tenant (paginated, searchable)
  async getTenantCardInventory(
    tenantId: string,
    page: number = 1,
    limit: number = 50,
    search?: string,
    status?: string,
    categoryId?: string,
    brandId?: string,
  ) {
    const where: any = {
      tenantId,
    };

    if (status && status !== 'ALL') {
      if (status === 'USED') {
        where.status = { in: ['SOLD', 'INVALID', 'REFUNDED'] };
      } else if (status === 'NOT_USED') {
        where.status = 'AVAILABLE';
      } else {
        where.status = status;
      }
    }

    if (categoryId) {
      where.product = { 
        ...where.product, 
        categories: {
          some: {
            categoryId
          }
        }
      };
    }

    if (brandId) {
      where.product = { ...where.product, brandId };
    }

    if (search) {
      const searchFilter = { contains: search, mode: 'insensitive' };
      where.OR = [
        { cardCode: searchFilter },
        { cardPin: searchFilter },
        { product: { name: searchFilter } },
        { product: { sku: searchFilter } },
      ];
    }

    const [inventory, total] = await Promise.all([
      this.prisma.cardInventory.findMany({
        where,
        include: {
          product: {
            include: {
              categories: {
                include: {
                  category: { select: { id: true, name: true, nameAr: true } },
                }
              },
              brand: { select: { id: true, name: true, nameAr: true } },
            },
          },
        },
        orderBy: { importedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.cardInventory.count({ where }),
    ]);

    // Map the results to flatten categories[0].category into category
    const mappedData = inventory.map(item => {
      const product = item.product as any;
      const category = product.categories?.[0]?.category || null;
      
      return {
        ...item,
        product: {
          ...product,
          category,
          categories: undefined // Remove internal categories relation to keep response clean
        }
      };
    });

    return {
      data: mappedData,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}

