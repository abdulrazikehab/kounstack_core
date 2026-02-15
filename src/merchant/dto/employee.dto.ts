import { IsString, IsOptional, IsBoolean, IsObject, MinLength, IsEnum, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// Define EmployeePermissions first since it's used by other classes
export class EmployeePermissions {
  // Orders permissions
  @IsOptional()
  @IsBoolean()
  ordersCreate?: boolean;

  @IsOptional()
  @IsBoolean()
  ordersRead?: boolean;

  @IsOptional()
  @IsBoolean()
  ordersUpdate?: boolean;

  @IsOptional()
  @IsBoolean()
  ordersDelete?: boolean;

  // Reports permissions
  @IsOptional()
  @IsBoolean()
  reportsRead?: boolean;

  // Wallet permissions
  @IsOptional()
  @IsBoolean()
  walletRead?: boolean;

  @IsOptional()
  @IsBoolean()
  walletRecharge?: boolean;

  // Players permissions
  @IsOptional()
  @IsBoolean()
  playersWrite?: boolean;

  @IsOptional()
  @IsBoolean()
  playersRead?: boolean;

  // Employees permissions
  @IsOptional()
  @IsBoolean()
  employeesManage?: boolean;

  @IsOptional()
  @IsBoolean()
  employeesRead?: boolean;

  // Settings permissions
  @IsOptional()
  @IsBoolean()
  settingsWrite?: boolean;

  @IsOptional()
  @IsBoolean()
  settingsRead?: boolean;

  // Invoices permissions
  @IsOptional()
  @IsBoolean()
  invoicesRead?: boolean;

  // Products permissions
  @IsOptional()
  @IsBoolean()
  productsRead?: boolean;

  @IsOptional()
  @IsBoolean()
  productsWrite?: boolean;
}

export class CreateEmployeeDto {
  @IsString()
  name!: string;

  @IsString()
  @MinLength(3)
  username!: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string; // Optional - will be auto-generated if not provided

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  permissions?: any; // Allow any object structure for permissions

  // Allow groupId from frontend but don't validate it (it's used client-side only)
  @IsOptional()
  groupId?: string;
  
  // Allow email field as well (frontend might send email instead of username)
  @IsOptional()
  @IsString()
  email?: string;
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEnum(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';

  @IsOptional()
  @IsObject()
  permissions?: EmployeePermissions;
}

export class EmployeeListQuery {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  q?: string;
}

export class EmployeeResponse {
  id!: string;
  name!: string;
  username!: string;
  phone?: string;
  status!: string;
  permissions!: EmployeePermissions;
  createdAt!: Date;
  updatedAt!: Date;
}
