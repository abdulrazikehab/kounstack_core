
import { Module } from '@nestjs/common';
import { ExcelImportService } from './excel-import.service';
import { ExcelExportService } from './excel-export.service';
import { CatalogService } from './catalog.service';
import { ImportExportController } from './import-export.controller';
import { CatalogController } from './catalog.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ImportExportController, CatalogController],
  providers: [ExcelImportService, ExcelExportService, CatalogService],
})
export class ImportExportModule {}
