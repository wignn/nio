import { SlashCommandBuilder } from 'discord.js';
import { NioPlugin } from '../nio-plugin.interface';
import { KineticHostingService } from './kinetic-hosting.service';

function guildId(interaction: { guildId: string | null }) {
  if (!interaction.guildId) throw new Error('Kinetic Hosting commands are only available in a server');
  return interaction.guildId;
}

export const createKineticHostingPlugin = (service: KineticHostingService): NioPlugin => ({
  id: 'kinetic-hosting',
  version: '1.0.0',
  name: 'Kinetic Hosting',
  description: 'Read-only Kinetic Panel server visibility for Discord and nio.',
  type: 'FREE',
  commands: [
    {
      name: 'kinetic-servers',
      data: new SlashCommandBuilder().setName('kinetic-servers').setDescription('List your Kinetic Hosting servers').setDMPermission(false).toJSON(),
      execute: async (interaction) => {
        await interaction.reply({ content: `\`\`\`json\n${service.limit(await service.listServers(guildId(interaction)))}\n\`\`\``, ephemeral: true });
      },
    },
    {
      name: 'kinetic-status',
      data: new SlashCommandBuilder().setName('kinetic-status').setDescription('Show Kinetic server status').addStringOption((option) => option.setName('server').setDescription('Server identifier').setRequired(true)).setDMPermission(false).toJSON(),
      execute: async (interaction) => {
        await interaction.reply({ content: `\`\`\`json\n${service.limit(await service.serverStatus(guildId(interaction), interaction.options.getString('server', true)))}\n\`\`\``, ephemeral: true });
      },
    },
    {
      name: 'kinetic-players',
      data: new SlashCommandBuilder().setName('kinetic-players').setDescription('List online Kinetic server players').addStringOption((option) => option.setName('server').setDescription('Server identifier').setRequired(true)).setDMPermission(false).toJSON(),
      execute: async (interaction) => {
        await interaction.reply({ content: `\`\`\`json\n${service.limit(await service.onlinePlayers(guildId(interaction), interaction.options.getString('server', true)))}\n\`\`\``, ephemeral: true });
      },
    },
  ],
  tools: [
    {
      name: 'kinetic_list_servers',
      pluginId: 'kinetic-hosting',
      description: 'List Kinetic Hosting servers accessible to the operator.',
      parameters: { type: 'OBJECT', properties: {} },
      execute: async (_args, context) => service.listServers(context.guildId),
    },
    {
      name: 'kinetic_server_status',
      pluginId: 'kinetic-hosting',
      description: 'Read Kinetic Hosting server details and current resource utilization.',
      parameters: { type: 'OBJECT', properties: { server: { type: 'STRING', description: 'Kinetic server identifier' } }, required: ['server'] },
      execute: async (args: any, context) => service.serverStatus(context.guildId, args?.server),
    },
    {
      name: 'kinetic_online_players',
      pluginId: 'kinetic-hosting',
      description: 'List online players on a Kinetic Hosting server.',
      parameters: { type: 'OBJECT', properties: { server: { type: 'STRING', description: 'Kinetic server identifier' } }, required: ['server'] },
      execute: async (args: any, context) => service.onlinePlayers(context.guildId, args?.server),
    },
  ],
});
