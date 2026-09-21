require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const MASTER_ADMIN_PASSWORD = process.env.MASTER_ADMIN_PASSWORD || 'master123';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=300');
    }
  }
}));

// Configuración persistente del enlace de descarga para la App de Windows
const DOWNLOAD_CONFIG_FILE = path.join(__dirname, 'download_config.json');

function getAppDownloadUrl() {
  try {
    if (fs.existsSync(DOWNLOAD_CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(DOWNLOAD_CONFIG_FILE, 'utf8'));
      if (data && data.url) return data.url;
    }
  } catch (e) {}
  return process.env.APP_DOWNLOAD_URL || 'https://drive.google.com/file/d/1ZEyR_z44AheeCNDIkMlFmLbSp9jPqtGI/view?usp=sharing';
}

function setAppDownloadUrl(url) {
  try {
    fs.writeFileSync(DOWNLOAD_CONFIG_FILE, JSON.stringify({ url }, null, 2));
    return true;
  } catch (e) {
    console.error('[Error guardando link de descarga]', e);
    return false;
  }
}

const APP_VERSION = '1.3.0';

app.get('/api/version', (req, res) => {
  res.json({
    version: APP_VERSION,
    downloadUrl: getAppDownloadUrl(),
    features: [
      'Visualizador de Nicks en Escenario de Voz y Tarjetas de Participantes',
      'Roles de Caller separados: Caller Campo 1 y Caller Campo 2',
      'Menú contextual con clic derecho para silenciar y cambiar roles'
    ]
  });
});

app.get('/api/app-download-url', (req, res) => {
  res.json({ url: getAppDownloadUrl() });
});

app.post('/api/app-download-url', (req, res) => {
  const { url, masterPassword } = req.body;
  if (masterPassword !== MASTER_ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Clave Master Admin requerida' });
  }
  setAppDownloadUrl(url);
  io.emit('app:download_url_updated', { url });
  res.json({ success: true, url });
});

app.get('/descargar', (req, res) => {
  const url = getAppDownloadUrl();
  if (url && url.startsWith('http')) {
    return res.redirect(url);
  }
  res.redirect('/?openDownload=true');
});

// Archivos de persistencia en disco
const CHANNELS_FILE = path.join(__dirname, 'channels.json');
const BANNED_FILE = path.join(__dirname, 'banned.json');
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');

const DEFAULT_CHANNELS = [
  { id: 'text-general', name: 'general', type: 'text', category: 'General', description: 'Canal general de chat SpecialDeliverySpeak' },
  { id: 'c1-chat', name: 'chat-campo-1', type: 'text', category: 'Campo 1', description: 'Chat de texto y coordinación de Campo 1' },
  { id: 'c1-party-1', name: 'Party 1', type: 'voice', category: 'Campo 1', userLimit: 0 },
  { id: 'c1-party-2', name: 'Party 2', type: 'voice', category: 'Campo 1', userLimit: 0 },
  { id: 'c1-party-3', name: 'Party 3', type: 'voice', category: 'Campo 1', userLimit: 0 },
  { id: 'c1-party-4', name: 'Party 4', type: 'voice', category: 'Campo 1', userLimit: 0 },
  { id: 'c1-party-5', name: 'Party 5', type: 'voice', category: 'Campo 1', userLimit: 0 },
  { id: 'c1-party-6', name: 'Party 6', type: 'voice', category: 'Campo 1', userLimit: 0 },
  { id: 'c1-party-7', name: 'Party 7', type: 'voice', category: 'Campo 1', userLimit: 0 },
  { id: 'c1-party-8', name: 'Party 8', type: 'voice', category: 'Campo 1', userLimit: 0 },
  { id: 'c2-chat', name: 'chat-campo-2', type: 'text', category: 'Campo 2', description: 'Chat de texto y coordinación de Campo 2' },
  { id: 'c2-party-1', name: 'Party 1', type: 'voice', category: 'Campo 2', userLimit: 0 },
  { id: 'c2-party-2', name: 'Party 2', type: 'voice', category: 'Campo 2', userLimit: 0 },
  { id: 'c2-party-3', name: 'Party 3', type: 'voice', category: 'Campo 2', userLimit: 0 },
  { id: 'c2-party-4', name: 'Party 4', type: 'voice', category: 'Campo 2', userLimit: 0 },
  { id: 'c2-party-5', name: 'Party 5', type: 'voice', category: 'Campo 2', userLimit: 0 },
  { id: 'c2-party-6', name: 'Party 6', type: 'voice', category: 'Campo 2', userLimit: 0 },
  { id: 'c2-party-7', name: 'Party 7', type: 'voice', category: 'Campo 2', userLimit: 0 },
  { id: 'c2-party-8', name: 'Party 8', type: 'voice', category: 'Campo 2', userLimit: 0 }
];

