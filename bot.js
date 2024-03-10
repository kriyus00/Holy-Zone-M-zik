const Discord = require('discord.js');
const ffmpegPath = require('ffmpeg-static');
const playdl = require('play-dl');
const dotenv = require('dotenv');
dotenv.config();

const {
    REST,
    Routes,
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    PermissionFlagsBits,
} = require('discord.js');

const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, AudioPlayerStatus } = require('@discordjs/voice');

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

const retryAttempts = 3;
let currentConnection;
let playlist = [];
let botChannel; // Kanalı saklamak için değişken

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
    ],
});

(async () => {
    try {
        await client.on('ready', async () => {
            console.log('Bot hazır!');
            console.log('Komutlar kaydediliyor...');
            try {
                await rest.put(Routes.applicationCommands(client.user.id), { body: [
                    new SlashCommandBuilder()
                        .setName('çal')
                        .setDescription('Bir YouTube video URL\'sini veya şarkının adını girerek şarkıyı çalar.')
                        .addStringOption(
                            option =>
                                option
                                    .setName('şarkı')
                                    .setDescription('YouTube video URL\'si veya şarkı adı')
                                    .setRequired(true)
                        ),
                    new SlashCommandBuilder()
                        .setName('atla')
                        .setDescription('Çalan şarkıyı atlar.'),
                    new SlashCommandBuilder()
                        .setName('dur')
                        .setDescription('Çalan şarkıyı durdurur.'),
                    new SlashCommandBuilder()
                        .setName('devam')
                        .setDescription('Duraklatılmış şarkıyı devam ettirir.'),
                    new SlashCommandBuilder()
                        .setName('ayrıl')
                        .setDescription('Ses kanalından ayrılır.'),
                    new SlashCommandBuilder()
                        .setName('temizle')
                        .setDescription('Çalma listesini temizler.'),
                    new SlashCommandBuilder()
                        .setName('liste')
                        .setDescription('Çalma listesini görüntüler.')
                ] });
                console.log('Komutlar başarıyla kaydedildi!');
            } catch (error) {
                console.error('Komutların kaydedilmesi sırasında bir hata oluştu!', error);
            }
        });

        const player = createAudioPlayer();
        
        client.on('interactionCreate', async (interaction) => {
            if (!interaction.isCommand()) return;
            await interaction.deferReply();

            botChannel = interaction.channel; // Botun çağrıldığı kanalı kaydet

            const command = interaction.commandName;
            
            if (command === 'çal') {
                const memberVoiceChannel = interaction.member.voice.channel;
                if (!memberVoiceChannel) return await interaction.editReply('Bir ses kanalına bağlı değilsiniz.');
            
                currentConnection = joinVoiceChannel({
                    channelId: memberVoiceChannel.id,
                    guildId: interaction.guild.id,
                    adapterCreator: interaction.guild.voiceAdapterCreator,
                });
            
                const query = interaction.options.getString("şarkı");
            
                // URL kontrolü yap
                const isURL = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/playlist\?list=)([^#\&\?]*).*$/.test(query);
            
                let stream_url;
                let title;
            
                if (isURL) {
                    stream_url = query;
                    const videoInfo = (await playdl.video_info(query)).video_details;
                    title = videoInfo.title;
                } else {
                    const searchResult = await playdl.search(query);
                    if (searchResult.length === 0) return await interaction.editReply("Bir şarkı bulunamadı.");
                    stream_url = searchResult[0].url;
                    title = searchResult[0].title;
                }
            
                // Çalma listesinde aynı şarkının olup olmadığını kontrol et
                const alreadyInPlaylist = playlist.some(song => song.url === stream_url);
                if (alreadyInPlaylist) return await interaction.editReply("Şarkı zaten çalma listesinde.");
            
                if(player.state.status == AudioPlayerStatus.Playing) {
                    await interaction.editReply("Sıraya eklendi : " + `${title}`);
                    playlist.push({ title: title, url: stream_url });
                    return;
                }
            
                const source = await playdl.stream(stream_url);
            
                const resource = createAudioResource(source.stream, {
                    inputType: source.type
                });
            
                playlist.push({ title: title, url: stream_url });
                currentConnection.subscribe(player);
                player.play(resource);
            
                return await interaction.editReply("Şarkı oynatılıyor." + title);
            } else if (command === 'atla') {
                if (!currentConnection) return await interaction.editReply('Şu anda hiçbir şarkı çalmıyor.');
                if (playlist.length === 0) return await interaction.editReply('Çalma listesinde atlanacak bir şarkı yok.');
                
                playlist.shift(); // Listenin başındaki şarkıyı atla
                if (playlist.length > 0) {
                    const nextSong = playlist[0];
                    
                    const source = await playdl.stream(nextSong.url);

                    const rr = createAudioResource(source.stream, {
                        inputType: source.type
                    });

                    player.play(rr);
                } else {
                    currentConnection.disconnect();
                }
                return await interaction.editReply('Şarkı başarıyla atlandı.');
            } else if (command === 'dur') {
                if (!currentConnection) 
                    return await interaction.deferReply('Şu anda hiçbir şarkı çalmıyor.');
                const player = getVoiceConnection(interaction.guildId).state.subscription.player;
                player.pause();
                return await interaction.editReply('Çalan şarkı duraklatıldı.');
            } else if (command === 'devam') {
                if (!currentConnection) 
                    return await interaction.reply('Şu anda hiçbir şarkı çalmıyor.');
                const player = getVoiceConnection(interaction.guildId).state.subscription.player;
                player.unpause();
                return await interaction.editReply('Çalan şarkı devam ettiriliyor.');
            } else if (command === 'ayrıl') {
                if (!currentConnection) 
                    return await interaction.editReply('Şu anda herhangi bir ses kanalında değilim.');
                currentConnection.disconnect();
                currentConnection = null;
                playlist = []; // Çalma listesini temizle
                return await interaction.editReply('Ses kanalından ayrıldım ve çalma listesi temizledim.');
            } else if (command === 'temizle') {
                playlist = [];
                return await interaction.editReply('Çalma listesi temizlendi.');
            } else if (command === 'liste') {
                const songList = playlist.map((song, index) => `${index + 1}. ${song.title}`).join('\n');
                return await interaction.editReply(`Çalma Listesi:\n${songList}`);
            }
        });

        player.on(AudioPlayerStatus.Idle, async () => {
            console.log('Şarkı bitti!');
            if (playlist.length > 0) {
                const removedSong = playlist.shift();
                console.log(`Çalma listesinden kaldırılan şarkı: ${removedSong.title}`);
                
                if (playlist.length > 0) {
                    const nextSong = playlist[0];
                    const source = await playdl.stream(nextSong.url);
        
                    const _rr = createAudioResource(source.stream, {
                        inputType: source.type
                    });
        
                    player.play(_rr);
        
                    // Kanala mesaj gönder
                    if (botChannel) { // Tanımlanan kanalı kullan
                        await botChannel.send('Sıradaki şarkıya geçiliyor...');
                    } else {
                        console.error("Sıradaki şarkıya geçilirken bir hata oluştu: Kanal bulunamadı veya bağlantı bulunamadı.");
                    }
                } else {
                    console.log('Çalma listesi boş, bağlantıyı kesiyorum.');
                    if (botChannel) { // Tanımlanan kanalı kullan
                        await botChannel.send('Çalma listesi boş, bağlantıyı kesiyorum.');
                    } else {
                        console.error("Çalma listesi boş ve bağlantı kesiliyor ancak kanal bulunamadı.");
                    }
                    if (currentConnection) {
                        currentConnection.disconnect(); // Bağlantıyı kes
                        currentConnection = null;
                    } else {
                        console.error("Çalma listesi boş ve bağlantı kesiliyor ancak bağlantı bulunamadı.");
                    }
                }
            } else {
                console.log('Çalma listesi boş, bağlantıyı kesiyorum.');
                if (botChannel) { // Tanımlanan kanalı kullan
                    await botChannel.send('Çalma listesi boş, bağlantıyı kesiyorum.');
                } else {
                    console.error("Çalma listesi boş ve bağlantı kesiliyor ancak kanal bulunamadı.");
                }
                if (currentConnection) {
                    currentConnection.disconnect(); // Bağlantıyı kes
                    currentConnection = null;
                } else {
                    console.error("Çalma listesi boş ve bağlantı kesiliyor ancak bağlantı bulunamadı.");
                }
            }
        });

        await client.login(process.env.TOKEN);
    } catch (error) {
        console.error('Botun başlatılması sırasında bir hata oluştu:', error);
    }
})();
