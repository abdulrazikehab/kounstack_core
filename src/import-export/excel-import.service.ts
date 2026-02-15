
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as ExcelJS from 'exceljs';
import * as crypto from 'crypto';

@Injectable()
export class ExcelImportService {
  private readonly logger = new Logger(ExcelImportService.name);

  constructor(private prisma: PrismaService) {}

  async importExcel(fileBuffer: Buffer, tenantId: string, fileName: string) {
    this.logger.log(`Starting optimized Excel import for tenant ${tenantId}, file: ${fileName}`);

    // Create Import Job
    // @ts-ignore
    const job = await this.prisma.importJob.create({
      data: {
        tenantId,
        fileName,
        status: 'PROCESSING',
        summary: {},
      },
    });

    const stats = {
      insertedBrands: 0,
      updatedBrands: 0,
      insertedCategories: 0,
      insertedProducts: 0,
      updatedProducts: 0,
      skippedRows: 0,
      errors: 0,
    };

    // In-memory caches for this import session to reduce DB roundtrips
    const brandCache = new Map<string, string>(); // code -> id
    const categoryCache = new Map<string, string>(); // pathHash -> id

    try {
      const { Readable } = require('stream');
      const stream = new Readable();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(fileBuffer as any); 

      const worksheet = workbook.getWorksheet('Worksheet') || workbook.worksheets[0];
      if (!worksheet) {
        throw new Error('No worksheet found in file');
      }

      // Headers analysis
      const headerRow = worksheet.getRow(1);
      const headerMap: Record<string, number> = {};
      headerRow.eachCell((cell, colNumber) => {
        const val = cell.value?.toString().trim();
        if (val) headerMap[val] = colNumber;
      });

      // Required columns check
      const requiredCols = ['Brand Code', 'Brand Name', 'purple_cards_product_name_ar'];
      const missingIds = requiredCols.filter((col) => !headerMap[col]);

      if (missingIds.length > 0) {
        throw new Error(`Missing required columns: ${missingIds.join(', ')}`);
      }

      // Identify Category Columns
      const categoryCols: { name: string; colIdx: number; level: number }[] = [];
      Object.entries(headerMap).forEach(([name, colIdx]) => {
         if (name.toLowerCase() === 'category') {
             categoryCols.push({ name, colIdx, level: 0 });
         } else if (name.toLowerCase().startsWith('subcategory')) {
             const num = parseInt(name.replace(/subcategory/i, ''), 10) || 0;
             categoryCols.push({ name, colIdx, level: num });
         }
      });
      categoryCols.sort((a, b) => a.level - b.level);

      // Process rows efficiently without storing them all in an array first
      let rowCount = 0;
      const totalRows = worksheet.actualRowCount;
      
      for (let i = 2; i <= worksheet.rowCount; i++) {
        const row = worksheet.getRow(i);
        if (!row || !row.values || (Array.isArray(row.values) && row.values.length === 0)) continue;
        
        rowCount++;
        if (rowCount % 100 === 0) {
          this.logger.log(`Processing row ${rowCount}/${totalRows} for tenant ${tenantId}`);
        }

        try {
          await this.processRowOptimized(row, headerMap, categoryCols, tenantId, stats, brandCache, categoryCache);
        } catch (e: any) {
          stats.errors++;
          // Only log first 100 errors to avoid bloating the DB if everything fails
          if (stats.errors <= 100) {
            // @ts-ignore
            await this.prisma.importError.create({
               data: {
                 importJobId: job.id,
                 rowNumber: i,
                 message: e.message,
                 rawRow: JSON.stringify(row.values),
               }
             });
          }
        }
      }

      // Complete
      // @ts-ignore
      await this.prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          summary: stats,
        },
      });

      this.logger.log(`Excel import finished. Summary: ${JSON.stringify(stats)}`);
      return stats;

    } catch (error: any) {
      this.logger.error(`Import failed: ${error.message}`, error.stack);
      // @ts-ignore
      await this.prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          summary: { error: error.message, ...stats },
        },
      });
      throw new BadRequestException(`Import failed: ${error.message}`);
    }
  }

  private async processRowOptimized(
    row: ExcelJS.Row, 
    headers: Record<string, number>, 
    categoryCols: { name: string; colIdx: number }[], 
    tenantId: string, 
    stats: any,
    brandCache: Map<string, string>,
    categoryCache: Map<string, string>
  ) {
    const getVal = (colName: string): string | null => {
      const idx = headers[colName];
      if (!idx) return null;
      const cell = row.getCell(idx);
      return cell.value ? cell.value.toString().trim() : null;
    };

    const brandCode = getVal('Brand Code');
    const brandName = getVal('Brand Name');
    const productNameAr = getVal('purple_cards_product_name_ar');

    if (!brandCode || !brandName || !productNameAr) {
        stats.skippedRows++;
        return; // Silent skip for empty rows
    }

    // Upsert Brand with Caching
    let brandId = brandCache.get(brandCode);
    if (!brandId) {
      const existingBrand = await this.prisma.brand.findFirst({
          where: { tenantId, code: brandCode },
          select: { id: true, name: true }
      });

      if (existingBrand) {
          brandId = existingBrand.id;
          if (existingBrand.name !== brandName) {
              await this.prisma.brand.update({
                  where: { id: brandId },
                  data: { name: brandName }
              });
              stats.updatedBrands++;
          }
      } else {
          const newBrand = await this.prisma.brand.create({
              data: {
                  tenantId,
                  code: brandCode,
                  name: brandName,
                  status: 'Active'
              },
              select: { id: true }
          });
          brandId = newBrand.id;
          stats.insertedBrands++;
      }
      if (brandId) brandCache.set(brandCode, brandId);
    }

    // Categories with Caching
    let categoryPath: string[] = [];
    for (const col of categoryCols) {
        const val = row.getCell(col.colIdx).value?.toString().trim();
        if (val) categoryPath.push(val);
    }

    const pathPartsUsed = categoryPath.length > 0 ? categoryPath : ['Uncategorized'];
    let finalCategoryId: string | undefined;
    let parentId: string | null = null;
    const currentPathTrace: string[] = [];

    for (const part of pathPartsUsed) {
        currentPathTrace.push(part);
        const pathHash = this.generatePathHash(currentPathTrace);
        
        let catId = categoryCache.get(pathHash);
        if (!catId) {
          const existingCat = await this.prisma.category.findFirst({
              where: { tenantId, pathHash },
              select: { id: true }
          });

          if (existingCat) {
              catId = existingCat.id;
          } else {
              const slug = this.generateSlug(part);
              const newCat = await this.prisma.category.create({
                  data: {
                      tenantId,
                      name: part,
                      slug: `${slug}-${Date.now()}-${Math.floor(Math.random() * 1000)}`, 
                      pathHash: pathHash,
                      parentId: parentId
                  },
                  select: { id: true }
              });
              catId = newCat.id;
              stats.insertedCategories++;
          }
          if (catId) categoryCache.set(pathHash, catId);
        }
        parentId = catId || null;
        finalCategoryId = catId;
    }

    // Product
    const sku = getVal('SKU') || getVal('Product Code') || getVal('Code');
    const categoryPathHash = this.generatePathHash(pathPartsUsed);
    const deterministicKey = `${brandCode}_${productNameAr}_${categoryPathHash}`;

    let finalSku = sku;
    if (!finalSku) {
        const hash = crypto.createHash('md5').update(deterministicKey).digest('hex').substring(0, 12).toUpperCase();
        finalSku = `GEN-${hash}`;
    }

    // Metadata
    const metadata: Record<string, any> = {};
    const usedColNames = new Set(['Brand Code', 'Brand Name', 'purple_cards_product_name_ar', 'SKU', 'Product Code', 'Code', 'Product Name', 'Price', 'Description']);
    categoryCols.forEach(c => usedColNames.add(c.name));
    
    Object.entries(headers).forEach(([key, idx]) => {
        if (!usedColNames.has(key)) {
             const val = row.getCell(idx).value;
             if (val !== null && val !== undefined) {
                 metadata[key] = val;
             }
        }
    });

    const productData = {
        name: getVal('Product Name') || productNameAr,
        nameAr: productNameAr,
        brandId: brandId || null,
        metadata: metadata,
        description: getVal('Description') || '',
    };
    
    const priceVal = getVal('Price') || getVal('Cost');
    const price = priceVal ? parseFloat(priceVal) : 0;

    const existingProduct = await this.prisma.product.findFirst({
        where: { tenantId, sku: finalSku },
        select: { id: true }
    });
    
    if (existingProduct) {
        await this.prisma.product.update({
             where: { id: existingProduct.id },
             data: {
                 ...productData,
                 price,
             }
        });
        
        // Product-Category Relation (Check if exists)
        const rel = await this.prisma.productCategory.findUnique({
            where: {
                productId_categoryId: {
                    productId: existingProduct.id,
                    categoryId: finalCategoryId!
                }
            },
            select: { id: true }
        });
        
        if (!rel) {
             await this.prisma.productCategory.create({
                 data: {
                     productId: existingProduct.id,
                     categoryId: finalCategoryId!
                 }
             });
        }
        stats.updatedProducts++;
    } else {
        const newProd = await this.prisma.product.create({
            data: {
                tenantId,
                sku: finalSku,
                ...productData,
                price,
            },
            select: { id: true }
        });
        
        await this.prisma.productCategory.create({
            data: {
                productId: newProd.id,
                categoryId: finalCategoryId!
            }
        });
        stats.insertedProducts++;
    }
  }

  private async processRow(
    row: ExcelJS.Row, 
    headers: Record<string, number>, 
    categoryCols: { name: string; colIdx: number }[], 
    tenantId: string, 
    stats: any
  ) {
    // Legacy method maintained for backward compatibility if needed, but not used by optimized version
    return this.processRowOptimized(row, headers, categoryCols, tenantId, stats, new Map(), new Map());
  }


  private generatePathHash(pathParts: string[]): string {
    const path = pathParts.map(p => p.trim().toLowerCase()).join('>');
    return crypto.createHash('sha256').update(path).digest('hex');
  }

  private generateSlug(text: string): string {
    return text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\u0600-\u06FF\-]+/g, '')
      .replace(/\-\-+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
  }
}
