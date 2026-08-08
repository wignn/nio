CREATE TABLE "GuildPluginCredential" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "pluginId" TEXT NOT NULL,
  "encryptedToken" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GuildPluginCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuildPluginCredential_guildId_pluginId_key"
  ON "GuildPluginCredential"("guildId", "pluginId");
CREATE INDEX "GuildPluginCredential_pluginId_idx"
  ON "GuildPluginCredential"("pluginId");

ALTER TABLE "GuildPluginCredential"
  ADD CONSTRAINT "GuildPluginCredential_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GuildPluginCredential"
  ADD CONSTRAINT "GuildPluginCredential_pluginId_fkey"
  FOREIGN KEY ("pluginId") REFERENCES "PluginCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