function loadChannels() {
  try {
    if (fs.existsSync(CHANNELS_FILE)) {
      const data = fs.readFileSync(CHANNELS_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (err) {
    console.error('[Error cargando canales]', err);
  }
  return [...DEFAULT_CHANNELS];
}

function saveChannels() {
  try {
    fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channels, null, 2), 'utf8');
  } catch (err) {
    console.error('[Error guardando canales]', err);
  }
}

function loadBans() {
  try {
    if (fs.existsSync(BANNED_FILE)) {
      const data = fs.readFileSync(BANNED_FILE, 'utf8');
      const parsed = JSON.parse(data);
      return {
        ips: new Set(parsed.ips || []),
        users: new Set(parsed.users || [])
      };
    }
  } catch (e) {
    console.error('[Error cargando baneos]', e);
  }
  return { ips: new Set(), users: new Set() };
}

function saveBans() {
  try {
    const data = {
      ips: Array.from(bannedIPs),
      users: Array.from(bannedUsers)
    };
    fs.writeFileSync(BANNED_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[Error guardando baneos]', e);
  }
}

// Persistencia de cuentas (username en minúsculas -> objeto de cuenta)
function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[Error cargando cuentas]', e);
  }
  return {};
}

function saveAccounts() {
  try {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');
  } catch (e) {
    console.error('[Error guardando cuentas]', e);
  }
}

