import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CredentialEncryptionService } from '../credential-encryption.service';
import { KineticHostingService } from './kinetic-hosting.service';

@Module({
  imports: [PrismaModule],
  providers: [CredentialEncryptionService, KineticHostingService],
  exports: [KineticHostingService],
})
export class KineticHostingModule {}
