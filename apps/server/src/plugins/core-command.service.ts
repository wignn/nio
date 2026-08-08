import { Injectable, Optional } from '@nestjs/common';
import { ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { BoosterRoleService } from '../booster-role/booster-role.service';
import { EmbedTemplateRendererService } from '../embed-templates/embed-template-renderer.service';
import { EmbedTemplateService } from '../embed-templates/embed-template.service';
import { ModerationService } from '../moderation/moderation.service';
import { TakoService } from '../tako/tako.service';

@Injectable()
export class CoreCommandService {
  constructor(
    private readonly moderation: ModerationService,
    private readonly boosterRoles: BoosterRoleService,
    private readonly tako: TakoService,
    @Optional() private readonly embedTemplates?: EmbedTemplateService,
    @Optional() private readonly embedRenderer?: EmbedTemplateRendererService,
  ) {}

  async execute(name: string, interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId;
    if (name === 'dashboard') {
      const url = process.env.FRONTEND_URL || 'http://localhost:3000';
      await interaction.reply({ content: `✦ Open nio dashboard: ${url}`, ephemeral: true });
      return;
    }
    if (!guildId) return;

    if (name === 'booster-role') {
      try {
        const claim = await this.boosterRoles.generateToken(guildId, interaction.user.id);
        const url = process.env.FRONTEND_URL || 'http://localhost:3000';
        await interaction.reply({
          embeds: [this.buildStatusEmbed('Custom Booster Role', `Open this private link to create or edit your custom booster role:\n${url}/booster-role?guildId=${guildId}&token=${claim.token}`)],
          ephemeral: true,
        });
      } catch (err: any) {
        await interaction.reply({ embeds: [this.buildStatusEmbed('Booster Role Unavailable', err?.message || 'Only active server boosters can use this feature.')], ephemeral: true });
      }
      return;
    }

    if (name === 'donate-role') {
      try {
        const settings = await this.tako.getSettings(guildId);
        if (!settings.enabled || !settings.rewardRoleId) {
          await interaction.reply({ embeds: [this.buildStatusEmbed('Donation Unavailable', 'Tako donation rewards are not enabled on this server.')], ephemeral: true });
          return;
        }
        const url = process.env.FRONTEND_URL || 'http://localhost:3000';
        const minFormatted = settings.minimumAmount.toLocaleString('id-ID');
        const userId = interaction.user.id;
        const username = encodeURIComponent(interaction.user.username);
        await interaction.reply({ embeds: [this.buildStatusEmbed('Tako Donation Reward', `Donate minimal **Rp${minFormatted}** via Tako to automatically receive the <@&${settings.rewardRoleId}> role!\n\n✦ [Click here to open donation page](${url}/donate?guildId=${guildId}&userId=${userId}&username=${username})`)] });
      } catch (err: any) {
        await interaction.reply({ embeds: [this.buildStatusEmbed('Error', err?.message || 'Failed to process donation request.')], ephemeral: true });
      }
      return;
    }

    if (name === 'warn') {
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason', true);
      if (!interaction.memberPermissions?.has([PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.Administrator])) {
        await interaction.reply({ embeds: [this.buildStatusEmbed('Permission Required', 'You need moderation permissions to run this command.')], ephemeral: true });
        return;
      }
      const settings = await this.moderation.getSettings(guildId);
      const warning = await this.moderation.createWarning(guildId, user.id, interaction.user.id, reason);
      const activeCount = await this.moderation.countActiveWarnings(guildId, user.id);
      let timeoutApplied = false;
      let timeoutError = '';
      if (settings.warnLimitEnabled && activeCount >= settings.warnLimitThreshold) {
        try {
          const member = await interaction.guild?.members.fetch(user.id);
          if (member) {
            await member.timeout(settings.warnTimeoutDurationMin * 60 * 1000, `Warnings threshold reached (${activeCount}/${settings.warnLimitThreshold})`);
            timeoutApplied = true;
          }
        } catch (err: any) {
          timeoutError = err.message;
        }
      }
      const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle('Warning Issued')
        .setDescription(`A warning has been recorded for <@${user.id}>.`)
        .addFields(
          { name: 'Member', value: `<@${user.id}> (${user.username})`, inline: true },
          { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Active Warnings', value: `${activeCount}`, inline: true },
          { name: 'Reason', value: reason },
        )
        .setFooter({ text: `Warning ID: ${warning.id}` })
        .setTimestamp();
      if (timeoutApplied) embed.addFields({ name: 'Auto Penalty', value: `Muted (Timeout) for ${settings.warnTimeoutDurationMin} minutes.` });
      else if (timeoutError) embed.addFields({ name: 'Auto Penalty Status', value: `Failed to timeout: ${timeoutError}` });
      const rendered = await this.renderModeration('MODERATION_WARNING', guildId, {
        'moderation.title': 'Warning Issued',
        'moderation.description': `A warning has been recorded for <@${user.id}>.`,
        'moderation.reason': reason,
        'moderator.mention': `<@${interaction.user.id}>`,
        'target.mention': `<@${user.id}>`,
        'user.mention': `<@${user.id}>`,
        'user.username': user.username,
        'guild.name': interaction.guild?.name || '',
      });
      await interaction.reply(rendered || { embeds: [embed] });
      return;
    }

    if (name === 'warnings') {
      const user = interaction.options.getUser('user', true);
      const activeCount = await this.moderation.countActiveWarnings(guildId, user.id);
      const warnings = await this.moderation.listWarnings(guildId, { search: user.id });
      const embed = new EmbedBuilder().setColor(0x2b2d31).setTitle(`Warnings Status: ${user.username}`).setThumbnail(user.displayAvatarURL()).addFields(
        { name: 'Active Warnings', value: `${activeCount}`, inline: true },
        { name: 'Total Violations', value: `${warnings.length}`, inline: true },
      );
      if (warnings.length > 0) {
        const warnList = warnings.slice(0, 5).map((w) => `\`${w.id}\` - ${w.reason} (Issued on ${new Date(w.createdAt).toLocaleDateString(undefined, { dateStyle: 'short' })})`).join('\n');
        embed.addFields({ name: 'Recent Warning Logs', value: warnList });
        if (warnings.length > 5) embed.setFooter({ text: `Showing 5 of ${warnings.length} total warnings. Manage details via nio dashboard.` });
      } else embed.setDescription('This member has a clean record on this server.');
      const rendered = await this.renderModeration('MODERATION_STATUS', guildId, {
        'moderation.title': `Warnings Status: ${user.username}`,
        'moderation.description': warnings.length > 0 ? `Active warnings: ${activeCount}\nTotal violations: ${warnings.length}` : 'This member has a clean record on this server.',
        'moderation.reason': warnings[0]?.reason || '',
        'moderator.mention': '',
        'target.mention': `<@${user.id}>`,
        'user.mention': `<@${user.id}>`,
        'user.username': user.username,
        'guild.name': interaction.guild?.name || '',
      });
      await interaction.reply(rendered || { embeds: [embed] });
      return;
    }

    if (name === 'unwarn') {
      const warnId = interaction.options.getString('id', true);
      if (!interaction.memberPermissions?.has([PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.Administrator])) {
        await interaction.reply({ embeds: [this.buildStatusEmbed('Permission Required', 'You need moderation permissions to run this command.')], ephemeral: true });
        return;
      }
      try {
        await this.moderation.revokeWarning(guildId, warnId);
        await interaction.reply({ embeds: [this.buildStatusEmbed('Warning Revoked', `Successfully removed warning record \`${warnId}\`.`)] });
      } catch {
        await interaction.reply({ embeds: [this.buildStatusEmbed('Warning Not Found', 'That warning could not be found or has already been revoked.')], ephemeral: true });
      }
    }
  }

  private buildStatusEmbed(title: string, description: string) {
    return new EmbedBuilder().setColor(0x2b2d31).setTitle(title).setDescription(description).setTimestamp();
  }

  private async renderModeration(category: string, guildId: string, variables: Record<string, unknown>) {
    if (!this.embedTemplates || !this.embedRenderer) return null;
    try {
      const tpl = await this.embedTemplates.getTemplate(guildId, category as any);
      if (tpl?.isDefault) return null;
      return this.embedRenderer.render(tpl.template, variables);
    } catch {
      return null;
    }
  }
}
