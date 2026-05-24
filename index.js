const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    PermissionsBitField,
    REST,
    Routes,
    SlashCommandBuilder,
    ChannelType
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ===== CONFIG — MODIFIE CES VALEURS =====
const TOKEN = process.env.TOKEN;
const CLIENT_ID = '1507862941351936172';
const TICKET_CATEGORY_NAME = 'Tickets';
const ADMIN_PAYPAL = 'kan.tiktoksab@gmail.com'; // Ton PayPal à toi (l'admin)
// ========================================

let taxe = 10;

const commands = [
    new SlashCommandBuilder()
        .setName('vendre')
        .setDescription('Poster une annonce de vente avec le prix taxé')
        .addStringOption(opt =>
            opt.setName('produit')
                .setDescription('Nom du produit')
                .setRequired(true)
        )
        .addNumberOption(opt =>
            opt.setName('prix')
                .setDescription('Ton prix de vente (en €)')
                .setRequired(true)
        )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
    console.log(`✅ Connecté : ${client.user.tag}`);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ Slash commands enregistrées !');
    } catch (err) {
        console.error('❌ Erreur slash commands :', err);
    }
});

// ===== !panel =====
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (message.content !== '!panel') return;
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return message.reply('❌ Tu n\'es pas admin.');
    }
    await message.channel.send({ embeds: [buildPanelEmbed()], components: [buildPanelRow()] });
});

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {

    // --- /vendre ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'vendre') {
        const produit = interaction.options.getString('produit');
        const prixBase = interaction.options.getNumber('prix');

        if (prixBase <= 0) {
            return interaction.reply({ content: '❌ Le prix doit être supérieur à 0 €.', ephemeral: true });
        }

        const prixTaxe = prixBase * (1 + taxe / 100);
        const montantTaxe = (prixTaxe - prixBase).toFixed(2);

        const embed = new EmbedBuilder()
            .setTitle('🏷️ Annonce de vente')
            .setColor('Gold')
            .addFields(
                { name: '📦 Produit', value: produit, inline: true },
                { name: '💰 Prix vendeur', value: `${prixBase.toFixed(2)} €`, inline: true },
                { name: '🧾 Taxe', value: `${taxe}% (+${montantTaxe} €)`, inline: true },
                { name: '💵 Prix total acheteur', value: `**${prixTaxe.toFixed(2)} €**`, inline: false }
            )
            .setFooter({ text: `Vendu par ${interaction.user.username} • ID: ${interaction.user.id}` })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`acheter_${interaction.user.id}_${prixBase}_${prixTaxe.toFixed(2)}_${encodeURIComponent(produit)}`)
                .setLabel('🛒 Acheter')
                .setStyle(ButtonStyle.Success)
        );

        await interaction.reply({ embeds: [embed], components: [row] });
        return;
    }

    // --- Bouton Acheter ---
    if (interaction.isButton() && interaction.customId.startsWith('acheter_')) {
        const parts = interaction.customId.split('_');
        const vendeurId = parts[1];
        const prixBase = parseFloat(parts[2]);
        const prixTotal = parts[3];
        const produit = decodeURIComponent(parts.slice(4).join('_'));
        const montantTaxe = (parseFloat(prixTotal) - prixBase).toFixed(2);

        if (interaction.user.id === vendeurId) {
            return interaction.reply({ content: '❌ Tu ne peux pas acheter ton propre article.', ephemeral: true });
        }

        const guild = interaction.guild;
        const acheteur = interaction.member;
        const vendeur = await guild.members.fetch(vendeurId).catch(() => null);

        // Trouver ou créer la catégorie Tickets
        let categorie = guild.channels.cache.find(
            c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === TICKET_CATEGORY_NAME.toLowerCase()
        );
        if (!categorie) {
            categorie = await guild.channels.create({
                name: TICKET_CATEGORY_NAME,
                type: ChannelType.GuildCategory
            });
        }

        const adminOverwrites = guild.roles.cache
            .filter(r => r.permissions.has(PermissionsBitField.Flags.Administrator))
            .map(r => ({
                id: r.id,
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
            }));

        const nomProduitCourt = produit.substring(0, 15).toLowerCase().replace(/\s/g, '-');

        // ===== TICKET VENDEUR =====
        const ticketVendeur = await guild.channels.create({
            name: `vendeur-${nomProduitCourt}-${vendeur ? vendeur.user.username : 'inconnu'}`,
            type: ChannelType.GuildText,
            parent: categorie.id,
            permissionOverwrites: [
                { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
                ...(vendeur ? [{
                    id: vendeur.id,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
                }] : []),
                ...adminOverwrites
            ]
        });

        const embedVendeur = new EmbedBuilder()
            .setTitle('🧑‍💼 Ticket Vendeur')
            .setColor('Green')
            .addFields(
                { name: '📦 Produit', value: produit, inline: true },
                { name: '🛒 Acheteur', value: `<@${acheteur.id}>`, inline: true },
                { name: '💰 Tu recevras', value: `**${prixBase.toFixed(2)} €**`, inline: true },
                { name: '📋 Comment ça marche ?', value: `1. Renseigne ton adresse **PayPal** dans ce ticket\n2. L'acheteur envoie **${prixTotal} €** à l'admin\n3. L'admin vérifie le paiement et te reverse **${prixBase.toFixed(2)} €** sur ton PayPal\n4. ✅ Transaction terminée !` },
                { name: '💡 Info', value: `Les taxes (**${montantTaxe} €**) restent à l'admin en échange du service.` }
            )
            .setTimestamp();

        const closeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('fermer_ticket')
                .setLabel('🔒 Fermer le ticket')
                .setStyle(ButtonStyle.Danger)
        );

        await ticketVendeur.send({
            content: `${vendeur ? `<@${vendeur.id}>` : 'Vendeur'} — Quelqu'un veut acheter ton article ! Merci de renseigner ton PayPal ci-dessous.`,
            embeds: [embedVendeur],
            components: [closeRow]
        });

        // ===== TICKET ACHETEUR =====
        const ticketAcheteur = await guild.channels.create({
            name: `acheteur-${nomProduitCourt}-${acheteur.user.username}`,
            type: ChannelType.GuildText,
            parent: categorie.id,
            permissionOverwrites: [
                { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
                {
                    id: acheteur.id,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
                },
                ...adminOverwrites
            ]
        });

        const embedAcheteur = new EmbedBuilder()
            .setTitle('🛒 Ticket Acheteur')
            .setColor('Blue')
            .addFields(
                { name: '📦 Produit', value: produit, inline: true },
                { name: '🧑‍💼 Vendeur', value: vendeur ? `<@${vendeur.id}>` : `ID: ${vendeurId}`, inline: true },
                { name: '💵 Montant à payer', value: `**${prixTotal} €**`, inline: true },
                { name: '📋 Comment ça marche ?', value: `1. Envoie **${prixTotal} €** sur le PayPal de l'admin ci-dessous\n2. L'admin vérifie le paiement\n3. L'admin reverse **${prixBase.toFixed(2)} €** au vendeur\n4. ✅ Transaction terminée !` },
                { name: '💳 PayPal de l\'admin', value: `\`\`\`${ADMIN_PAYPAL}\`\`\`` },
                { name: '⚠️ Important', value: `Envoie bien **exactement ${prixTotal} €** et ajoute en note : \`Achat ${produit}\`` }
            )
            .setTimestamp();

        const closeRowAcheteur = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('fermer_ticket')
                .setLabel('🔒 Fermer le ticket')
                .setStyle(ButtonStyle.Danger)
        );

        await ticketAcheteur.send({
            content: `<@${acheteur.id}> — Voici les instructions pour finaliser ton achat !`,
            embeds: [embedAcheteur],
            components: [closeRowAcheteur]
        });

        await interaction.reply({
            content: `✅ Tes tickets ont été créés !\n🧑‍💼 Ticket vendeur : ${ticketVendeur}\n🛒 Ton ticket acheteur : ${ticketAcheteur}`,
            ephemeral: true
        });
        return;
    }

    // --- Fermer ticket ---
    if (interaction.isButton() && interaction.customId === 'fermer_ticket') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Seul un admin peut fermer le ticket.', ephemeral: true });
        }
        await interaction.reply({ content: '🔒 Ticket fermé. Suppression dans 5 secondes...' });
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
        return;
    }

    // --- Boutons panel ---
    if (interaction.isButton()) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Tu n\'es pas admin.', ephemeral: true });
        }
        if (interaction.customId === 'add_tax') taxe += 5;
        if (interaction.customId === 'remove_tax') taxe = Math.max(0, taxe - 5);
        if (interaction.customId === 'reset_tax') taxe = 10;
        await interaction.update({ embeds: [buildPanelEmbed()], components: [buildPanelRow()] });
    }
});

// ===== HELPERS =====
function buildPanelEmbed() {
    return new EmbedBuilder()
        .setTitle('⚙️ Panel Admin — Taxe de vente')
        .setDescription(`Taxe actuelle : **${taxe}%**\nExemple : 100 € → **${(100 * (1 + taxe / 100)).toFixed(2)} €** pour l'acheteur`)
        .setColor('Blue')
        .setTimestamp();
}

function buildPanelRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('add_tax').setLabel('➕ +5%').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('remove_tax').setLabel('➖ -5%').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('reset_tax').setLabel('🔄 Reset (10%)').setStyle(ButtonStyle.Secondary)
    );
}

client.login('MTUwNzg2Mjk0MTM1MTkzNjE3Mg.GKMSNt.2yVHUxgTomE1Yi0T_hB_u8y3Q2GgduYcBtYN6c');
