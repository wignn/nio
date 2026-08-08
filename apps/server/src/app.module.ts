import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { DiscordModule } from './discord/discord.module';
import { GuildsModule } from './guilds/guilds.module';
import { LoggerModule } from './logger/logger.module';
import { PanelsModule } from './panels/panels.module';
import { PrismaModule } from './prisma/prisma.module';
import { R2Module } from './r2/r2.module';
import { SelfRolesModule } from './self-roles/self-roles.module';
import { StickersModule } from './stickers/stickers.module';
import { ModerationModule } from './moderation/moderation.module';
import { BoosterRoleModule } from './booster-role/booster-role.module';
import { TakoModule } from './tako/tako.module';
import { DiscordAgentModule } from './discord-agent/discord-agent.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { EmbedTemplateModule } from './embed-templates/embed-template.module';
import { PluginsModule } from './plugins/plugins.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule,
    PrismaModule,
    R2Module,
    AuthModule,
    DiscordModule,
    GuildsModule,
    PanelsModule,
    SelfRolesModule,
    StickersModule,
    ModerationModule,
    BoosterRoleModule,
    TakoModule,
    DiscordAgentModule,
    LeaderboardModule,
    EmbedTemplateModule,
    PluginsModule,
  ],
})
export class AppModule {}
