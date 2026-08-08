import { APIApplicationCommandData, ChatInputCommandInteraction, GuildMember, Message } from 'discord.js';

export type NioPluginType = 'FREE' | 'PREMIUM';

export interface NioPluginContext {
  readonly guildId: string;
  readonly channelId: string;
  readonly requestedById: string;
}

export interface NioAgentTool {
  readonly name: string;
  readonly pluginId: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly execute: (args: unknown, context: NioPluginContext) => Promise<unknown>;
}

export interface NioCommand {
  readonly name: string;
  readonly pluginId?: string;
  readonly data: APIApplicationCommandData;
  readonly execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export interface NioPluginEvents {
  readonly onMessageCreate?: (message: Message, context: NioPluginContext) => Promise<void>;
  readonly onGuildMemberUpdate?: (oldMember: GuildMember, newMember: GuildMember, context: NioPluginContext) => Promise<void>;
}

export interface NioPlugin {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly description: string;
  readonly type: NioPluginType;
  readonly commands: readonly NioCommand[];
  readonly tools?: readonly NioAgentTool[];
  readonly events?: NioPluginEvents;
}
