import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

export class ChatMessageDto {
  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsObject()
  @IsOptional()
  context?: {
    currentPage?: string;
    currentSection?: string;
    userAction?: string;
  };
}
