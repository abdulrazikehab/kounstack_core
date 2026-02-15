
import { 
  Controller, 
  Post, 
  Get, 
  UseInterceptors, 
  UploadedFile, 
  Res, 
  UseGuards, 
  Request,
  BadRequestException
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ExcelImportService } from './excel-import.service';
import { ExcelExportService } from './excel-export.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Response } from 'express';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class ImportExportController {
  constructor(
    private readonly importService: ExcelImportService,
    private readonly exportService: ExcelExportService,
  ) {}

  @Post('import/excel')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const tenantId = req.user.tenantId; // Or req.tenantId
    // Ensure tenantId exists
    if (!tenantId) throw new BadRequestException('Tenant context required');
    
    return this.importService.importExcel(file.buffer, tenantId, file.originalname);
  }

  @Get('export/excel')
  async exportExcel(@Request() req, @Res() res: Response) {
    const tenantId = req.user.tenantId;
    if (!tenantId) throw new BadRequestException('Tenant context required');

    const buffer = await this.exportService.exportExcel(tenantId);

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="catalog_export.xlsx"',
      'Content-Length': buffer.length,
    });

    res.send(buffer);
  }
}
