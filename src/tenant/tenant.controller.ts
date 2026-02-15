import { Controller, Get, Post, Body, Param, Delete, UseGuards, Request, Query, BadRequestException, ConflictException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { TenantSyncService } from './tenant-sync.service';
import { AuthClientService } from './auth-client.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../types/request.types';
import { Public } from '../auth/public.decorator';
import { TemplateService } from '../template/template.service';
import { PageService } from '../page/page.service';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantService } from '../merchant/services/merchant.service';
import { UserService } from '../user/user.service';
import { CurrencyService } from '../currency/currency.service';
import { v4 as uuidv4 } from 'uuid';
import { SetupMarketDto } from './dto/setup-market.dto';

@UseGuards(JwtAuthGuard)
@Controller('tenants')
export class TenantController {
  private readonly logger = new Logger(TenantController.name);

  constructor(
    private readonly tenantService: TenantService,
    private readonly tenantSyncService: TenantSyncService,
    private readonly authClientService: AuthClientService,
    private readonly templateService: TemplateService,
    private readonly pageService: PageService,
    private readonly prisma: PrismaService,
    private readonly merchantService: MerchantService,
    private readonly userService: UserService,
    private readonly currencyService: CurrencyService,
  ) {}

  @Post('setup')
  async setupMarket(
    @Request() req: AuthenticatedRequest,
    @Body() body: SetupMarketDto
  ) {
    try {
      // Validate user authentication
      if (!req.user || !req.user.id) {
        throw new BadRequestException('User authentication required');
      }

      // DTO validation is handled by ValidationPipe, but ensure values are still valid after transform
      if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
        throw new BadRequestException('Market name is required and cannot be empty');
      }
      if (!body.subdomain || typeof body.subdomain !== 'string' || !body.subdomain.trim()) {
        throw new BadRequestException('Subdomain is required and cannot be empty');
      }

    // Check if subdomain is already taken or conflicts with custom domain
    const isAvailable = await this.tenantService.checkSubdomainAvailability(body.subdomain);
    if (!isAvailable) {
      throw new ConflictException(
        `Subdomain "${body.subdomain}" is already taken or conflicts with an existing custom domain. ` +
        `Please choose a different subdomain.`
      );
    }

    // Get access token for auth service calls
    const accessToken = req.headers.authorization?.replace('Bearer ', '') || '';

    // Check market limit (can be bypassed in development or with env var)
    const skipLimitCheck = 
      process.env.SKIP_MARKET_LIMIT_CHECK === 'true' || 
      (process.env.NODE_ENV !== 'production' && process.env.SKIP_MARKET_LIMIT_CHECK !== 'false');
    
    if (!skipLimitCheck) {
      try {
        const limitCheck = await this.authClientService.checkCanCreateMarket(req.user.id, accessToken);
        
        if (!limitCheck.allowed) {
          throw new ForbiddenException(
            `Market limit reached. You have ${limitCheck.currentCount} of ${limitCheck.limit} markets. Please contact support to increase your limit.`
          );
        }
      } catch (error: any) {
        // If the limit check fails due to auth service being unavailable, 
        // allow creation in development mode
        if (process.env.NODE_ENV !== 'production') {
          this.logger.warn(`⚠️ Market limit check failed, but allowing in development: ${error.message}`);
        } else {
          throw error;
        }
      }
    } else {
      this.logger.warn(`⚠️ Skipping market limit check for user ${req.user.id} (development mode or SKIP_MARKET_LIMIT_CHECK=true)`);
    }

    // Generate new tenant ID
    const tenantId = uuidv4();
    this.logger.log(`🔄 Starting tenant setup for ID: ${tenantId}, subdomain: ${body.subdomain}`);
    
    // Create tenant in both core and auth databases, and link to user
    try {
      // Create in auth database and link user (this also checks market limit)
      this.logger.log(`📤 Creating tenant in auth database...`);
      await this.authClientService.createTenantAndLink(
        req.user.id,
        {
          id: tenantId,
          name: body.name,
          subdomain: body.subdomain,
          plan: 'STARTER',
          status: 'ACTIVE',
        },
        accessToken
      );
      this.logger.log(`✅ Tenant created in auth database`);

      // Create tenant in core database
      this.logger.log(`📤 Creating tenant in core database...`);
      const createdTenant = await this.tenantSyncService.ensureTenantExists(tenantId, {
        name: body.name,
        subdomain: body.subdomain,
        description: body.description,
        templateId: body.template,
      });

      if (!createdTenant) {
        this.logger.error(`❌ ensureTenantExists returned null for tenant ${tenantId}`);
        throw new BadRequestException('Failed to create tenant in core database');
      }
      this.logger.log(`✅ Tenant created successfully: ${createdTenant.id}`);

      // Trust the tenant returned from ensureTenantExists - it was just created
      // The tenant exists in the database, so we can proceed
      this.logger.log(`✅ Using tenant from ensureTenantExists: ${createdTenant.id}`);
      const verifiedTenant = createdTenant;

      // Ensure user exists in core database (sync from auth)
      // Pass tenantId only after tenant is confirmed to exist
      await this.userService.ensureUserExists(req.user.id, {
        email: req.user.email || '',
        name: req.user.name,
        role: req.user.role || 'SHOP_OWNER',
        tenantId: tenantId, // Now safe to pass since tenant exists
      });

      // Tenant is confirmed to exist (from ensureTenantExists result)
      // Proceed with merchant creation and other setup steps
      this.logger.log(`✅ Tenant ${tenantId} confirmed and ready for setup`);

      // Create merchant for this user and tenant (with user data for auto-sync if needed)
      // This is optional - don't fail the entire setup if merchant creation fails
      try {
        await this.merchantService.getOrCreateMerchant(tenantId, req.user.id, {
          businessName: body.name,
          email: req.user.email || '',
          name: req.user.name,
          role: req.user.role || 'SHOP_OWNER',
        });
        this.logger.log(`✅ Merchant created for tenant ${tenantId}`);
      } catch (merchantError: any) {
        // Log but don't fail - merchant can be created later
        this.logger.warn(`⚠️ Failed to create merchant for tenant ${tenantId}, but continuing:`, merchantError);
      }
      
      // If we got here, tenant was created successfully
      // Return success response
      this.logger.log(`✅ Market setup completed successfully for tenant ${tenantId}`);
      
    } catch (error: any) {
      this.logger.error(`❌ Error during tenant setup for ${tenantId}:`, error);
      
      // If creation fails, try to clean up (ignore errors if tenant doesn't exist)
      try {
        const tenantExists = await this.prisma.tenant.findUnique({ 
          where: { id: tenantId },
          select: { id: true },
        });
        if (tenantExists) {
          this.logger.warn(`Attempting to delete partially created tenant ${tenantId} due to error.`);
          await this.prisma.tenant.delete({ where: { id: tenantId } });
          this.logger.log(`Cleaned up tenant ${tenantId}.`);
        } else {
          this.logger.warn(`Tenant ${tenantId} did not exist in core database, no cleanup needed.`);
        }
      } catch (cleanupError) {
        // Ignore cleanup errors
        this.logger.warn(`Cleanup failed for tenant ${tenantId}: ${cleanupError}`);
      }
      
      // Handle specific error types
      if (error instanceof ForbiddenException) {
        throw error;
      }
      if (error instanceof ConflictException) {
        throw error;
      }
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      // Check error message for specific cases
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      if (errorMessage.includes('Market limit reached')) {
        throw new ForbiddenException(errorMessage);
      }
      
      if (errorMessage.includes('Conflict:') || errorMessage.includes('already taken') || errorMessage.includes('conflicts with')) {
        throw new ConflictException(errorMessage.replace('Conflict: ', ''));
      }
      
      // Log full error details for debugging
      this.logger.error(`Full error details:`, {
        message: errorMessage,
        stack: error?.stack,
        name: error?.name,
      });
      
      throw new BadRequestException(errorMessage || 'Failed to create market. Please try again.');
    }

    // Initialize default SiteConfig for the new market
    try {
      await this.prisma.siteConfig.create({
        data: {
          tenantId,
          header: {
            logo: null,
            storeName: body.name,
            menuItems: [
              { label: 'Home', href: '/' },
              { label: 'Products', href: '/products' },
              { label: 'About', href: '/about' },
              { label: 'Contact', href: '/contact' },
            ],
          },
          footer: {
            copyright: `© ${new Date().getFullYear()} ${body.name}. All rights reserved.`,
            socialLinks: [],
            links: [],
          },
          background: {
            type: 'solid',
            color: '#ffffff',
          },
          language: 'en',
          theme: 'light',
          paymentMethods: [],
          hyperpayConfig: {},
        },
      });
    } catch (error) {
      console.error('Failed to create site config:', error);
      // Non-fatal: continue even if site config creation fails
    }

    // Store market data in tenant settings
    try {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          settings: {
            storeName: body.name,
            storeDescription: body.description,
            templateId: body.template,
            customDomain: body.customDomain,
            createdAt: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      console.error('Failed to update tenant settings:', error);
    }

    // If template is selected, initialize the Home page and all template pages
    if (body.template) {
        try {
            // Find the template (assuming body.template is the template ID or we map it)
            // The frontend sends 'modern', 'minimal', etc. which are IDs in the seed data.
            const template = await this.templateService.findOne(body.template);
            
            // Create Home Page from template content
            await this.pageService.create(tenantId, {
                title: 'Home',
                slug: 'home',
                content: template.content,
                isPublished: true,
                seoTitle: body.name,
                seoDesc: body.description,
            }).catch(async (err) => {
                // If page exists, update it
                if (err instanceof ConflictException) {
                    const existingPage = await this.pageService.findBySlug(tenantId, 'home');
                    await this.pageService.update(tenantId, existingPage.id, {
                        content: template.content,
                        isPublished: true,
                    });
                }
            });

            // Create pages from template.content.pages array if it exists
            if (template.content && typeof template.content === 'object' && 'pages' in template.content && Array.isArray(template.content.pages)) {
                const templatePages = template.content.pages as any[];
                let createdCount = 0;
                
                for (const pageDef of templatePages) {
                    try {
                        // Extract slug from page definition (remove leading slash if present)
                        let slug = (pageDef.slug || pageDef.id || '').replace(/^\//, '');
                        if (!slug) continue;
                        
                        // Handle special routes like /account/inventory - keep the full path
                        // But ensure it doesn't start with a slash for database storage
                        if (slug.startsWith('account/')) {
                            // Keep account/ prefix but remove leading slash if any
                            slug = slug.replace(/^\//, '');
                        }

                        // Check if page already exists (includeUnpublished = true to check all pages including drafts)
                        const existingPage = await this.pageService.findBySlug(tenantId, slug, true).catch(() => null);
                        
                        if (!existingPage) {
                            await this.pageService.create(tenantId, {
                                title: pageDef.name || pageDef.nameAr || pageDef.nameEn || 'Untitled Page',
                                titleAr: pageDef.nameAr,
                                titleEn: pageDef.nameEn || pageDef.name,
                                slug: slug,
                                content: {
                                    sections: pageDef.sections || []
                                },
                                isPublished: true,
                                seoTitle: pageDef.name || pageDef.nameAr || pageDef.nameEn,
                                seoTitleAr: pageDef.nameAr,
                                seoTitleEn: pageDef.nameEn || pageDef.name,
                            });
                            createdCount++;
                            this.logger.log(`✅ Created page: ${slug}`);
                        } else {
                            this.logger.log(`⏭️  Page already exists: ${slug}`);
                        }
                    } catch (pageError: any) {
                        // Log but don't fail - continue creating other pages
                        this.logger.warn(`⚠️  Failed to create page ${pageDef.slug || pageDef.id}: ${pageError?.message || 'Unknown error'}`);
                    }
                }
                
                this.logger.log(`✅ Created ${createdCount} pages from template for tenant ${tenantId}`);
            }
        } catch (error) {
            this.logger.error('Failed to apply template:', error);
            // Don't fail the whole setup if template fails, just log it
        }
    } else {
      // Create default Home page if no template selected
      try {
        await this.pageService.create(tenantId, {
          title: 'Home',
          slug: 'home',
          content: [
            {
              id: 'hero',
              type: 'hero',
              content: {
                title: `Welcome to ${body.name}`,
                subtitle: body.description || 'Discover our amazing products',
                buttonText: 'Shop Now',
                buttonLink: '/products',
              },
            },
          ],
          isPublished: true,
          seoTitle: body.name,
          seoDesc: body.description || `Welcome to ${body.name}`,
        });
      } catch (error) {
        console.error('Failed to create default home page:', error);
      }
    }

    // Create default About and Contact pages
    try {
      await this.pageService.create(tenantId, {
        title: 'About Us',
        slug: 'about',
        content: [
          {
            id: 'about-content',
            type: 'text',
            content: {
              title: `About ${body.name}`,
              text: body.description || `Welcome to ${body.name}. We are dedicated to providing the best products and services to our customers.`,
            },
          },
        ],
        isPublished: true,
        seoTitle: `About - ${body.name}`,
        seoDesc: `Learn more about ${body.name}`,
      });
    } catch (error) {
      // Ignore if page already exists
    }

    try {
      await this.pageService.create(tenantId, {
        title: 'Contact',
        slug: 'contact',
        content: [
          {
            id: 'contact-content',
            type: 'contact',
            content: {
              title: 'Contact Us',
              subtitle: 'Get in touch with us',
            },
          },
        ],
        isPublished: true,
        seoTitle: `Contact - ${body.name}`,
        seoDesc: `Contact ${body.name}`,
      });
    } catch (error) {
      // Ignore if page already exists
    }

    // Initialize default currencies (SAR and USD)
    try {
      await this.currencyService.initializeDefaultCurrencies(tenantId);
      this.logger.log(`✅ Initialized default currencies for tenant ${tenantId}`);
    } catch (error) {
      this.logger.error(`⚠️ Failed to initialize default currencies for tenant ${tenantId}:`, error);
      // Don't fail the whole setup if currency initialization fails
    }
    
      await this.createDefaultPages(tenantId, body.name, body.description || '');

      return {
        id: tenantId,
        name: body.name,
        subdomain: body.subdomain,
        customDomain: body.customDomain,
        isActive: true,
        createdAt: new Date().toISOString(),
      };
    } catch (error: any) {
      // This catch block handles errors from the entire method
      this.logger.error(`❌ Error in setupMarket method:`, error);
      
      // Re-throw known exceptions
      if (error instanceof BadRequestException || 
          error instanceof ConflictException || 
          error instanceof ForbiddenException) {
        throw error;
      }
      
      // For unknown errors, wrap in BadRequestException
      const errorMessage = error?.message || error?.toString() || 'Failed to create market. Please try again.';
      throw new BadRequestException(errorMessage);
    }
  }

  @Post('regenerate-pages')
  async regeneratePages(@Request() req: AuthenticatedRequest) {
    const tenantId = req.user?.tenantId || req.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    try {
      // Find tenant to get template and store type
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { templateId: true, id: true, storeType: true }
      });

      if (!tenant) {
        throw new NotFoundException('Tenant not found');
      }

      const isDigitalCardsStore = tenant.storeType === 'DIGITAL_CARDS';
      
      // If tenant has a template, regenerate pages from it
      if (tenant.templateId) {
        const template = await this.templateService.findOne(tenant.templateId);
        
        if (template.content && typeof template.content === 'object' && 'pages' in template.content && Array.isArray(template.content.pages)) {
          const templatePages = template.content.pages as any[];
          let createdCount = 0;
          let updatedCount = 0;
          
          for (const pageDef of templatePages) {
            try {
              let slug = (pageDef.slug || pageDef.id || '').replace(/^\//, '');
              if (!slug) continue;
              
              // Handle special routes like /account/inventory
              if (slug.startsWith('account/')) {
                slug = slug.replace(/^\//, '');
              }

              const existingPage = await this.pageService.findBySlug(tenantId, slug, true).catch(() => null);
              
              if (!existingPage) {
                await this.pageService.create(tenantId, {
                  title: pageDef.name || pageDef.nameAr || pageDef.nameEn || 'Untitled Page',
                  titleAr: pageDef.nameAr,
                  titleEn: pageDef.nameEn || pageDef.name,
                  slug: slug,
                  content: {
                    sections: pageDef.sections || []
                  },
                  isPublished: true,
                  seoTitle: pageDef.name || pageDef.nameAr || pageDef.nameEn,
                  seoTitleAr: pageDef.nameAr,
                  seoTitleEn: pageDef.nameEn || pageDef.name,
                });
                createdCount++;
                this.logger.log(`✅ Created page: ${slug}`);
              } else {
                // Update existing page to ensure it's published and has correct content
                await this.pageService.update(tenantId, existingPage.id, {
                  title: pageDef.name || pageDef.nameAr || pageDef.nameEn || existingPage.title,
                  titleAr: pageDef.nameAr || existingPage.titleAr,
                  titleEn: pageDef.nameEn || pageDef.name || existingPage.titleEn,
                  content: {
                    sections: pageDef.sections || []
                  },
                  isPublished: true,
                });
                updatedCount++;
                this.logger.log(`✅ Updated page: ${slug}`);
              }
            } catch (pageError: any) {
              this.logger.warn(`⚠️  Failed to process page ${pageDef.slug || pageDef.id}: ${pageError?.message || 'Unknown error'}`);
            }
          }
          
          // For digital cards stores, ensure inventory page exists
          if (isDigitalCardsStore) {
            try {
              const inventorySlug = 'account/inventory';
              const existingInventoryPage = await this.pageService.findBySlug(tenantId, inventorySlug, true).catch(() => null);
              
              if (!existingInventoryPage) {
                await this.pageService.create(tenantId, {
                  title: 'Inventory',
                  titleAr: 'المخزون',
                  titleEn: 'Inventory',
                  slug: inventorySlug,
                  content: {
                    sections: [
                      {
                        id: 'inventory-list',
                        type: 'inventory-page',
                        props: {
                          title: 'My Inventory',
                          titleAr: 'المخزون'
                        }
                      }
                    ]
                  },
                  isPublished: true,
                  seoTitle: 'Inventory',
                  seoTitleAr: 'المخزون',
                  seoTitleEn: 'Inventory',
                });
                createdCount++;
                this.logger.log(`✅ Created inventory page for digital cards store`);
              }
            } catch (inventoryError: any) {
              this.logger.warn(`⚠️  Failed to create inventory page: ${inventoryError?.message || 'Unknown error'}`);
            }
          }
          
          this.logger.log(`✅ Regenerated pages for tenant ${tenantId}: ${createdCount} created, ${updatedCount} updated`);
          return {
            success: true,
            message: `Pages regenerated successfully`,
            created: createdCount,
            updated: updatedCount,
            total: createdCount + updatedCount
          };
        }
      }

      // For all stores, ensure all 25 system pages exist
      const systemPages = [
        { slug: 'home', title: 'Home', titleAr: 'الرئيسية' },
        { slug: 'products', title: 'Products', titleAr: 'المنتجات' },
        { slug: 'categories', title: 'Categories', titleAr: 'الأقسام' },
        { slug: 'cart', title: 'Cart', titleAr: 'السلة' },
        { slug: 'checkout', title: 'Checkout', titleAr: 'إتمام الطلب' },
        { slug: 'login', title: 'Login', titleAr: 'تسجيل الدخول' },
        { slug: 'signup', title: 'Sign Up', titleAr: 'إنشاء حساب' },
        { slug: 'about', title: 'About Us', titleAr: 'من نحن' },
        { slug: 'contact', title: 'Contact Us', titleAr: 'تواصل معنا' },
        { slug: 'faqs', title: 'FAQs', titleAr: 'الأسئلة الشائعة' },
        { slug: 'privacy-policy', title: 'Privacy Policy', titleAr: 'سياسة الخصوصية' },
        { slug: 'terms', title: 'Terms & Conditions', titleAr: 'الشروط والأحكام' },
        { slug: 'support', title: 'Support', titleAr: 'الدعم الفني' },
        { slug: 'customer-orders', title: 'My Orders', titleAr: 'طلباتي' },
        { slug: 'employees', title: 'Employees', titleAr: 'الموظفين' },
        { slug: 'reports', title: 'Reports', titleAr: 'التقارير' },
        { slug: 'wallet', title: 'Wallet', titleAr: 'المحفظة' },
        { slug: 'wishlist', title: 'Wishlist', titleAr: 'المفضلة' },
        { slug: 'profile', title: 'Profile', titleAr: 'الملف الشخصي' },
        { slug: 'notifications', title: 'Notifications', titleAr: 'الإشعارات' },
        { slug: 'settings', title: 'Settings', titleAr: 'الإعدادات' },
        { slug: 'addresses', title: 'Addresses', titleAr: 'العناوين' },
        { slug: 'inventory', title: 'Inventory', titleAr: 'مخزوني' },
        { slug: 'charge-wallet', title: 'Charge Wallet', titleAr: 'شحن المحفظة' },
        { slug: 'balance-operations', title: 'Balance Operations', titleAr: 'عمليات الرصيد' },
      ];

      let createdCount = 0;
      let updatedCount = 0;

      for (const pageDef of systemPages) {
        try {
          const existingPage = await this.pageService.findBySlug(tenantId, pageDef.slug, true).catch(() => null);
          
          if (!existingPage) {
            await this.pageService.create(tenantId, {
              title: pageDef.titleAr,
              titleAr: pageDef.titleAr,
              titleEn: pageDef.title,
              slug: pageDef.slug,
              content: { sections: [{ type: 'text', props: { title: pageDef.titleAr, text: `Content for ${pageDef.title}` } }] },
              isPublished: true,
              seoTitle: pageDef.titleAr,
              seoTitleAr: pageDef.titleAr,
            });
            createdCount++;
          } else {
            // Ensure existing system pages are published
            if (!existingPage.isPublished) {
              await this.pageService.update(tenantId, existingPage.id, { isPublished: true });
              updatedCount++;
            }
          }
        } catch (err: any) {
          this.logger.warn(`⚠️ Failed to process page ${pageDef.slug}: ${err.message}`);
        }
      }

      return {
        success: true,
        message: `System pages processed successfully`,
        created: createdCount,
        updated: updatedCount,
        total: createdCount + updatedCount
      };

      // Only return error if it's not a digital cards store (digital cards stores are handled above)
      if (!isDigitalCardsStore) {
        return {
          success: false,
          message: 'No template found for this tenant',
          created: 0,
          updated: 0,
          total: 0
        };
      }
      
      // This should not be reached for digital cards stores, but just in case
      return {
        success: false,
        message: 'Failed to create pages',
        created: 0,
        updated: 0,
        total: 0
      };
    } catch (error: any) {
      this.logger.error('Failed to regenerate pages:', error);
      throw new BadRequestException(error?.message || 'Failed to regenerate pages');
    }
  }

  @Get('me')
  async getCurrentUserTenant(@Request() req: AuthenticatedRequest) {
    // Return null if user doesn't have a tenant yet
    if (!req.user?.id) {
      return null;
    }
    
    let tenantId: string | null = req.user.tenantId || null;
    if (!tenantId) {
       const fetchedTenantId = await this.tenantService.getTenantIdByUserId(req.user.id);
       if (!fetchedTenantId) {
         throw new Error('Tenant ID not found');
       }
       tenantId = fetchedTenantId;
    }

    if (!tenantId) {
        return null;
    }

    try {
      const tenant = await this.tenantService.getTenant(tenantId);
      return tenant;
    } catch (error) {
      // Return null if tenant not found (user hasn't set up their tenant yet)
      return null;
    }
  }

  @Post('update-me')
  async updateCurrentUserTenant(
    @Request() req: AuthenticatedRequest,
    @Body() body: { name?: string; nameAr?: string; description?: string; descriptionAr?: string; subdomain?: string }
  ) {
    if (!req.user?.id) {
      throw new BadRequestException('User not authenticated');
    }

    let tenantId: string | null = req.user.tenantId || null;
    
    // Fallback: fetch from DB if missing in token
    if (!tenantId) {
       tenantId = await this.tenantService.getTenantIdByUserId(req.user.id);
    }

    if (!tenantId) {
        throw new NotFoundException('Tenant not found for user');
    }

    // If subdomain is being updated, check availability
    if (body.subdomain) {
      // Validate format
      if (!/^[a-z0-9-]+$/.test(body.subdomain)) {
        throw new BadRequestException('Subdomain must contain only lowercase letters, numbers, and hyphens');
      }

      const isAvailable = await this.tenantService.checkSubdomainAvailability(body.subdomain, tenantId);
      if (!isAvailable) {
        // Check if it's the same tenant
        const existingTenant = await this.tenantService.getTenant(tenantId);
        if (existingTenant.subdomain !== body.subdomain) {
          // Generate suggestions
          const suggestions = await this.tenantService.suggestSubdomains(body.subdomain);
          
          // Return conflict data instead of throwing exception to avoid 401 issues
          return {
            status: 'conflict',
            message: `Subdomain "${body.subdomain}" is not available`,
            suggestions
          };
        }
      }
    }

    const updatedTenant = await this.tenantService.updateTenant(tenantId, body);

    // Ensure Home page exists (Self-healing for existing tenants)
    try {
        await this.pageService.findBySlug(tenantId, 'home');
    } catch (e) {
        // Create it if missing
        try {
            await this.pageService.create(tenantId, {
              title: 'Home',
              slug: 'home',
              content: JSON.stringify([
                {
                  id: 'hero',
                  type: 'hero',
                  content: {
                    title: `Welcome to ${updatedTenant.name}`,
                    subtitle: 'Discover our amazing products',
                    buttonText: 'Shop Now',
                    buttonLink: '/products'
                  }
                }
              ]),
              isPublished: true,
              seoTitle: updatedTenant.name,
              seoDesc: `Welcome to ${updatedTenant.name}`,
            });
        } catch (createError) {
             console.error('Failed to auto-create home page:', createError);
        }
    }

    return updatedTenant;
  }

  @Post('sync')
  async syncTenant(@Body() body: { tenantId: string; name?: string; subdomain?: string }) {
    await this.tenantSyncService.ensureTenantExists(body.tenantId, {
      name: body.name,
      subdomain: body.subdomain,
    });
    return { message: 'Tenant synchronized successfully' };
  }

  @Public()
  @Get('search')
  async search(@Query('q') query: string) {
    return this.tenantService.searchTenants(query);
  }

  @Get(':id')
  async getTenant(@Param('id') id: string) {
    return this.tenantService.getTenant(id);
  }

  @Delete(':id')
  async deleteTenant(
    @Request() req: AuthenticatedRequest,
    @Param('id') tenantId: string,
  ) {
    try {
      if (!req.user?.id) {
        throw new BadRequestException('User authentication required');
      }

      // Verify tenant exists locally first (optional check)
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true },
      });

      if (!tenant) {
        this.logger.warn(`Market ${tenantId} not found in core database during delete. Proceeding to ensure cleanup.`);
        // Don't throw NotFoundException yet, check auth service too
      } else {
        // Prevent deleting the currently active market
        if (tenantId === req.user.tenantId) {
            // Check if user has other markets to switch to? 
            // For now, strict block to prevent orphan state
            throw new BadRequestException('Cannot delete the currently active market. Please switch to another market first.');
        }
      }

      this.logger.log(`🗑️ Deleting tenant ${tenantId} by user ${req.user.id}`);

      // Get access token for auth service call
      const accessToken = req.headers.authorization?.replace('Bearer ', '') || '';
      
      if (!accessToken) {
        throw new BadRequestException('Authentication token required');
      }

      // Delete tenant from auth database first (this will check ownership and unlink from user)
      // The auth service will validate ownership, so we don't need to check it here
      try {
        await this.authClientService.deleteTenant(tenantId, accessToken);
        this.logger.log(`✅ Tenant ${tenantId} deleted from auth database`);
      } catch (error: any) {
        this.logger.error(`Failed to delete tenant from auth database:`, error);
        // If it's a permission error, pass it through
        if (error.message?.includes('permission') || error.message?.includes('Forbidden') || error.message?.includes('403')) {
          throw new ForbiddenException(error.message || 'You do not have permission to delete this market');
        }
        // If it's a not found error, ignore it (idempotent)
        if (error.message?.includes('not found') || error.message?.includes('404')) {
          this.logger.warn(`Market not found in auth database, assuming already deleted.`);
        } else if (error.message?.includes('Authentication failed') || error.message?.includes('401')) {
           // If it's an authentication error
          throw new BadRequestException('Authentication failed. Please refresh your session and try again.');
        } else {
          // Log but continue to ensure core cleanup
          this.logger.warn(`Failed to delete market from auth service, but continuing cleanup: ${error.message}`);
        }
      }

      // Delete tenant from core database (cascade will handle related data)
      try {
        await this.prisma.tenant.delete({
          where: { id: tenantId },
        });
        this.logger.log(`✅ Tenant ${tenantId} deleted from core database`);
      } catch (error: any) {
        this.logger.error(`Failed to delete tenant from core database:`, error);
        // If tenant was already deleted from auth but not from core, that's okay
        // But if it's a different error, throw it
        if (error.code === 'P2025' || error.message?.includes('Record to delete does not exist')) {
          this.logger.warn(`Tenant ${tenantId} was already deleted from core database`);
        } else {
          // If previous steps succeeded/were ignored, we shouldn't fail hard here if it's just DB/system error?
          // But strictness might be good.
          // For now, just warn and return success since goal is cleanup
           this.logger.warn(`Could not delete from core DB (might not exist): ${error.message}`);
        }
      }

      return { message: 'Market deleted successfully' };
    } catch (error: any) {
      // Re-throw known exceptions
      if (error instanceof BadRequestException || 
          error instanceof NotFoundException || 
          error instanceof ForbiddenException) {
        throw error;
      }
      
      // Log and wrap unknown errors
      this.logger.error(`Unexpected error deleting tenant ${tenantId}:`, error);
      throw new BadRequestException(`Failed to delete market: ${error.message || 'Unknown error'}`);
    }
  }

  // Add this endpoint to manually create tenants for testing
  @Post('create-test')
  async createTestTenant(@Body() body: { id: string; name: string; subdomain: string }) {
    try {
      await this.tenantSyncService.ensureTenantExists(body.id, {
        name: body.name,
        subdomain: body.subdomain,
      });
      return { message: 'Test tenant created successfully' };
    } catch (error) {
      return { error: error };
    }
  }

  private async createDefaultPages(tenantId: string, storeName: string, description: string) {
    const pages = [
      { slug: 'home', title: 'Home', titleAr: 'الرئيسية' },
      { slug: 'products', title: 'Products', titleAr: 'المنتجات' },
      { slug: 'categories', title: 'Categories', titleAr: 'الأقسام' },
      { slug: 'cart', title: 'Cart', titleAr: 'السلة' },
      { slug: 'checkout', title: 'Checkout', titleAr: 'إتمام الطلب' },
      { slug: 'login', title: 'Login', titleAr: 'تسجيل الدخول' },
      { slug: 'signup', title: 'Sign Up', titleAr: 'إنشاء حساب' },
      { slug: 'about', title: 'About Us', titleAr: 'من نحن' },
      { slug: 'contact', title: 'Contact Us', titleAr: 'تواصل معنا' },
      { slug: 'faqs', title: 'FAQs', titleAr: 'الأسئلة الشائعة' },
      { slug: 'privacy-policy', title: 'Privacy Policy', titleAr: 'سياسة الخصوصية' },
      { slug: 'terms', title: 'Terms & Conditions', titleAr: 'الشروط والأحكام' },
      { slug: 'support', title: 'Support', titleAr: 'الدعم الفني' },
      { slug: 'customer-orders', title: 'My Orders', titleAr: 'طلباتي' },
      { slug: 'employees', title: 'Employees', titleAr: 'الموظفين' },
      { slug: 'reports', title: 'Reports', titleAr: 'التقارير' },
      { slug: 'wallet', title: 'Wallet', titleAr: 'المحفظة' },
      { slug: 'wishlist', title: 'Wishlist', titleAr: 'المفضلة' },
      { slug: 'profile', title: 'Profile', titleAr: 'الملف الشخصي' },
      { slug: 'notifications', title: 'Notifications', titleAr: 'الإشعارات' },
      { slug: 'settings', title: 'Settings', titleAr: 'الإعدادات' },
      { slug: 'addresses', title: 'Addresses', titleAr: 'العناوين' },
      { slug: 'inventory', title: 'Inventory', titleAr: 'مخزوني' },
      { slug: 'charge-wallet', title: 'Charge Wallet', titleAr: 'شحن المحفظة' },
      { slug: 'balance-operations', title: 'Balance Operations', titleAr: 'عمليات الرصيد' },
    ];

    for (const page of pages) {
      try {
        const existingPage = await this.pageService.findBySlug(tenantId, page.slug, true).catch(() => null);
        if (!existingPage) {
          // Basic content structure based on type
          let sections: any[] = [];
          if (page.slug === 'home') {
            sections = [{ type: 'hero', props: { title: storeName, subtitle: description || 'Welcome to our store', buttonText: 'Shop Now', buttonLink: '/products' } }];
          } else if (page.slug === 'about') {
            sections = [{ type: 'about-section', props: { title: page.titleAr, subtitle: storeName, description: 'We provide quality products and services.' } }];
          } else if (page.slug === 'inventory') {
            sections = [{ type: 'inventory-section', props: { title: page.titleAr } }];
          } else {
            sections = [{ type: 'text', props: { title: page.titleAr, text: `This is the ${page.title} page.` } }];
          }

          await this.pageService.create(tenantId, {
            title: page.titleAr,
            titleAr: page.titleAr,
            titleEn: page.title,
            slug: page.slug,
            content: { sections },
            isPublished: true,
            seoTitle: `${page.titleAr} - ${storeName}`,
            seoTitleAr: page.titleAr,
            seoTitleEn: page.title,
          });
          this.logger.log(`✅ Auto-created page: ${page.slug} for tenant ${tenantId}`);
        }
      } catch (err) {
        this.logger.error(`❌ Failed to auto-create page ${page.slug}:`, err);
      }
    }
  }
}