import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto';

@Injectable()
export class CustomersService {
    constructor(private readonly prisma: PrismaService) { }

    async create(createCustomerDto: CreateCustomerDto) {
        return this.prisma.customer.create({
            data: createCustomerDto,
        });
    }

    /**
     * Find all customers scoped to a specific workspace
     */
    async findAll(workspaceId: string) {
        return this.prisma.customer.findMany({
            where: { workspaceId },
            orderBy: { createdAt: 'desc' },
            include: {
                tickets: true,
                workspace: {
                    include: { tenantOrg: true }
                }
            },
        });
    }

    async findOne(id: string) {
        const customer = await this.prisma.customer.findUnique({
            where: { id },
            include: {
                tickets: true,
                workspace: {
                    include: { tenantOrg: true }
                }
            },
        });

        if (!customer) {
            throw new NotFoundException(`Customer with ID ${id} not found`);
        }

        return customer;
    }

    async update(id: string, updateCustomerDto: UpdateCustomerDto) {
        await this.findOne(id); // Ensure customer exists

        return this.prisma.customer.update({
            where: { id },
            data: updateCustomerDto,
        });
    }

    async remove(id: string) {
        await this.findOne(id); // Ensure customer exists

        return this.prisma.customer.delete({
            where: { id },
        });
    }
}
