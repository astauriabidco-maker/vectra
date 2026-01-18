import { IsEmail, IsString, IsOptional, IsArray } from 'class-validator';

export class CreateCustomerDto {
    @IsString()
    workspaceId: string;  // Required - Multi-tenancy

    @IsString()
    phone: string;  // Required - Phone-First CRM

    @IsOptional()
    @IsEmail()
    email?: string;  // Optional

    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    company?: string;

    @IsOptional()
    @IsString()
    notes?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tags?: string[];
}

