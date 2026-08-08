import { Injectable } from '@nestjs/common';
import { Interaction } from 'discord.js';
import { SelfRolesService } from '../self-roles/self-roles.service';
import { AgentActionProposalService } from '../discord-agent/agent-action-proposal.service';
import { AgentActionRendererService } from '../discord-agent/agent-action-renderer.service';
import { CommandRegistryService } from '../plugins/command-registry.service';
import { PluginAccessService } from '../plugins/plugin-access.service';

@Injectable()
export class DiscordInteractionService {
  constructor(
    private readonly selfRoles: SelfRolesService,
    private readonly agentProposals: AgentActionProposalService,
    private readonly agentActionRenderer: AgentActionRendererService,
    private readonly commandRegistry: CommandRegistryService,
    private readonly pluginAccess: PluginAccessService,
  ) {}

  async handle(interaction: Interaction) {
    if (interaction.isChatInputCommand()) {
      const command = this.commandRegistry.get(interaction.commandName);
      if (!command) return;
      if (command.pluginId) {
        if (!interaction.guildId || !await this.pluginAccess.canUse(interaction.guildId, command.pluginId)) {
          await interaction.reply({ content: 'Plugin belum terpasang atau entitlement-nya sudah kedaluwarsa.', ephemeral: true });
          return;
        }
      }
      await command.execute(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('agent:')) {
      const [, action, proposalId] = interaction.customId.split(':');
      try {
        const result = action === 'approve'
          ? await this.agentProposals.approveAndExecute(proposalId, interaction.user.id)
          : await this.agentProposals.cancelProposal(proposalId, interaction.user.id);
        await interaction.update(await this.agentActionRenderer.renderExecutionResult(
          action === 'approve' ? 'Proposal Executed' : 'Proposal Cancelled',
          result.message,
          interaction.guildId || undefined,
        ));
      } catch (err: any) {
        console.error('Agent interaction handling error:', err);
        await interaction.reply({
          content: err?.message || 'Failed to process proposal.',
          ephemeral: true,
          allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
        });
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('sr:')) {
      const [, panelId, roleId] = interaction.customId.split(':');
      await this.selfRoles.toggleFromInteraction(interaction, panelId, roleId);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('sr-menu:')) {
      const [, panelId] = interaction.customId.split(':');
      await this.selfRoles.toggleFromInteraction(interaction, panelId, interaction.values[0]);
    }
  }
}
