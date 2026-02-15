// apps/app-core/src/product/bulk-import.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductService } from './product.service';
import csv from 'csv-parser';
import * as stream from 'stream';

@Injectable()
export class BulkImportService {
  private readonly logger = new Logger(BulkImportService.name);

  constructor(
    private prisma: PrismaService,
    private productService: ProductService,
  ) {}

  async importProductsFromCSV(tenantId: string, fileBuffer: Buffer) {
    return new Promise((resolve, reject) => {
      const results: any[] = [];
      const bufferStream = new stream.PassThrough();
      bufferStream.end(fileBuffer);

      bufferStream
        .pipe(csv())
        .on('data', (data:any) => results.push(data))
        .on('end', async () => {
          try {
            await this.processProducts(tenantId, results);
            resolve({ message: `Imported ${results.length} products` });
          } catch (error) {
            reject(error);
          }
        })
        .on('error', reject);
    });
  }

  private async processProducts(tenantId: string, products: any[]) {
    for (const productData of products) {
      try {
        // If SKU is provided and not empty/whitespace, use it; otherwise let productService auto-generate
        const sku = productData.sku && productData.sku.trim() ? productData.sku.trim() : undefined;
        
        await this.productService.create(tenantId, {
          name: productData.name,
          description: productData.description,
          sku: sku, // Will be auto-generated if undefined
          price: parseFloat(productData.price),
          compareAtPrice: productData.compareAtPrice ? parseFloat(productData.compareAtPrice) : undefined,
          isAvailable: productData.isAvailable !== 'false',
        });
        
        this.logger.log(`✅ Imported product: ${productData.name}${sku ? ` (SKU: ${sku})` : ' (auto-generated SKU)'}`);
      } catch (error) {
        this.logger.error(`Failed to import product ${productData.name}: ${error}`);
      }
    }
  }
}