import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PluginService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.plugin.findMany({
      where: { tenantId },
    });
  }

  async findOne(tenantId: string, id: string) {
    const plugin = await this.prisma.plugin.findFirst({
      where: { id, tenantId },
    });

    if (!plugin) {
      throw new NotFoundException(`Plugin with ID ${id} not found`);
    }

    return plugin;
  }

  async create(tenantId: string, data: any) {
    return this.prisma.plugin.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }

  async update(tenantId: string, id: string, data: any) {
    await this.findOne(tenantId, id);
    return this.prisma.plugin.update({
      where: { id },
      data,
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.plugin.delete({
      where: { id },
    });
  }

  async toggle(tenantId: string, id: string) {
    const plugin = await this.findOne(tenantId, id);
    return this.prisma.plugin.update({
      where: { id },
      data: { isActive: !plugin.isActive },
    });
  }
}
