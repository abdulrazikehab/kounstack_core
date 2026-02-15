import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../prisma/prisma.module';
import { CardsModule } from '../cards/cards.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { UserModule } from '../user/user.module';

// Services
import { MerchantService } from './services/merchant.service';
import { EmployeeService } from './services/employee.service';
import { PlayerService } from './services/player.service';
import { MerchantCartService } from './services/merchant-cart.service';
import { MerchantOrderService } from './services/merchant-order.service';
import { MerchantFavoritesService } from './services/merchant-favorites.service';
import { PromotionService } from './services/promotion.service';
import { PriceAlertService } from './services/price-alert.service';
import { MerchantNotificationService } from './services/merchant-notification.service';
import { InvoiceService } from './services/invoice.service';
import { MerchantReportService } from './services/merchant-report.service';
import { MerchantSessionService } from './services/merchant-session.service';
import { MerchantAuditService } from './services/merchant-audit.service';
import { MerchantSyncService } from './services/merchant-sync.service';
import { MerchantSearchService } from './services/merchant-search.service';

// Controllers
import { MerchantAuthController } from './controllers/merchant-auth.controller';
import { MerchantProfileController } from './controllers/merchant-profile.controller';
import { EmployeeController } from './controllers/employee.controller';
import { PlayerController } from './controllers/player.controller';
import { MerchantCartController } from './controllers/merchant-cart.controller';
import { MerchantOrderController } from './controllers/merchant-order.controller';
import { MerchantProductController } from './controllers/merchant-product.controller';
import { MerchantFavoritesController } from './controllers/merchant-favorites.controller';
import { PromotionController } from './controllers/promotion.controller';
import { PriceAlertController } from './controllers/price-alert.controller';
import { MerchantNotificationController } from './controllers/merchant-notification.controller';
import { InvoiceController } from './controllers/invoice.controller';
import { MerchantDashboardController } from './controllers/merchant-dashboard.controller';
import { MerchantSessionController } from './controllers/merchant-session.controller';
import { MerchantWalletController } from './controllers/merchant-wallet.controller';
import { MerchantEmployeesController } from './controllers/merchant-employees.controller';
import { MerchantSyncController } from './controllers/merchant-sync.controller';
import { MerchantSearchController } from './controllers/merchant-search.controller';

@Module({
  imports: [PrismaModule, CardsModule, CloudinaryModule, UserModule, HttpModule],
  controllers: [
    MerchantAuthController,
    MerchantProfileController,
    EmployeeController,
    PlayerController,
    MerchantCartController,
    MerchantOrderController,
    MerchantProductController,
    MerchantFavoritesController,
    PromotionController,
    PriceAlertController,
    MerchantNotificationController,
    InvoiceController,
    MerchantDashboardController,
    MerchantSessionController,
    MerchantWalletController,
    MerchantEmployeesController,
    MerchantSyncController,
    MerchantSearchController,
  ],
  providers: [
    MerchantService,
    EmployeeService,
    PlayerService,
    MerchantCartService,
    MerchantOrderService,
    MerchantFavoritesService,
    PromotionService,
    PriceAlertService,
    MerchantNotificationService,
    InvoiceService,
    MerchantReportService,
    MerchantSessionService,
    MerchantAuditService,
    MerchantSyncService,
    MerchantSearchService,
  ],
  exports: [
    MerchantService,
    EmployeeService,
    PlayerService,
    MerchantCartService,
    MerchantOrderService,
    MerchantFavoritesService,
    PromotionService,
    PriceAlertService,
    MerchantNotificationService,
    InvoiceService,
    MerchantReportService,
    MerchantSessionService,
    MerchantAuditService,
    MerchantSyncService,
    MerchantSearchService,
  ],
})
export class MerchantModule {}

