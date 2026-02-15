import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../tenant/tenant.service';

@Injectable()
export class PublicService {
  private readonly logger = new Logger(PublicService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => TenantService))
    private tenantService: TenantService,
  ) {}

  /**
   * Get all active partners for public display
   * Returns only public-safe data (no sensitive information)
   */
  async getActivePartners() {
    try {
      const partners = await this.prisma.partner.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          nameAr: true,
          logo: true,
          description: true,
          descriptionAr: true,
          website: true,
          // Only return public information
          // Don't expose email, phone, commission details
        },
        orderBy: { createdAt: 'asc' },
      });

      // Map to a format suitable for the landing page
      return {
        partners: partners.map((partner: any) => ({
          id: partner.id,
          name: partner.name,
          nameAr: partner.nameAr || partner.name,
          logo: partner.logo || `/partners/${partner.name.toLowerCase().replace(/\s+/g, '-')}-logo.png`,
          description: partner.description || '',
          descriptionAr: partner.descriptionAr || partner.description || '',
          website: partner.website,
        })),
      };
    } catch (error) {
      this.logger.error('Failed to fetch active partners:', error);
      return { partners: [] };
    }
  }

  /**
   * Get all active subscription plans for public display
   */
  async getActivePlans(billingCycle?: string) {
    try {
      const where: any = { isActive: true };
      if (billingCycle) {
        where.billingCycle = billingCycle;
      }

      const plans = await this.prisma.subscriptionPlan.findMany({
        where,
        select: {
          id: true,
          code: true,
          name: true,
          nameAr: true,
          description: true,
          descriptionAr: true,
          price: true,
          currency: true,
          billingCycle: true,
          features: true,
          featuresAr: true,
          limits: true,
          isPopular: true,
          sortOrder: true,
        },
        orderBy: { sortOrder: 'asc' },
      });

      return {
        plans: plans.map((plan: any) => ({
          ...plan,
          price: plan.price.toString(), // Convert Decimal to string for JSON
        })),
      };
    } catch (error) {
      this.logger.error('Failed to fetch active plans:', error);
      // Return default plans as fallback
      return {
        plans: [
          {
            id: 'starter',
            code: 'STARTER',
            name: 'Starter',
            nameAr: 'المبتدئ',
            description: 'Perfect for small businesses',
            descriptionAr: 'مثالية للأعمال الصغيرة',
            price: '99',
            currency: 'SAR',
            billingCycle: 'MONTHLY',
            features: ['Up to 100 products', 'Basic analytics', 'Email support'],
            featuresAr: ['حتى 100 منتج', 'تحليلات أساسية', 'دعم بالبريد الإلكتروني'],
            limits: { products: 100, orders: 500, storage: 5, staff: 2 },
            isPopular: false,
            sortOrder: 1,
          },
          {
            id: 'professional',
            code: 'PROFESSIONAL',
            name: 'Professional',
            nameAr: 'المحترف',
            description: 'For growing businesses',
            descriptionAr: 'للأعمال النامية',
            price: '299',
            currency: 'SAR',
            billingCycle: 'MONTHLY',
            features: ['Unlimited products', 'Advanced analytics', 'Priority support', 'Custom domain'],
            featuresAr: ['منتجات غير محدودة', 'تحليلات متقدمة', 'دعم أولوية', 'نطاق مخصص'],
            limits: { products: -1, orders: -1, storage: 50, staff: 10 },
            isPopular: true,
            sortOrder: 2,
          },
          {
            id: 'enterprise',
            code: 'ENTERPRISE',
            name: 'Enterprise',
            nameAr: 'المؤسسات',
            description: 'For large enterprises',
            descriptionAr: 'للمؤسسات الكبيرة',
            price: '999',
            currency: 'SAR',
            billingCycle: 'MONTHLY',
            features: ['Everything in Pro', 'Dedicated account manager', 'Custom integrations', 'SLA guarantee'],
            featuresAr: ['كل مميزات المحترف', 'مدير حساب مخصص', 'تكاملات مخصصة', 'ضمان SLA'],
            limits: { products: -1, orders: -1, storage: -1, staff: -1 },
            isPopular: false,
            sortOrder: 3,
          },
        ],
      };
    }
  }

  /**
   * Get supported payment providers
   */
  async getPaymentProviders() {
    try {
      // Get unique active payment providers from all payment methods
      const paymentMethods = await this.prisma.paymentMethod.findMany({
        where: { isActive: true },
        select: { provider: true },
        distinct: ['provider'],
      });

      // Map providers to display format
      const providerDetails: Record<string, any> = {
        HYPERPAY: {
          id: 'hyperpay',
          name: 'HyperPay',
          nameAr: 'هايبر باي',
          logo: '/payment/hyperpay.svg',
          description: 'Secure payment gateway for MENA region',
          descriptionAr: 'بوابة دفع آمنة لمنطقة الشرق الأوسط',
        },
        STRIPE: {
          id: 'stripe',
          name: 'Stripe',
          nameAr: 'سترايب',
          logo: '/payment/stripe.svg',
          description: 'Global payment processing platform',
          descriptionAr: 'منصة معالجة مدفوعات عالمية',
        },
        PAYPAL: {
          id: 'paypal',
          name: 'PayPal',
          nameAr: 'باي بال',
          logo: '/payment/paypal.svg',
          description: 'Trusted worldwide payment solution',
          descriptionAr: 'حل دفع موثوق عالمياً',
        },
        CASH_ON_DELIVERY: {
          id: 'cod',
          name: 'Cash on Delivery',
          nameAr: 'الدفع عند الاستلام',
          logo: '/payment/cod.svg',
          description: 'Pay when you receive your order',
          descriptionAr: 'الدفع عند استلام طلبك',
        },
      };

      const providers = paymentMethods.map((pm: any) => providerDetails[pm.provider] || {
        id: pm.provider.toLowerCase(),
        name: pm.provider,
        nameAr: pm.provider,
        logo: '/payment/default.svg',
      });

      // If no providers in DB, return default supported ones
      if (providers.length === 0) {
        return {
          providers: [
            providerDetails.HYPERPAY,
            providerDetails.STRIPE,
            providerDetails.PAYPAL,
            providerDetails.CASH_ON_DELIVERY,
          ],
        };
      }

      return { providers };
    } catch (error) {
      this.logger.error('Failed to fetch payment providers:', error);
      return {
        providers: [
          {
            id: 'hyperpay',
            name: 'HyperPay',
            nameAr: 'هايبر باي',
            logo: '/payment/hyperpay.svg',
          },
          {
            id: 'stripe',
            name: 'Stripe',
            nameAr: 'سترايب',
            logo: '/payment/stripe.svg',
          },
        ],
      };
    }
  }

  /**
   * Get platform statistics for landing page
   */
  async getPlatformStats() {
    try {
      const [
        totalStores,
        totalOrders,
        totalProducts,
      ] = await Promise.all([
        this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
        this.prisma.order.count(),
        this.prisma.product.count({ where: { isPublished: true } }),
      ]);

      return {
        stats: {
          stores: this.formatNumber(totalStores),
          orders: this.formatNumber(totalOrders),
          products: this.formatNumber(totalProducts),
          uptime: '99.9%',
          support: '24/7',
        },
      };
    } catch (error) {
      this.logger.error('Failed to fetch platform stats:', error);
      return {
        stats: {
          stores: '1,000+',
          orders: '50,000+',
          products: '100,000+',
          uptime: '99.9%',
          support: '24/7',
        },
      };
    }
  }

  /**
   * Get testimonials for landing page
   */
  async getTestimonials(limit: number = 6) {
    // In a real implementation, this would fetch from a reviews/testimonials table
    // For now, return sample testimonials
    return {
      testimonials: [
        {
          id: '1',
          name: 'أحمد محمد',
          nameEn: 'Ahmed Mohammed',
          role: 'مالك متجر الإلكترونيات',
          roleEn: 'Electronics Store Owner',
          content: 'منصة رائعة! زادت مبيعاتي 300% في 6 أشهر.',
          contentEn: 'Amazing platform! My sales increased 300% in 6 months.',
          rating: 5,
        },
        {
          id: '2',
          name: 'فاطمة علي',
          nameEn: 'Fatima Ali',
          role: 'مالكة متجر الأزياء',
          roleEn: 'Fashion Store Owner',
          content: 'سهولة الاستخدام والدعم الممتاز جعلا تجربتي استثنائية.',
          contentEn: 'Ease of use and excellent support made my experience exceptional.',
          rating: 5,
        },
        {
          id: '3',
          name: 'خالد سعيد',
          nameEn: 'Khaled Saeed',
          role: 'مالك متجر رقمي',
          roleEn: 'Digital Store Owner',
          content: 'أفضل منصة جربتها. التقارير مفيدة جداً.',
          contentEn: 'Best platform I have tried. The reports are very useful.',
          rating: 5,
        },
      ].slice(0, limit),
    };
  }

  // Helper methods

  private formatNumber(num: number): string {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M+`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(0)}K+`;
    }
    if (num > 0) {
      return `${num}+`;
    }
    return '1,000+'; // Default fallback
  }

  private getPartnerLogoPath(name: string): string {
    const normalizedName = name.toLowerCase().replace(/\s+/g, '-');
    return `/partners/${normalizedName}-logo.png`;
  }

  private getPartnerDescription(name: string): string {
    const descriptions: Record<string, string> = {
      'ASUS': 'Products supplier partner - Get gaming cards, PUBG, PlayStation cards directly from ASUS',
      'Smart Line': 'Marketing and social media partner - Integrated marketing solutions and professional social media management',
    };
    return descriptions[name] || 'Trusted business partner';
  }

  private getPartnerDescriptionAr(name: string): string {
    const descriptions: Record<string, string> = {
      'ASUS': 'شريك توريد المنتجات - احصل على بطاقات الألعاب، شدات PUBG، وبطاقات PlayStation مباشرة من ASUS',
      'Smart Line': 'شريك التسويق والسوشيال ميديا - حلول تسويقية متكاملة وإدارة احترافية لحسابات التواصل الاجتماعي',
    };
    return descriptions[name] || 'شريك أعمال موثوق';
  }

  /**
   * Get content for a specific page (about, contact, privacy)
   */
  async getPageContent(slug: string) {
    try {
      const config = await this.prisma.platformConfig.findUnique({
        where: { key: `page_${slug}` },
      });

      if (!config) {
        // Return default content if not found
        return {
          content: {
            titleAr: slug === 'about' ? 'من نحن' : slug === 'contact' ? 'تواصل معنا' : 'سياسة الخصوصية',
            titleEn: slug === 'about' ? 'About Us' : slug === 'contact' ? 'Contact Us' : 'Privacy Policy',
            contentAr: '<p>المحتوى قيد التحديث...</p>',
            contentEn: '<p>Content coming soon...</p>',
          }
        };
      }

      return { content: config.value };
    } catch (error) {
      this.logger.error(`Failed to fetch page content for ${slug}:`, error);
      return { content: null };
    }
  }

  /**
   * Check if a subdomain is available and provide suggestions if not
   * If taken, returns exactly 3 alternative subdomain suggestions
   */
  async checkSubdomainAvailability(subdomain: string) {
    try {
      // Basic validation
      if (!subdomain || subdomain.length < 3) {
        return { 
          available: false, 
          message: 'Subdomain must be at least 3 characters',
          suggestions: []
        };
      }

      // Sanitize input - only lowercase alphanumeric and hyphens
      const cleanSubdomain = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '');
      
      if (cleanSubdomain !== subdomain) {
        this.logger.warn(`Subdomain sanitized from '${subdomain}' to '${cleanSubdomain}'`);
      }

      const isAvailable = await this.tenantService.checkSubdomainAvailability(cleanSubdomain);
      if (isAvailable) {
        return { available: true };
      }

      // ===== Subdomain is taken - Generate 3 suggestions =====
      
      const currentYear = new Date().getFullYear();
      const shortYear = currentYear.toString().slice(-2); // Last 2 digits
      
      // Priority 1: Suffix-based suggestions (most professional)
      const suffixSuggestions = [
        `${cleanSubdomain}-store`,
        `${cleanSubdomain}-shop`,
        `${cleanSubdomain}-market`,
        `${cleanSubdomain}-official`,
        `${cleanSubdomain}-sa`,
        `${cleanSubdomain}-ksa`,
        `${cleanSubdomain}-online`,
        `${cleanSubdomain}-boutique`,
      ];

      // Priority 2: Number-based suggestions
      const numberSuggestions = [
        `${cleanSubdomain}1`,
        `${cleanSubdomain}${shortYear}`,
        `${cleanSubdomain}${currentYear}`,
        `${cleanSubdomain}-${randomInt(10, 99)}`,
      ];

      // Priority 3: Hybrid suggestions
      const hybridSuggestions = [
        `${cleanSubdomain}-${shortYear}`,
        `${cleanSubdomain}-${currentYear}`,
        `${cleanSubdomain}shop`,
        `${cleanSubdomain}store`,
      ];

      // Combine all potential suggestions in priority order
      const allPotentialSuggestions = [
        ...suffixSuggestions,
        ...numberSuggestions,
        ...hybridSuggestions,
      ];

      const availableSuggestions: string[] = [];
      const checkedSuggestions = new Set<string>(); // Prevent duplicate checks

      // First pass: Check priority suggestions
      for (const suggestion of allPotentialSuggestions) {
        if (availableSuggestions.length >= 3) break;
        
        if (checkedSuggestions.has(suggestion)) continue;
        checkedSuggestions.add(suggestion);
        
        if (await this.tenantService.checkSubdomainAvailability(suggestion)) {
          availableSuggestions.push(suggestion);
        }
      }

      // Second pass: Generate random variations if we don't have 3 yet
      let attempts = 0;
      const maxAttempts = 50;
      
      while (availableSuggestions.length < 3 && attempts < maxAttempts) {
        attempts++;
        
        // Alternate between different generation strategies
        let candidate: string;
        const strategy = attempts % 4;
        
        switch (strategy) {
          case 0:
            // Random 3-digit number
            candidate = `${cleanSubdomain}${randomInt(100, 999)}`;
            break;
          case 1:
            // Random 4-digit number with hyphen
            candidate = `${cleanSubdomain}-${randomInt(1000, 9999)}`;
            break;
          case 2:
            // Sequential number
            candidate = `${cleanSubdomain}${attempts}`;
            break;
          default:
            // Random suffix with number
            const randomSuffixes = ['shop', 'store', 'market', 'plus', 'pro', 'online'];
            const randomSuffix = randomSuffixes[randomInt(0, randomSuffixes.length - 1)];
            candidate = `${cleanSubdomain}-${randomSuffix}${randomInt(1, 99)}`;
        }
        
        if (checkedSuggestions.has(candidate)) continue;
        checkedSuggestions.add(candidate);
        
        if (await this.tenantService.checkSubdomainAvailability(candidate)) {
          availableSuggestions.push(candidate);
        }
      }

      // Final fallback: Ensure we always have at least 1 suggestion by using timestamp
      if (availableSuggestions.length === 0) {
        const timestampSuffix = Date.now().toString().slice(-6); // Last 6 digits
        const fallback = `${cleanSubdomain}-${timestampSuffix}`;
        availableSuggestions.push(fallback);
      }

      return {
        available: false,
        message: 'Subdomain is already taken',
        suggestions: availableSuggestions.slice(0, 3), // Always return max 3
      };
    } catch (error) {
      this.logger.error(`Error checking subdomain availability for ${subdomain}:`, error);
      
      // Even on error, try to provide basic suggestions
      const basicSuggestions = [
        `${subdomain}1`,
        `${subdomain}-store`,
        `${subdomain}-${randomInt(10, 99)}`,
      ];
      
      return { 
        available: false,
        message: 'Error checking availability',
        suggestions: basicSuggestions.slice(0, 3)
      };
    }
  }

  /**
   * Get active banks for a tenant (for checkout display)
   * Public endpoint - customers can see merchant bank accounts during checkout
   */
  async getBanksForCheckout(tenantId: string) {
    try {
      const banks = await this.prisma.bank.findMany({
        where: {
          tenantId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          nameAr: true,
          code: true,
          logo: true,
          accountName: true,
          accountNumber: true,
          iban: true,
          swiftCode: true,
          sortOrder: true,
        },
        orderBy: { sortOrder: 'asc' },
      });

      return { banks };
    } catch (error) {
      this.logger.error(`Failed to fetch banks for tenant ${tenantId}:`, error);
      return { banks: [] };
    }
  }

  /**
   * Get published pages for storefront navigation
   * Returns only published pages that should appear in header/footer navigation
   */
  async getNavigationPages(tenantId: string) {
    try {
      // First check total pages count (including unpublished) for debugging
      const totalPages = await this.prisma.page.count({
        where: { tenantId },
      });
      
      const publishedPages = await this.prisma.page.findMany({
        where: {
          tenantId,
          isPublished: true,
        },
        select: {
          id: true,
          title: true,
          titleAr: true,
          titleEn: true,
          slug: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      this.logger.log(`📄 Navigation pages for tenant ${tenantId}: ${publishedPages.length} published out of ${totalPages} total`);

      if (publishedPages.length === 0 && totalPages === 0) {
        this.logger.log(`🌱 specific tenant ${tenantId} has no pages. Seeding default pages...`);
        try {
          await this.seedDefaultPages(tenantId);
          
          // Refetch after seeding (only if seeding was successful)
          try {
            return this.getNavigationPages(tenantId);
          } catch (refetchError) {
            this.logger.warn(`Failed to refetch pages after seeding for tenant ${tenantId}:`, refetchError);
            // Return empty pages array instead of failing
            return { pages: [] };
          }
        } catch (seedError) {
          this.logger.warn(`Failed to seed default pages for tenant ${tenantId}:`, seedError);
          // Return empty pages array instead of failing
          return { pages: [] };
        }
      }

      return {
        pages: publishedPages.map((page: any) => ({
          id: page.id,
          title: page.title,
          titleAr: page.titleAr,
          titleEn: page.titleEn,
          slug: page.slug,
          url: `/page/${page.slug}`,
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to fetch navigation pages for tenant ${tenantId}:`, error);
      return { pages: [] };
    }
  }

  /**
   * Seed default pages for a tenant
   */
  private async seedDefaultPages(tenantId: string) {
    try {
      // First, verify the tenant exists to prevent foreign key constraint violations
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true }
      });

      if (!tenant) {
        this.logger.warn(`Cannot seed default pages: Tenant ${tenantId} does not exist in database`);
        return;
      }

      const defaultPages = [
        {
          title: 'Store',
          titleAr: 'المتجر',
          titleEn: 'Store',
          slug: 'store',
          content: {
             sections: [
               {
                 type: 'hero',
                 props: {
                   title: 'Welcome to our Store',
                   titleAr: 'مرحباً بكم في متجرنا',
                   subtitle: 'Browse our collection',
                   subtitleAr: 'تصفح مجموعتنا',
                   backgroundImage: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8'
                 }
               },
               {
                 type: 'store-page',
                 props: { title: 'Products', showCart: true }
               }
             ]
          },
          isPublished: true,
        },
        {
          title: 'Contact Us',
          titleAr: 'اتصل بنا',
          titleEn: 'Contact Us',
          slug: 'contact',
          content: {
             sections: [
               {
                 type: 'text',
                 props: {
                   title: 'Contact Us',
                   titleAr: 'اتصل بنا',
                   text: 'We are here to help.',
                   textAr: 'نحن هنا للمساعدة.'
                 }
               }
             ]
          },
          isPublished: true,
        },
        {
          title: 'About Us',
          titleAr: 'من نحن',
          titleEn: 'About Us',
          slug: 'about',
          content: {
             sections: [
               {
                 type: 'text',
                 props: {
                   title: 'About Us',
                   titleAr: 'من نحن',
                   text: 'Our story begins here.',
                   textAr: 'قصتنا تبدأ هنا.'
                 }
               }
             ]
          },
          isPublished: true,
        }
      ];

      await Promise.all(
        defaultPages.map(page => 
          this.prisma.page.create({
            data: {
              ...page,
              tenantId,
            }
          })
        )
      );
      
      this.logger.log(`✅ Seeded ${defaultPages.length} default pages for tenant ${tenantId}`);
    } catch (error) {
      this.logger.error(`Failed to seed default pages for tenant ${tenantId}:`, error);
      // Don't throw - this is a non-critical operation that shouldn't break the request
    }
  }
}
