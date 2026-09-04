import { Controller, Get } from '@nestjs/common';
import { providerCatalog } from '@gtmai/providers';

@Controller('providers')
export class ProvidersController {
  @Get('catalog')
  catalog() {
    return providerCatalog.map((item) => ({
      provider: item.provider,
      id: item.id,
      name: item.name,
      category: item.category,
      creditCost: item.creditCost,
      badges: item.badges,
    }));
  }
}
