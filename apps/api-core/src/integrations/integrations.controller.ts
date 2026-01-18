import { Controller, Get, Put, Param, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { IntegrationsService, IntegrationCredentials } from './integrations.service';

interface UpdateIntegrationDto {
    enabled?: boolean;
    credentials?: IntegrationCredentials;
}

@Controller('integrations')
export class IntegrationsController {
    constructor(private readonly integrationsService: IntegrationsService) { }

    @Get()
    async getAll(@Query('workspaceId') workspaceId: string) {
        return this.integrationsService.getAllIntegrations(workspaceId);
    }

    @Get(':provider')
    async getOne(
        @Query('workspaceId') workspaceId: string,
        @Param('provider') provider: string,
    ) {
        return this.integrationsService.getIntegrationMasked(workspaceId, provider);
    }

    @Put(':provider')
    @HttpCode(HttpStatus.OK)
    async update(
        @Query('workspaceId') workspaceId: string,
        @Param('provider') provider: string,
        @Body() body: UpdateIntegrationDto,
    ) {
        return this.integrationsService.saveIntegration(workspaceId, provider, body);
    }
}
