import { BadRequestException } from '@nestjs/common';

export function validateFileSignature(buffer: Buffer, mimetype: string): void {
  if (!buffer || buffer.length === 0) {
    throw new BadRequestException('Empty file');
  }

  const hex = buffer.toString('hex', 0, 8).toUpperCase();
  
  let valid = false;

  // JPEG: FF D8 FF
  if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') {
    valid = hex.startsWith('FFD8FF');
  }
  // PNG: 89 50 4E 47
  else if (mimetype === 'image/png') {
    valid = hex.startsWith('89504E47');
  }
  // PDF: %PDF (25 50 44 46)
  else if (mimetype === 'application/pdf') {
    valid = hex.startsWith('25504446');
  }
  
  if (!valid) {
    throw new BadRequestException(`Invalid file content for type ${mimetype}`);
  }
}
