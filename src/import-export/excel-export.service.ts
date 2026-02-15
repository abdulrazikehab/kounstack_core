
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as ExcelJS from 'exceljs';

@Injectable()
export class ExcelExportService {
  constructor(private prisma: PrismaService) {}

  async exportExcel(tenantId: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Worksheet');

    // 1. Fetch all data needed
    const products = await this.prisma.product.findMany({
      where: { tenantId },
      include: {
        brand: true,
        categories: {
          include: { category: true },
          orderBy: { sortOrder: 'asc' }, // Get primary category if ordered
        },
      },
    });

    const categories = await this.prisma.category.findMany({
      where: { tenantId },
    });
    const categoryMap = new Map<string, any>(categories.map(c => [c.id, c]));

    // 2. Determine Columns
    const fixedColumns = [
      'Brand Code',
      'Brand Name',
      'purple_cards_product_name_ar',
      'SKU',
      'Product Name', // En
      'Price',
      'Description',
    ];
    
    const catLevels = 5; // Support up to 5 levels
    const catCols = ['Category'];
    for(let i=1; i<catLevels; i++) catCols.push(`SubCategory${i}`);

    const metaKeys = new Set<string>();
    products.forEach(p => {
      if (p.metadata && typeof p.metadata === 'object' && !Array.isArray(p.metadata)) {
        Object.keys(p.metadata).forEach(k => metaKeys.add(k));
      }
    });
    const sortedMetaKeys = Array.from(metaKeys).sort();

    const headers = [...fixedColumns, ...catCols, ...sortedMetaKeys];
    worksheet.addRow(headers);

    // 3. Populate Rows
    for (const p of products) {
      const row: any[] = [];
      
      // Fixed
      row.push(p.brand?.code || '');
      row.push(p.brand?.name || '');
      row.push(p.nameAr || '');
      row.push(p.sku || '');
      row.push(p.name || '');
      row.push(p.price ? p.price.toString() : '0');
      row.push(p.description || '');

      // Categories
      let pathNames: string[] = [];
      // Use first category
      const firstCatRel = p.categories[0];
      if (firstCatRel) {
         let currentId: string | null = firstCatRel.categoryId;
         const tempPath: string[] = [];
         while (currentId) {
            const cat = categoryMap.get(currentId);
            if (cat) {
                tempPath.unshift(cat.name);
                currentId = cat.parentId;
            } else {
                currentId = null;
            }
         }
         pathNames = tempPath;
      } else {
        pathNames = ['Uncategorized'];
      }

      // Fill Category Columns
      for (let i = 0; i < catLevels; i++) {
         row.push(pathNames[i] || '');
      }

      // Metadata
      const meta = (p.metadata as Record<string, any>) || {};
      for (const key of sortedMetaKeys) {
         row.push(meta[key] !== undefined ? meta[key] : '');
      }

      worksheet.addRow(row);
    }

    return await workbook.xlsx.writeBuffer() as unknown as Buffer;
  }
}
