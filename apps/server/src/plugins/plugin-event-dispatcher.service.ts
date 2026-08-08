import { Injectable } from '@nestjs/common';
import { GuildMember, Message } from 'discord.js';
import { AppLogger } from '../logger/logger.service';
import { PluginAccessService } from './plugin-access.service';

@Injectable()
export class PluginEventDispatcherService {
  constructor(
    private readonly access: PluginAccessService,
    private readonly logger: AppLogger,
  ) {}

  async onMessageCreate(message: Message) {
    if (!message.guild || message.author.bot) return;
    const plugins = await this.access.getActivePlugins(message.guild.id);
    const handlers = plugins.filter((plugin) => plugin.events?.onMessageCreate);
    const results = await Promise.allSettled(handlers.map((plugin) =>
      plugin.events!.onMessageCreate!(message, {
        guildId: message.guild!.id,
        channelId: message.channel.id,
        requestedById: message.author.id,
      }),
    ));
    this.logFailures(handlers, results, 'messageCreate');
  }

  async onGuildMemberUpdate(oldMember: GuildMember, newMember: GuildMember) {
    const plugins = await this.access.getActivePlugins(newMember.guild.id);
    const handlers = plugins.filter((plugin) => plugin.events?.onGuildMemberUpdate);
    const results = await Promise.allSettled(handlers.map((plugin) =>
      plugin.events!.onGuildMemberUpdate!(oldMember, newMember, {
        guildId: newMember.guild.id,
        channelId: newMember.guild.systemChannelId || newMember.guild.id,
        requestedById: newMember.id,
      }),
    ));
    this.logFailures(handlers, results, 'guildMemberUpdate');
  }

  private logFailures(
    plugins: Array<{ id: string }>,
    results: PromiseSettledResult<unknown>[],
    event: string,
  ) {
    results.forEach((result, index) => {
      if (result.status !== 'rejected') return;
      const error = result.reason as any;
      this.logger.error(
        `Plugin ${plugins[index].id} ${event} handler failed: ${error?.message ?? error}`,
        error?.stack,
        'PluginEvents',
      );
    });
  }
}
