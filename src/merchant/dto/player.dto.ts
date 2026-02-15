import { IsString, IsOptional, IsBoolean, IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export class GameAccountDto {
  @IsString()
  gameKey!: string;

  @IsString()
  accountIdentifier!: string;

  @IsOptional()
  @IsString()
  label?: string;
}

export class CreatePlayerDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GameAccountDto)
  accounts?: GameAccountDto[];
}

export class UpdatePlayerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;
}

export class AddGameAccountDto {
  @IsString()
  gameKey!: string;

  @IsString()
  accountIdentifier!: string;

  @IsOptional()
  @IsString()
  label?: string;
}

export class PlayerListQuery {
  @IsOptional()
  @IsString()
  q?: string; // name/phone search

  @IsOptional()
  @IsBoolean()
  favorite?: boolean;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  limit?: number;
}

export class PlayerSummaryResponse {
  id!: string;
  name!: string;
  phone?: string;
  notes?: string;
  isFavorite!: boolean;
  accountsCount!: number;
  lastOrderAt?: Date;
  createdAt!: Date;
}

export class PlayerDetailResponse extends PlayerSummaryResponse {
  accounts!: GameAccountResponse[];
  ordersCount!: number;
  totalSpent!: number;
}

export class GameAccountResponse {
  id!: string;
  gameKey!: string;
  accountIdentifier!: string;
  label?: string;
  createdAt!: Date;
}
