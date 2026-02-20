import { BadRequestException } from '@nestjs/common';

export function validateImageSignature(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 6) {
    return false;
  }

  // Read at least 12 bytes for most formats, but we can check GIF with just 6 bytes
  const readLength = Math.min(buffer.length, 12);
  const header = buffer.toString('hex', 0, readLength).toUpperCase();

  // JPEG: FF D8 FF (needs at least 3 bytes)
  if (buffer.length >= 3 && header.startsWith('FFD8FF')) {
    return true;
  }
  
  // PNG: 89 50 4E 47 0D 0A 1A 0A (needs at least 8 bytes)
  if (buffer.length >= 8 && header.startsWith('89504E470D0A1A0A')) {
    return true;
  }
  
  // GIF: 47 49 46 38 37 61 (GIF87a) or 47 49 46 38 39 61 (GIF89a)
  // Both start with 47 49 46 38 (GIF8) - needs at least 4 bytes
  if (buffer.length >= 4) {
    const gifHeader = buffer.toString('hex', 0, Math.min(6, buffer.length)).toUpperCase();
    // Check for GIF8 prefix (covers both GIF87a and GIF89a)
    if (gifHeader.startsWith('47494638')) {
      return true;
    }
  }
  
  // WEBP: RIFF....WEBP -> 52 49 46 46 ... 57 45 42 50
  // Offset 0: 52 49 46 46 (RIFF)
  // Offset 8: 57 45 42 50 (WEBP) - needs at least 12 bytes
  if (buffer.length >= 12 && header.startsWith('52494646') && header.length >= 24 && header.substring(16, 24) === '57454250') {
    return true;
  }

  return false;
}

export function validateFileSafety(file: Express.Multer.File): void {
  if (!file.buffer || file.buffer.length === 0) {
    throw new BadRequestException('Empty file: File is empty or could not be read');
  }
  
  if (!validateImageSignature(file.buffer)) {
    const mimetype = file.mimetype || 'unknown';
    throw new BadRequestException(
      `Invalid file signature: The file does not match its declared type (${mimetype}). ` +
      `Please ensure you are uploading a valid image file (JPEG, PNG, WEBP, or GIF).`
    );
  }
}
