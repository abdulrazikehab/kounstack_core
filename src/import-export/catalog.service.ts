
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CatalogService {
  constructor(private prisma: PrismaService) {}

  async getTree(tenantId: string) {
    const categories = await this.prisma.category.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' }
    });

    const products = await this.prisma.product.findMany({
       where: { tenantId },
       select: {
         id: true,
         name: true,
         nameAr: true,
         sku: true,
         categories: {
            select: { categoryId: true }
         }
       }
    });

    const nodeMap = new Map<string, any>();
    
    // 1. Initialize Category Nodes
    categories.forEach(c => {
       nodeMap.set(c.id, {
          id: c.id,
          name: c.name,
          nameAr: c.nameAr,
          children: [],
          products: []
       });
    });

    // 2. Attach Products
    const unassignedProducts: any[] = [];
    products.forEach(p => {
       if (p.categories.length === 0) {
           unassignedProducts.push({
               id: p.id,
               name: p.name,
               nameAr: p.nameAr,
               sku: p.sku
           });
       } else {
           p.categories.forEach(pc => {
               const catNode = nodeMap.get(pc.categoryId);
               if (catNode) {
                   catNode.products.push({
                       id: p.id,
                       name: p.name,
                       nameAr: p.nameAr,
                       sku: p.sku
                   });
               }
           });
       }
    });

    // 3. Build Tree Structure
    const roots: any[] = [];
    
    categories.forEach(c => {
       const node = nodeMap.get(c.id);
       if (c.parentId) {
           const parent = nodeMap.get(c.parentId);
           if (parent) {
               parent.children.push(node);
           } else {
               roots.push(node);
           }
       } else {
           roots.push(node);
       }
    });

    // Add "Uncategorized" pseudo-node if there are unassigned products
    if (unassignedProducts.length > 0) {
        roots.push({
            id: 'uncategorized',
            name: 'Uncategorized',
            nameAr: 'غير مصنف',
            children: [],
            products: unassignedProducts
        });
    }

    return roots;
  }
}
