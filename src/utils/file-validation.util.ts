import { BadRequestException } from '@nestjs/common';

export function validateImageSignature(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 12) {
    return false;
  }

  const header = buffer.toString('hex', 0, 12).toUpperCase();

  // JPEG: FF D8 FF
  if (header.startsWith('FFD8FF')) {
    return true;
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (header.startsWith('89504E470D0A1A0A')) {
    return true;
  }
  // GIF: 47 49 46 38
  if (header.startsWith('47494638')) {
    return true;
  }
  // WEBP: RIFF....WEBP -> 52 49 46 46 ... 57 45 42 50
  // Offset 0: 52 49 46 46 (RIFF)
  // Offset 8: 57 45 42 50 (WEBP)
  if (header.startsWith('52494646') && header.substring(16, 24) === '57454250') {
    return true;
  }

  return false;
}

export function validateFileSafety(file: Express.Multer.File): void {
  if (!validateImageSignature(file.buffer)) {
    throw new BadRequestException('Unsafe file: File rejected for security reasons (invalid file signature)');
  }
}
