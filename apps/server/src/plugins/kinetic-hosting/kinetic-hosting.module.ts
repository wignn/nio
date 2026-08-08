import { Module } from '@nestjs/common';
import { KineticHostingService } from './kinetic-hosting.service';

@Module({
  providers: [KineticHostingService],
  exports: [KineticHostingService],
})
export class KineticHostingModule {}