function hashPassword(pass) {
  return crypto.createHash('sha256').update(pass + 'sds_salt_2026').digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

let channels = loadChannels();
saveChannels();

let accounts = loadAccounts();

// Garantizar privilegios de Administrador Maestro permanente a elbolas y progamer2026
['elbolas', 'progamer2026'].forEach(admName => {
  if (accounts[admName]) {
    accounts[admName].isAdmin = true;
    accounts[admName].isMasterAdmin = true;
  }
});
saveAccounts();

// Mapa de socketId -> Usuario activo
const users = new Map();

// Historial de mensajes por canal
const messages = {
  'text-general': [
    {
      id: 'msg-welcome',
      sender: 'Sistema',
      senderColor: '#5865F2',
      isAdmin: false,
      isMasterAdmin: false,
      isSystem: true,
      text: '📦 ¡Bienvenidos a SpecialDeliverySpeak! Usa los canales de voz para hablar con calidad de estudio.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ],
  'text-memes': []
};

function getChannelCampo(channelId) {
  if (!channelId) return null;
  const ch = channels.find(c => c.id === channelId);
  if (ch) {
    if (ch.category === 'Campo 1' || ch.id.startsWith('c1-')) return 'c1';
    if (ch.category === 'Campo 2' || ch.id.startsWith('c2-')) return 'c2';
  }
  if (channelId.startsWith('c1-')) return 'c1';
  if (channelId.startsWith('c2-')) return 'c2';
  return null;
}

function shouldCallerReachUser(callerUser, targetUser) {
  if (!callerUser || !callerUser.isCaller || !targetUser || !targetUser.currentVoiceChannel) return false;
  const role = callerUser.callerRole || 'global';
  if (role === 'global') return true;
  const targetCampo = getChannelCampo(targetUser.currentVoiceChannel);
  return role === targetCampo;
}

function getVoiceChannelUsers(channelId) {
  const result = [];
  for (const [sId, u] of users.entries()) {
    if (u.currentVoiceChannel === channelId) {
      result.push({
        id: sId,
        username: u.username,
        color: u.color,
        avatar: u.avatar,
        isAdmin: u.isAdmin,
        isMasterAdmin: u.isMasterAdmin,
        isCaller: !!u.isCaller,
        callerRole: u.callerRole || (u.isCaller ? 'global' : null),
        isMuted: u.isMuted,
        isDeafened: u.isDeafened,
        isSpeaking: u.isSpeaking
      });
    }
  }
  return result;
}

function getAllVoiceState() {
  const state = {};
  channels.filter(c => c.type === 'voice').forEach(c => {
    state[c.id] = getVoiceChannelUsers(c.id);
  });
  return state;
}

function isLoopbackIP(ip) {
  if (!ip) return false;
  return ip === '127.0.0.1' || ip === '::1' || ip.includes('127.0.0.1') || ip === 'localhost';
}

function getClientIP(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return socket.handshake.address || '';
}

// Función auxiliar para conectar e inicializar un usuario en el servidor
function initializeSession(socket, userAccount) {
  const lowerName = (userAccount.username || '').toLowerCase();
  if (lowerName === 'elbolas' || lowerName === 'progamer2026') {
    userAccount.isAdmin = true;
    userAccount.isMasterAdmin = true;
  }

  const user = {
    id: socket.id,
    username: userAccount.username,
    avatar: userAccount.avatar || '📦',
    color: userAccount.color || '#5865F2',
    isAdmin: !!userAccount.isAdmin,
    isMasterAdmin: !!userAccount.isMasterAdmin,
    isCaller: !!userAccount.isCaller,
    callerRole: userAccount.callerRole || (userAccount.isCaller ? 'global' : null),
    ip: getClientIP(socket),
    currentVoiceChannel: null,
    isMuted: false,
    isDeafened: false,
    isSpeaking: false
  };

  users.set(socket.id, user);
  socket.user = user;

  socket.emit('auth:success', {
    user,
    token: userAccount.token
  });

  socket.emit('init:state', {
    user,
    channels,
    users: Array.from(users.values()),
    voiceState: getAllVoiceState(),
    messages,
    appVersion: APP_VERSION,
    downloadUrl: getAppDownloadUrl()
  });

  socket.broadcast.emit('user:joined', user);
  console.log(`[Sesión Iniciada] ${user.username} (Admin=${user.isAdmin}, Master=${user.isMasterAdmin})`);
}

io.on('connection', (socket) => {
  const clientIP = getClientIP(socket);

  if (clientIP && !isLoopbackIP(clientIP) && bannedIPs.has(clientIP)) {
    console.log(`[Baneo Rechazado] IP bloqueada: ${clientIP}`);
    socket.emit('user:banned_error', { reason: 'Has sido baneado de SpecialDeliverySpeak.' });
    return socket.disconnect(true);
  }

  // ===================== SISTEMA DE CUENTAS Y AUTO-LOGIN =====================

  // 1. Reanudar sesión automática mediante token de localStorage
  socket.on('auth:verify_session', ({ token }) => {
    if (!token) return socket.emit('auth:session_invalid');

    // Buscar cuenta por token
    let foundAccount = null;
    for (const key in accounts) {
      if (accounts[key].token === token) {
        foundAccount = accounts[key];
        break;
      }
    }

    if (!foundAccount) {
      return socket.emit('auth:session_invalid');
    }

    if (bannedUsers.has(foundAccount.username.toLowerCase())) {
      return socket.emit('user:banned_error', { reason: 'Esta cuenta ha sido baneada permanentemente.' });
    }

    initializeSession(socket, foundAccount);
  });

  // 2. Iniciar sesión con Apodo y Contraseña
  socket.on('auth:login', ({ username, password }) => {
    const cleanUsername = (username || '').trim();
    const accountKey = cleanUsername.toLowerCase();

    if (!cleanUsername || !password) {
      return socket.emit('auth:error', { message: 'Por favor, completa todos los campos.' });
    }

    if (bannedUsers.has(accountKey)) {
      return socket.emit('user:banned_error', { reason: 'Esta cuenta ha sido baneada permanentemente.' });
    }

    const account = accounts[accountKey];
    if (!account) {
      return socket.emit('auth:error', { message: 'El usuario no existe. Regístrate primero.' });
    }

    if (account.passwordHash !== hashPassword(password)) {
      return socket.emit('auth:error', { message: 'Contraseña incorrecta.' });
    }

    // Renovar token
    account.token = generateToken();
    saveAccounts();

    initializeSession(socket, account);
  });

  // 3. Registrar cuenta nueva
  socket.on('auth:register', ({ username, password, avatar, color, adminPass }) => {
    const cleanUsername = (username || '').trim().substring(0, 24);
    const accountKey = cleanUsername.toLowerCase();

    if (!cleanUsername || cleanUsername.length < 2) {
      return socket.emit('auth:error', { message: 'El nombre debe tener al menos 2 caracteres.' });
    }
    if (!password || password.length < 4) {
      return socket.emit('auth:error', { message: 'La contraseña debe tener al menos 4 caracteres.' });
    }

    if (bannedUsers.has(accountKey)) {
      return socket.emit('user:banned_error', { reason: 'Este nombre de usuario se encuentra baneado.' });
    }

    if (accounts[accountKey]) {
      return socket.emit('auth:error', { message: 'Este nombre de usuario ya está registrado. Inicia sesión.' });
    }

    let isMasterAdmin = false;
    let isAdmin = false;

    if (adminPass) {
      if (adminPass === MASTER_ADMIN_PASSWORD) {
        isMasterAdmin = true;
        isAdmin = true;
      } else if (adminPass === ADMIN_PASSWORD) {
        isAdmin = true;
      }
    }

    const newAccount = {
      username: cleanUsername,
      passwordHash: hashPassword(password),
      avatar: avatar || '📦',
      color: color || '#5865F2',
      isAdmin,
      isMasterAdmin,
      isCaller: false,
      callerRole: null,
      token: generateToken(),
      createdAt: new Date().toISOString()
    };

    accounts[accountKey] = newAccount;
    saveAccounts();

    initializeSession(socket, newAccount);
  });

  // 4. Modo invitado rápido (para retrocompatibilidad)
  socket.on('user:join', ({ username, avatar, color }) => {
    const cleanUsername = (username || 'Amigo').trim().substring(0, 24);
    const accountKey = cleanUsername.toLowerCase();

    if (bannedUsers.has(accountKey)) {
      socket.emit('user:banned_error', { reason: 'Este usuario ha sido baneado permanentemente.' });
      return socket.disconnect(true);
    }

    // Si ya existe como cuenta registrada, exigir contraseña
    if (accounts[accountKey]) {
      return socket.emit('auth:require_password', { username: cleanUsername });
    }

    const guestUser = {
      id: socket.id,
      username: cleanUsername,
      avatar: avatar || '📦',
      color: color || '#5865F2',
      isAdmin: false,
      isMasterAdmin: false,
      isCaller: false,
      callerRole: null,
      ip: clientIP,
      currentVoiceChannel: null,
      isMuted: false,
      isDeafened: false,
      isSpeaking: false
    };

    users.set(socket.id, guestUser);
    socket.user = guestUser;

    socket.emit('init:state', {
      user: guestUser,
      channels,
      users: Array.from(users.values()),
      voiceState: getAllVoiceState(),
      messages,
      appVersion: APP_VERSION,
      downloadUrl: getAppDownloadUrl()
    });

    socket.broadcast.emit('user:joined', guestUser);
  });

  // 5. Autenticación de Administrador
  socket.on('admin:login', ({ password }) => {
    if (!socket.user) return;

    if (password === MASTER_ADMIN_PASSWORD) {
      socket.user.isMasterAdmin = true;
      socket.user.isAdmin = true;

      // Persistir rango en su cuenta si está registrada
      const accountKey = socket.user.username.toLowerCase();
      if (accounts[accountKey]) {
        accounts[accountKey].isMasterAdmin = true;
        accounts[accountKey].isAdmin = true;
        saveAccounts();
      }

      socket.emit('admin:login_success', { isAdmin: true, isMasterAdmin: true });
      io.emit('user:updated', socket.user);
      io.emit('voice:state_update', getAllVoiceState());

      const adminNotice = {
        id: `sys-${Date.now()}`,
        sender: 'Sistema',
        senderColor: '#FEE75C',
        isSystem: true,
        text: `👑⭐ ${socket.user.username} ha iniciado sesión como Administrador Maestro.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      if (!messages['text-general']) messages['text-general'] = [];
      messages['text-general'].push(adminNotice);
      io.emit('chat:message', { channelId: 'text-general', message: adminNotice });
    } else if (password === ADMIN_PASSWORD) {
      socket.user.isAdmin = true;
      socket.user.isMasterAdmin = false;

      const accountKey = socket.user.username.toLowerCase();
      if (accounts[accountKey]) {
        accounts[accountKey].isAdmin = true;
        saveAccounts();
      }

      socket.emit('admin:login_success', { isAdmin: true, isMasterAdmin: false });
      io.emit('user:updated', socket.user);
      io.emit('voice:state_update', getAllVoiceState());
    } else {
      socket.emit('admin:login_failed', { message: 'Contraseña de administrador incorrecta' });
    }
  });

  // 6. Promover o Degradar Administrador (Guarda en cuenta persistente)
  socket.on('admin:promote_user', ({ targetSocketId, makeAdmin }) => {
    if (!socket.user || !socket.user.isMasterAdmin) {
      return socket.emit('error:permission', 'Solo el Administrador Maestro puede otorgar o quitar el rol de administrador.');
    }

    const targetUser = users.get(targetSocketId);
    if (!targetUser || targetUser.isMasterAdmin) return;

    targetUser.isAdmin = !!makeAdmin;

    // Persistir rango en la base de datos de cuentas
    const accountKey = targetUser.username.toLowerCase();
    if (accounts[accountKey]) {
      accounts[accountKey].isAdmin = targetUser.isAdmin;
      saveAccounts();
    }

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.emit('admin:role_updated', { isAdmin: targetUser.isAdmin, isMasterAdmin: false });
    }

    io.emit('user:updated', targetUser);
    io.emit('voice:state_update', getAllVoiceState());

    const noticeText = makeAdmin
      ? `👑⭐ ${socket.user.username} ha nombrado Administrador a ${targetUser.username}.`
      : `🛡️ ${socket.user.username} ha removido los permisos de Administrador a ${targetUser.username}.`;

    const notice = {
      id: `sys-${Date.now()}`,
      sender: 'Sistema',
      senderColor: '#5865F2',
      isSystem: true,
      text: noticeText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    if (!messages['text-general']) messages['text-general'] = [];
    messages['text-general'].push(notice);
    io.emit('chat:message', { channelId: 'text-general', message: notice });
  });

  // 7. Expulsar Usuario del Servidor (Kick)
  socket.on('admin:kick_user', ({ targetSocketId }) => {
    if (!socket.user || (!socket.user.isAdmin && !socket.user.isMasterAdmin)) {
      return socket.emit('error:permission', 'No tienes permisos para expulsar usuarios.');
    }

    const targetUser = users.get(targetSocketId);
    if (!targetUser || targetUser.isMasterAdmin) return;

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.emit('user:kicked_by_admin', { by: socket.user.username });
      targetSocket.disconnect(true);
    }
  });

  // 8. Banear Usuario del Servidor (Ban)
  socket.on('admin:ban_user', ({ targetSocketId, reason }) => {
    if (!socket.user || !socket.user.isMasterAdmin) {
      return socket.emit('error:permission', 'Solo el Administrador Maestro puede banear usuarios.');
    }

    const targetUser = users.get(targetSocketId);
    if (!targetUser || targetUser.isMasterAdmin) return;

    if (targetUser.ip && !isLoopbackIP(targetUser.ip)) {
      bannedIPs.add(targetUser.ip);
    }
    bannedUsers.add(targetUser.username.toLowerCase());
    saveBans();

    const banNotice = {
      id: `sys-${Date.now()}`,
      sender: 'Sistema',
      senderColor: '#ED4245',
      isSystem: true,
      text: `🚫 ${targetUser.username} ha sido baneado permanentemente del servidor por ${socket.user.username}.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    if (!messages['text-general']) messages['text-general'] = [];
    messages['text-general'].push(banNotice);
    io.emit('chat:message', { channelId: 'text-general', message: banNotice });

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.emit('user:banned_by_admin', { by: socket.user.username, reason });
      targetSocket.disconnect(true);
    }
  });

  // 9. Mutear Usuario en Servidor
  socket.on('admin:mute_user', ({ targetSocketId }) => {
    if (!socket.user || (!socket.user.isAdmin && !socket.user.isMasterAdmin)) {
      return socket.emit('error:permission', 'No tienes permisos para silenciar usuarios.');
    }

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.emit('voice:force_muted_by_admin', { by: socket.user.username });
      if (targetSocket.user) {
        targetSocket.user.isMuted = true;
        io.emit('user:updated', targetSocket.user);
        io.emit('voice:state_update', getAllVoiceState());
      }
    }
  });

  // 9b. Desmutear Usuario en Servidor
  socket.on('admin:unmute_user', ({ targetSocketId }) => {
    if (!socket.user || (!socket.user.isAdmin && !socket.user.isMasterAdmin)) {
      return socket.emit('error:permission', 'No tienes permisos para desilenciar usuarios.');
    }

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.emit('voice:force_unmuted_by_admin', { by: socket.user.username });
      if (targetSocket.user) {
        targetSocket.user.isMuted = false;
        io.emit('user:updated', targetSocket.user);
        io.emit('voice:state_update', getAllVoiceState());
      }
    }
  });

  // 9c. Asignar o Remover Rol Caller (Campo 1, Campo 2 o Global)
  socket.on('admin:set_caller', ({ targetSocketId, role, isCaller }) => {
    if (!socket.user || (!socket.user.isAdmin && !socket.user.isMasterAdmin)) {
      return socket.emit('error:permission', 'Solo un administrador puede asignar o remover roles de Caller.');
    }

    const targetUser = users.get(targetSocketId);
    if (!targetUser) return;

    // Determinar nuevo rol ('c1', 'c2', 'global', o null)
    let newRole = role;
    if (!newRole) {
      if (isCaller === true) newRole = 'global';
      else if (isCaller === false) newRole = null;
      else newRole = null;
    }

    if (newRole === 'c1' || newRole === 'c2' || newRole === 'global') {
      targetUser.isCaller = true;
      targetUser.callerRole = newRole;
    } else {
      targetUser.isCaller = false;
      targetUser.callerRole = null;
    }

    // Persistir rol Caller en accounts.json si la cuenta está registrada
    const accountKey = targetUser.username.toLowerCase();
    if (accounts[accountKey]) {
      accounts[accountKey].isCaller = targetUser.isCaller;
      accounts[accountKey].callerRole = targetUser.callerRole;
      saveAccounts();
    }

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.emit('user:caller_role_changed', {
        isCaller: targetUser.isCaller,
        callerRole: targetUser.callerRole
      });
    }

    io.emit('user:updated', targetUser);
    io.emit('voice:state_update', getAllVoiceState());

    let noticeText = '';
    if (targetUser.callerRole === 'c1') {
      noticeText = `📢⚔️ ${socket.user.username} ha asignado el rol CALLER CAMPO 1 a ${targetUser.username}. ¡Su voz se transmitirá a todas las Partys de Campo 1!`;
    } else if (targetUser.callerRole === 'c2') {
      noticeText = `📢🛡️ ${socket.user.username} ha asignado el rol CALLER CAMPO 2 a ${targetUser.username}. ¡Su voz se transmitirá a todas las Partys de Campo 2!`;
    } else if (targetUser.callerRole === 'global') {
      noticeText = `📢⚡ ${socket.user.username} ha asignado el rol CALLER GLOBAL a ${targetUser.username}. ¡Su voz se transmitirá a todos los canales!`;
    } else {
      noticeText = `📢 ${socket.user.username} ha removido el rol de Caller a ${targetUser.username}.`;
    }

    const notice = {
      id: `sys-${Date.now()}`,
      sender: 'Sistema',
      senderColor: '#00B0F4',
      isSystem: true,
      text: noticeText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    if (!messages['text-general']) messages['text-general'] = [];
    messages['text-general'].push(notice);
    io.emit('chat:message', { channelId: 'text-general', message: notice });
  });

  // 10. Crear Canal
  socket.on('admin:create_channel', ({ name, type, userLimit }) => {
    if (!socket.user || (!socket.user.isAdmin && !socket.user.isMasterAdmin)) {
      return socket.emit('error:permission', 'Solo un administrador puede crear canales.');
    }

    const cleanName = (name || '').trim().toLowerCase().replace(/[^a-z0-9-_ áéíóú]/gi, '').substring(0, 30);
    if (!cleanName) return;

    const channelType = type === 'voice' ? 'voice' : 'text';
    const channelId = `${channelType}-${Date.now()}`;
    const limit = channelType === 'voice' ? (parseInt(userLimit, 10) || 0) : 0;

    const newChannel = {
      id: channelId,
      name: cleanName,
      type: channelType,
      userLimit: limit,
      description: channelType === 'voice' ? 'Canal de voz de SpecialDeliverySpeak' : 'Canal de texto'
    };

    channels.push(newChannel);
    if (channelType === 'text') {
      messages[channelId] = [];
    }
    saveChannels();

    io.emit('channel:created', newChannel);
    io.emit('voice:state_update', getAllVoiceState());
  });

  // 11. Eliminar Canal
  socket.on('admin:delete_channel', ({ channelId }) => {
    if (!socket.user || (!socket.user.isAdmin && !socket.user.isMasterAdmin)) {
      return socket.emit('error:permission', 'Solo un administrador puede eliminar canales.');
    }

    const channelIndex = channels.findIndex(c => c.id === channelId);
    if (channelIndex === -1) return;

    const deleted = channels.splice(channelIndex, 1)[0];
    saveChannels();

    if (deleted.type === 'voice') {
      for (const [sId, u] of users.entries()) {
        if (u.currentVoiceChannel === channelId) {
          u.currentVoiceChannel = null;
          u.isSpeaking = false;
          const s = io.sockets.sockets.get(sId);
          if (s) {
            s.leave(`voice:${channelId}`);
            s.emit('voice:channel_deleted');
          }
        }
      }
    }

    delete messages[channelId];
    io.emit('channel:deleted', { channelId });
    io.emit('voice:state_update', getAllVoiceState());
  });

  // 12. Expulsar de canal de voz
  socket.on('admin:kick_voice', ({ targetSocketId }) => {
    if (!socket.user || (!socket.user.isAdmin && !socket.user.isMasterAdmin)) {
      return socket.emit('error:permission', 'Solo un administrador puede expulsar de voz.');
    }

    const targetUser = users.get(targetSocketId);
    if (!targetUser || !targetUser.currentVoiceChannel) return;

    const oldChannelId = targetUser.currentVoiceChannel;
    targetUser.currentVoiceChannel = null;
    targetUser.isSpeaking = false;

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.leave(`voice:${oldChannelId}`);
      targetSocket.emit('voice:kicked_by_admin', { by: socket.user.username });
      targetSocket.to(`voice:${oldChannelId}`).emit('voice:peer_left', { socketId: targetSocketId });
    }

    io.emit('voice:state_update', getAllVoiceState());
    io.emit('user:updated', targetUser);
  });

  // ===================== CANALES DE VOZ (WebRTC) =====================

  socket.on('voice:join', ({ channelId }) => {
    if (!socket.user) return;

    const channel = channels.find(c => c.id === channelId && c.type === 'voice');
    if (!channel) return;

    const currentUsers = getVoiceChannelUsers(channelId);
    if (channel.userLimit > 0 && currentUsers.length >= channel.userLimit) {
      return socket.emit('voice:full_error', { message: 'El canal de voz está lleno.' });
    }

    if (socket.user.currentVoiceChannel) {
      const prevChan = socket.user.currentVoiceChannel;
      socket.leave(`voice:${prevChan}`);
      socket.to(`voice:${prevChan}`).emit('voice:peer_left', { socketId: socket.id });
    }

    socket.user.currentVoiceChannel = channelId;
    socket.user.isSpeaking = false;
    socket.join(`voice:${channelId}`);

    // 1. Participantes del mismo canal
    const existingPeers = currentUsers.map(u => ({
      socketId: u.id,
      user: u
    }));

    // 2. Transmisión para Callers (Campo 1, Campo 2 o Global):
    if (socket.user.isCaller) {
      for (const [sId, u] of users.entries()) {
        if (u.currentVoiceChannel && u.currentVoiceChannel !== channelId && sId !== socket.id) {
          if (shouldCallerReachUser(socket.user, u)) {
            existingPeers.push({ socketId: sId, user: u, isCallerBroadcast: true });
            const remSocket = io.sockets.sockets.get(sId);
            if (remSocket) {
              remSocket.emit('voice:peer_joined', {
                socketId: socket.id,
                user: socket.user
              });
            }
          }
        }
      }
    } else {
      // Si quien entra NO es Caller, conectar con Callers activos cuyo ámbito coincida
      for (const [sId, u] of users.entries()) {
        if (u.isCaller && u.currentVoiceChannel && u.currentVoiceChannel !== channelId && sId !== socket.id) {
          if (shouldCallerReachUser(u, socket.user)) {
            existingPeers.push({ socketId: sId, user: u, isCallerBroadcast: true });
            const remSocket = io.sockets.sockets.get(sId);
            if (remSocket) {
              remSocket.emit('voice:peer_joined', {
                socketId: socket.id,
                user: socket.user
              });
            }
          }
        }
      }
    }

    socket.emit('voice:joined_success', {
      channelId,
      channelName: channel.name,
      peers: existingPeers
    });

    socket.to(`voice:${channelId}`).emit('voice:peer_joined', {
      socketId: socket.id,
      user: socket.user
    });

    io.emit('voice:state_update', getAllVoiceState());
    io.emit('user:updated', socket.user);
  });

  socket.on('voice:leave', () => {
    if (!socket.user || !socket.user.currentVoiceChannel) return;

    const channelId = socket.user.currentVoiceChannel;
    socket.leave(`voice:${channelId}`);
    socket.user.currentVoiceChannel = null;
    socket.user.isSpeaking = false;

    if (socket.user.isCaller) {
      io.emit('voice:peer_left', { socketId: socket.id, wasCaller: true });
    } else {
      socket.to(`voice:${channelId}`).emit('voice:peer_left', { socketId: socket.id });
    }
    socket.emit('voice:left_success');

    io.emit('voice:state_update', getAllVoiceState());
    io.emit('user:updated', socket.user);
  });

  socket.on('voice:signal', ({ to, signal }) => {
    if (!socket.user) return;
    io.to(to).emit('voice:signal', {
      from: socket.id,
      user: socket.user,
      signal
    });
  });

  socket.on('voice:speaking', ({ isSpeaking }) => {
    if (!socket.user || !socket.user.currentVoiceChannel) return;
    socket.user.isSpeaking = !!isSpeaking;

    const role = socket.user.callerRole || (socket.user.isCaller ? 'global' : null);

    if (socket.user.isCaller && role) {
      // Emitir evento de habla solo a los sockets dentro del alcance del Caller
      for (const [sId, u] of users.entries()) {
        const targetSocket = io.sockets.sockets.get(sId);
        if (!targetSocket) continue;

        if (sId === socket.id || shouldCallerReachUser(socket.user, u) || (u.currentVoiceChannel === socket.user.currentVoiceChannel)) {
          targetSocket.emit('voice:user_speaking', {
            socketId: socket.id,
            isSpeaking: socket.user.isSpeaking,
            isCaller: true,
            callerRole: role,
            username: socket.user.username
          });
        }
      }
    } else {
      io.to(`voice:${socket.user.currentVoiceChannel}`).emit('voice:user_speaking', {
        socketId: socket.id,
        isSpeaking: socket.user.isSpeaking,
        isCaller: false,
        username: socket.user.username
      });
    }
  });

  socket.on('voice:toggle_state', ({ isMuted, isDeafened }) => {
    if (!socket.user) return;
    if (typeof isMuted === 'boolean') socket.user.isMuted = isMuted;
    if (typeof isDeafened === 'boolean') socket.user.isDeafened = isDeafened;

    if (socket.user.currentVoiceChannel) {
      const emitTarget = socket.user.isCaller ? io : io.to(`voice:${socket.user.currentVoiceChannel}`);
      emitTarget.emit('voice:user_state_changed', {
        socketId: socket.id,
        isMuted: socket.user.isMuted,
        isDeafened: socket.user.isDeafened
      });
      io.emit('voice:state_update', getAllVoiceState());
    }
  });

  // ===================== CHAT DE TEXTO =====================

  socket.on('chat:message', ({ channelId, text }) => {
    if (!socket.user) return;
    const cleanText = (text || '').trim().substring(0, 1000);
    if (!cleanText) return;

    if (!messages[channelId]) {
      messages[channelId] = [];
    }

    const newMsg = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      sender: socket.user.username,
      senderColor: socket.user.color,
      avatar: socket.user.avatar,
      isAdmin: socket.user.isAdmin,
      isMasterAdmin: socket.user.isMasterAdmin,
      isCaller: !!socket.user.isCaller,
      callerRole: socket.user.callerRole || null,
      text: cleanText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    messages[channelId].push(newMsg);
    if (messages[channelId].length > 150) {
      messages[channelId].shift();
    }

    io.emit('chat:message', { channelId, message: newMsg });
  });

  socket.on('disconnect', () => {
    if (socket.user) {
      if (socket.user.currentVoiceChannel) {
        if (socket.user.isCaller) {
          io.emit('voice:peer_left', { socketId: socket.id, wasCaller: true });
        } else {
          socket.to(`voice:${socket.user.currentVoiceChannel}`).emit('voice:peer_left', { socketId: socket.id });
        }
      }
      users.delete(socket.id);
      io.emit('user:left', { socketId: socket.id, username: socket.user.username });
      io.emit('voice:state_update', getAllVoiceState());
      console.log(`[Desconectado] ${socket.user.username} (${socket.id})`);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================================`);
  console.log(`📦🎙️ Servidor SpecialDeliverySpeak en http://localhost:${PORT}`);
  console.log(`👑⭐ Clave Master Admin: "${MASTER_ADMIN_PASSWORD}"`);
  console.log(`👑  Clave Admin Regular: "${ADMIN_PASSWORD}"`);
  console.log(`========================================================`);
});
