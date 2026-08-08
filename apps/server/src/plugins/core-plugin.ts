import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { NioPlugin } from './nio-plugin.interface';

const execute = async () => undefined;

// Core metadata is registered here; CommandRegistryService binds the Nest-backed runtime handler.

export const CORE_PLUGIN: NioPlugin = {
  id: 'core',
  version: '1.0.0',
  name: 'nio core',
  description: 'Built-in nio commands',
  type: 'FREE',
  commands: [
    new SlashCommandBuilder().setName('dashboard').setDescription('Open the nio dashboard').toJSON(),
    new SlashCommandBuilder().setName('booster-role').setDescription('Create or edit your custom booster role').setDMPermission(false).toJSON(),
    new SlashCommandBuilder().setName('donate-role').setDescription('Get private checkout link to donate and receive your reward role').setDMPermission(false).toJSON(),
    new SlashCommandBuilder().setName('warn').setDescription('Issue a warning to a member')
      .addUserOption((option) => option.setName('user').setDescription('The member to warn').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('The reason for warning').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers | PermissionFlagsBits.BanMembers | PermissionFlagsBits.Administrator)
      .setDMPermission(false).toJSON(),
    new SlashCommandBuilder().setName('warnings').setDescription('List warnings of a member')
      .addUserOption((option) => option.setName('user').setDescription('The member to check').setRequired(true)).toJSON(),
    new SlashCommandBuilder().setName('unwarn').setDescription('Revoke a warning by ID')
      .addStringOption((option) => option.setName('id').setDescription('The warning ID').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers | PermissionFlagsBits.BanMembers | PermissionFlagsBits.Administrator)
      .setDMPermission(false).toJSON(),
  ].map((data) => ({ name: data.name, data, execute })),
};
