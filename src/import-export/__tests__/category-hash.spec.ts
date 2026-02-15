import * as crypto from 'crypto';

/**
 * Category Path Hashing Utility
 * 
 * Generates a deterministic SHA-256 hash from category path components
 * Used to ensure category uniqueness based on full hierarchical path
 */
export class CategoryPathHasher {
  /**
   * Generate hash from category path parts
   * @param pathParts Array of category names from root to leaf
   * @returns SHA-256 hash string
   */
  static generateHash(pathParts: string[]): string {
    // Normalize: lowercase, trim, join with '>'
    const normalizedPath = pathParts
      .map(part => part.trim().toLowerCase())
      .join('>');
    
    return crypto
      .createHash('sha256')
      .update(normalizedPath)
      .digest('hex');
  }

  /**
   * Generate deterministic product key
   * Used when SKU is not provided
   * @param brandCode Brand code
   * @param productName Product name (Arabic)
   * @param categoryHash Category path hash
   * @returns Deterministic key
   */
  static generateProductKey(
    brandCode: string,
    productName: string,
    categoryHash: string
  ): string {
    const key = `${brandCode}_${productName}_${categoryHash}`;
    return crypto
      .createHash('md5')
      .update(key)
      .digest('hex')
      .substring(0, 12)
      .toUpperCase();
  }
}

// ===== TESTS =====

describe('CategoryPathHasher', () => {
  describe('generateHash', () => {
    it('should generate consistent hash for same path', () => {
      const path1 = ['Electronics', 'Mobile', 'Smartphones'];
      const path2 = ['Electronics', 'Mobile', 'Smartphones'];
      
      const hash1 = CategoryPathHasher.generateHash(path1);
      const hash2 = CategoryPathHasher.generateHash(path2);
      
      expect(hash1).toBe(hash2);
    });

    it('should normalize whitespace and case', () => {
      const path1 = ['Electronics ', ' Mobile', 'Smartphones'];
      const path2 = ['electronics', 'mobile', 'smartphones'];
      
      const hash1 = CategoryPathHasher.generateHash(path1);
      const hash2 = CategoryPathHasher.generateHash(path2);
      
      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different paths', () => {
      const path1 = ['Electronics', 'Mobile', 'Smartphones'];
      const path2 = ['Electronics', 'Mobile', 'Tablets'];
      
      const hash1 = CategoryPathHasher.generateHash(path1);
      const hash2 = CategoryPathHasher.generateHash(path2);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should handle Arabic text correctly', () => {
      const path1 = ['إلكترونيات', 'هواتف', 'هواتف ذكية'];
      const path2 = ['إلكترونيات', 'هواتف', 'هواتف ذكية'];
      
      const hash1 = CategoryPathHasher.generateHash(path1);
      const hash2 = CategoryPathHasher.generateHash(path2);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 produces 64 hex chars
    });

    it('should handle single-level path', () => {
      const path = ['Uncategorized'];
      const hash = CategoryPathHasher.generateHash(path);
      
      expect(hash).toBeTruthy();
      expect(hash).toHaveLength(64);
    });

    it('should handle deep hierarchy', () => {
      const path = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
      const hash = CategoryPathHasher.generateHash(path);
      
      expect(hash).toBeTruthy();
      expect(hash).toHaveLength(64);
    });
  });

  describe('generateProductKey', () => {
    it('should generate consistent key for same inputs', () => {
      const key1 = CategoryPathHasher.generateProductKey(
        'APPLE',
        'آيفون 15 برو',
        'abcd1234'
      );
      const key2 = CategoryPathHasher.generateProductKey(
        'APPLE',
        'آيفون 15 برو',
        'abcd1234'
      );
      
      expect(key1).toBe(key2);
    });

    it('should generate different key for different brand', () => {
      const key1 = CategoryPathHasher.generateProductKey(
        'APPLE',
        'آيفون 15',
        'abcd1234'
      );
      const key2 = CategoryPathHasher.generateProductKey(
        'SAMSUNG',
        'آيفون 15',
        'abcd1234'
      );
      
      expect(key1).not.toBe(key2);
    });

    it('should generate different key for different product name', () => {
      const key1 = CategoryPathHasher.generateProductKey(
        'APPLE',
        'آيفون 15',
        'abcd1234'
      );
      const key2 = CategoryPathHasher.generateProductKey(
        'APPLE',
        'آيفون 15 برو',
        'abcd1234'
      );
      
      expect(key1).not.toBe(key2);
    });

    it('should generate different key for different category', () => {
      const key1 = CategoryPathHasher.generateProductKey(
        'APPLE',
        'آيفون 15',
        'categoryA'
      );
      const key2 = CategoryPathHasher.generateProductKey(
        'APPLE',
        'آيفون 15',
        'categoryB'
      );
      
      expect(key1).not.toBe(key2);
    });

    it('should generate uppercase 12-character key', () => {
      const key = CategoryPathHasher.generateProductKey(
        'APPLE',
        'آيفون 15 برو',
        'abcd1234'
      );
      
      expect(key).toHaveLength(12);
      expect(key).toMatch(/^[A-F0-9]+$/);
    });

    it('should handle Arabic product names', () => {
      const key = CategoryPathHasher.generateProductKey(
        'APPLE',
        'آيفون 15 برو ماكس الترا',
        'xyz789'
      );
      
      expect(key).toBeTruthy();
      expect(key).toHaveLength(12);
    });
  });

  describe('Idempotency', () => {
    it('should allow re-importing same product without duplicate', () => {
      // Simulate two imports of the same product
      const brandCode = 'APPLE';
      const productName = 'آيفون 15 برو';
      const categoryPath = ['Electronics', 'Mobile', 'Smartphones'];
      
      const categoryHash = CategoryPathHasher.generateHash(categoryPath);
      const sku1 = `GEN-${CategoryPathHasher.generateProductKey(brandCode, productName, categoryHash)}`;
      const sku2 = `GEN-${CategoryPathHasher.generateProductKey(brandCode, productName, categoryHash)}`;
      
      expect(sku1).toBe(sku2);
      // This ensures that when we try to insert the product twice,
      // the unique constraint on SKU will catch it and trigger an update instead
    });

    it('should create different SKUs for products with same name in different categories', () => {
      const brandCode = 'APPLE';
      const productName = 'iPhone 15';
      
      const categoryPath1 = ['Electronics', 'Mobile'];
      const categoryPath2 = ['Electronics', 'Refurbished'];
      
      const hash1 = CategoryPathHasher.generateHash(categoryPath1);
      const hash2 = CategoryPathHasher.generateHash(categoryPath2);
      
      const sku1 = `GEN-${CategoryPathHasher.generateProductKey(brandCode, productName, hash1)}`;
      const sku2 = `GEN-${CategoryPathHasher.generateProductKey(brandCode, productName, hash2)}`;
      
      expect(sku1).not.toBe(sku2);
      // This allows the same product name under different categories
    });
  });
});
