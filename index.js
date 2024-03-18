import { makeWASocket, DisconnectReason, useMultiFileAuthState, downloadMediaMessage } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import fs from 'fs'
import TrustPositif from "./module/TrustPositifModule.js"
import cfg from "./config.json" assert { type: "json" }

// const cfg = JSON.parse(fs.readFileSync("./config.json", "utf8"));
let interval = cfg.interval * 60 * 1000;
const IPOChecker = new TrustPositif(cfg.domains);

function RemoveSpecialCharacters(string) {
    return string.replace(/[&\/\\#,+()$~%.'":*?<>{}]/g, '');
}

function SaveConfig() {
    cfg.domains = IPOChecker.table;
    fs.writeFileSync("./config.json", JSON.stringify(cfg, undefined, 4));
}

async function DownloadMedia(message, extension = "bin") {
    try {
        const buffer = await downloadMediaMessage(
            message,
            'buffer',
            { },
            { }
        );
    
        const date = new Date(message.messageTimestamp * 1000);
        const dir = `./media/${RemoveSpecialCharacters(message.pushName)}`;
        const stringDate = date.toLocaleString().replaceAll("/", "-").replaceAll(", ", "_").replaceAll(":", "-");
    
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFile(`${dir}/${stringDate}.${extension}`, buffer, (err) => {
            if (err)
                console.error(err);
        })

    } catch (err) {
        console.error(err.message);
    }
}

/**
 * Send message to list of target
 * @param {import('@whiskeysockets/baileys').WASocket} socket
 * @param {Object} to
 * @param {import('@whiskeysockets/baileys').AnyMessageContent} content
 * @param {import('@whiskeysockets/baileys').MiscMessageGenerationOptions | undefined} options
 */
async function SendMessageEx(socket, to, content, options) {
    for(let i = 0; i < to.length; i++) {
        const isGroup = to[i].id.includes("@g.us");
        if (isGroup && !cfg.sendList[i].lastCheck || cfg.sendList[i].lastCheck + (5 * 3600000) < Date.now() ) {
            socket.groupMetadata(to[i].id).then((res) => {
                cfg.sendList[i].name = res.subject;
                cfg.sendList[i].lastCheck = Date.now();
                SaveConfig();
            });
        }

        console.log(`Message sent to ${isGroup ? "GROUP " + cfg.sendList[i].name : to[i].id }`);
        socket.sendMessage(to[i].id, content, options);
    }
}

async function connectToWhatsApp () {
    let t = 0;
    const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
    const sock = makeWASocket({
        // can provide additional config here
        printQRInTerminal: true,
        auth: state,
        defaultQueryTimeoutMs: undefined,
        keepAliveIntervalMs: 25_000
    });

    function PeriodicCheck() {
        return setInterval(() => {
            console.log("Checking at " + new Date().toLocaleString());
            IPOChecker.Check().then(async (data) => {
                try {
                    if (data) 
                        await SendMessageEx(sock, cfg.sendList, { text: data });
    
                    SaveConfig();
                } catch (err) {
                    console.error(err);
                }
            })
        }, interval);
    }
    
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if(connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            
            clearInterval(t);
            console.log('connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
            // reconnect if not logged out
            if(shouldReconnect) {
                connectToWhatsApp();
            }
        } else if(connection === 'open') {
            console.log('opened connection');
            t = PeriodicCheck();
        }
    })
    sock.ev.on('messages.upsert', async (m) => {
        // console.log(JSON.stringify(m, undefined, 2))

        // console.log('replying to', m.messages[0].key.remoteJid)
        
        const msg = m.messages[0].message;
        const key = m.messages[0].key;
        const msgFrom = key.participant ? key.participant : key.remoteJid;
        console.log(`Get message from ${key.remoteJid} || ${msgFrom}`);

        if (cfg.admin.includes(msgFrom) || msgFrom == cfg.root) {
            const text = msg.conversation ? msg.conversation : msg.extendedTextMessage?.text;
            if (!text)
                return;
            
            if (!text.indexOf("/add ")) {
                const res = IPOChecker.AddDomain(text.replace(/\/.*? /, "").split(/\s+/));
                await sock.sendMessage(m.messages[0].key.remoteJid, { text: res }, { quoted: m.messages[0] });
                SaveConfig();
            } else if (!text.indexOf("/remove ")) {
                const res = IPOChecker.RemoveDomain(text.replace(/\/.*? /, "").split(/\s+/));
                await sock.sendMessage(m.messages[0].key.remoteJid, { text: res }, { quoted: m.messages[0] });
                SaveConfig();
            } else if (!text.indexOf("/help")) {
                sock.sendMessage(m.messages[0].key.remoteJid, { text: "/add <url>\n/remove <url>\n/reset\n/list\n/report" }, { quoted: m.messages[0] });
            } else if (!text.indexOf("/reset ")) {
                const res = IPOChecker.ResetTable();
                await sock.sendMessage(m.messages[0].key.remoteJid, { text: res }, { quoted: m.messages[0] });
                SaveConfig();
            } else if (!text.indexOf("/list")) {
                sock.sendMessage(m.messages[0].key.remoteJid, { text: IPOChecker.GetList() }, { quoted: m.messages[0] });
            } else if (!text.indexOf("/report")) {
                sock.sendMessage(m.messages[0].key.remoteJid, { text: IPOChecker.ReportUpdate(IPOChecker.dailyReport) }, { quoted: m.messages[0] });
            }
        }

        const viewOnceMsg = msg.viewOnceMessageV2?.message;
        
        if (!m.messages[0].key.fromMe) {
            if (viewOnceMsg) {
                await DownloadMedia(m.messages[0], Object.values(viewOnceMsg)[0].mimetype.split("/")[1]);
            }
            // if (viewOnceMsg?.imageMessage) {
            //     await DownloadMedia(m.messages[0], viewOnceMsg.imageMessage.mimetype.split("/")[1])
            // } else if (viewOnceMsg?.videoMessage) {
            //     await DownloadMedia(m.messages[0], viewOnceMsg.videoMessage.mimetype.split("/")[1])
            // }
        }

        // await sock.sendMessage(m.messages[0].key.remoteJid, { text: 'Downloaded Successfully' })
    })
    
    sock.ev.on('creds.update', saveCreds);
}
// run in main file
connectToWhatsApp();