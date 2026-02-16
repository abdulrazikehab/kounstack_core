
import { Module } from '@nestjs/common';
import { ExcelImportService } from './excel-import.service';
import { ExcelExportService } from './excel-export.service';
import { CatalogService } from './catalog.service';
import { ImportExportController } from './import-export.controller';
import { CatalogController } from './catalog.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ImportExportController, CatalogController],
  providers: [ExcelImportService, ExcelExportService, CatalogService],
})
export class ImportExportModule {}
