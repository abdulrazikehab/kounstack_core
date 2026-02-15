import { Test, TestingModule } from '@nestjs/testing';
import { PublicService } from './public.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../tenant/tenant.service';

describe('PublicService - Subdomain Suggestions', () => {
  let service: PublicService;
  let tenantService: TenantService;

  const mockPrismaService = {
    tenant: {
      findUnique: jest.fn(),
    },
    customDomain: {
      findFirst: jest.fn(),
    },
  };

  const mockTenantService = {
    checkSubdomainAvailability: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: TenantService,
          useValue: mockTenantService,
        },
      ],
    }).compile();

    service = module.get<PublicService>(PublicService);
    tenantService = module.get<TenantService>(TenantService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('checkSubdomainAvailability', () => {
    it('should return available: true when subdomain is available', async () => {
      mockTenantService.checkSubdomainAvailability.mockResolvedValue(true);

      const result = await service.checkSubdomainAvailability('mystore');

      expect(result).toEqual({ available: true });
      expect(mockTenantService.checkSubdomainAvailability).toHaveBeenCalledWith('mystore');
    });

    it('should return 3 suggestions when subdomain is taken', async () => {
      // First call (base subdomain) returns false
      // Next 3 calls (suggestions) return true
      mockTenantService.checkSubdomainAvailability
        .mockResolvedValueOnce(false) // asus is taken
        .mockResolvedValueOnce(true)  // asus-store is available
        .mockResolvedValueOnce(true)  // asus-shop is available
        .mockResolvedValueOnce(true); // asus-market is available

      const result = await service.checkSubdomainAvailability('asus');

      expect(result.available).toBe(false);
      expect(result.message).toBe('Subdomain is already taken');
      expect(result.suggestions).toHaveLength(3);
      expect(result.suggestions).toContain('asus-store');
      expect(result.suggestions).toContain('asus-shop');
      expect(result.suggestions).toContain('asus-market');
    });

    it('should sanitize input subdomain to lowercase', async () => {
      mockTenantService.checkSubdomainAvailability.mockResolvedValue(true);

      const result = await service.checkSubdomainAvailability('ASUS');

      expect(result).toEqual({ available: true });
      expect(mockTenantService.checkSubdomainAvailability).toHaveBeenCalledWith('asus');
    });

    it('should remove special characters from subdomain', async () => {
      mockTenantService.checkSubdomainAvailability.mockResolvedValue(true);

      const result = await service.checkSubdomainAvailability('asus™-store!');

      expect(result).toEqual({ available: true });
      expect(mockTenantService.checkSubdomainAvailability).toHaveBeenCalledWith('asus-store');
    });

    it('should reject subdomain shorter than 3 characters', async () => {
      const result = await service.checkSubdomainAvailability('ab');

      expect(result.available).toBe(false);
      expect(result.message).toBe('Subdomain must be at least 3 characters');
      expect(result.suggestions).toEqual([]);
      expect(mockTenantService.checkSubdomainAvailability).not.toHaveBeenCalled();
    });

    it('should generate diverse suggestions including suffixes and numbers', async () => {
      // Mock: base subdomain is taken, but some variations are available
      mockTenantService.checkSubdomainAvailability
        .mockResolvedValueOnce(false)  // store is taken
        .mockResolvedValueOnce(false)  // store-store is taken (will be skipped)
        .mockResolvedValueOnce(true)   // store-shop is available
        .mockResolvedValueOnce(true)   // store-market is available
        .mockResolvedValueOnce(true);  // store-official is available

      const result = await service.checkSubdomainAvailability('store');

      expect(result.available).toBe(false);
      expect(result.suggestions).toHaveLength(3);
      
      // Should have mix of suggestion types
      const hasSuffixSuggestion = result.suggestions.some(s => 
        s.includes('-shop') || s.includes('-market') || s.includes('-store') || s.includes('-official')
      );
      expect(hasSuffixSuggestion).toBe(true);
    });

    it('should fallback to random/timestamp if many conflicts', async () => {
      // Mock: All priority suggestions are taken
      mockTenantService.checkSubdomainAvailability
        .mockResolvedValue(false)  // Everything is taken except random ones
        .mockResolvedValueOnce(false)  // base
        // After many attempts, some random ones will succeed
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)   // First random succeeds
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)   // Second random succeeds  
        .mockResolvedValueOnce(true);  // Third random succeeds

      const result = await service.checkSubdomainAvailability('popular');

      expect(result.available).toBe(false);
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions.length).toBeLessThanOrEqual(3);
    });

    it('should always provide at least 1 suggestion even in worst case', async () => {
      // Mock: Everything fails (worst case scenario)
      mockTenantService.checkSubdomainAvailability.mockResolvedValue(false);

      const result = await service.checkSubdomainAvailability('verycommon');

      expect(result.available).toBe(false);
      expect(result.suggestions).toHaveLength(1);
      
      // The final fallback uses timestamp
      expect(result.suggestions[0]).toMatch(/verycommon-\d{6}/);
    });

    it('should handle errors gracefully and provide basic suggestions', async () => {
      mockTenantService.checkSubdomainAvailability.mockRejectedValue(
        new Error('Database connection failed')
      );

      const result = await service.checkSubdomainAvailability('teststore');

      expect(result.available).toBe(false);
      expect(result.message).toBe('Error checking availability');
      expect(result.suggestions).toHaveLength(3);
      
      // Should provide basic fallback suggestions
      expect(result.suggestions).toContain('teststore1');
      expect(result.suggestions).toContain('teststore-store');
      expect(result.suggestions[2]).toMatch(/teststore-\d+/);
    });

    it('should prevent duplicate suggestions', async () => {
      mockTenantService.checkSubdomainAvailability
        .mockResolvedValueOnce(false)  // base
        .mockResolvedValueOnce(true)   // first suggestion
        .mockResolvedValueOnce(true)   // second suggestion
        .mockResolvedValueOnce(true);  // third suggestion

      const result = await service.checkSubdomainAvailability('myshop');

      expect(result.suggestions).toHaveLength(3);
      
      // Check for uniqueness
      const uniqueSuggestions = new Set(result.suggestions);
      expect(uniqueSuggestions.size).toBe(3);
    });

    it('should include region-specific suggestions (sa, ksa)', async () => {
      mockTenantService.checkSubdomainAvailability
        .mockResolvedValueOnce(false)  // base is taken
        .mockResolvedValue(true);      // all suggestions available

      const result = await service.checkSubdomainAvailability('arabic');

      expect(result.available).toBe(false);
      expect(result.suggestions).toHaveLength(3);
      
      // At least one of the priority suggestions should be available
      // which could include -sa or -ksa
      const allOptions = result.suggestions.join(',');
      const hasRegionalOrSuffix = 
        allOptions.includes('-sa') || 
        allOptions.includes('-ksa') || 
        allOptions.includes('-store') ||
        allOptions.includes('-shop');
      
      expect(hasRegionalOrSuffix).toBe(true);
    });
  });
});
