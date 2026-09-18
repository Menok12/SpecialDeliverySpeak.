require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
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

app.use(express.static(path.join(__dirname, 'public')));

// Estado de canales iniciales
let channels = [
  { id: 'text-general', name: 'general', type: 'text', description: 'Canal general de SpecialDeliverySpeak' },
  { id: 'text-memes', name: 'memes-y-clips', type: 'text', description: 'Comparte memes, música y clips' },
  { id: 'voice-lounge', name: 'Sala de Charla', type: 'voice', userLimit: 0 },
  { id: 'voice-gaming', name: 'Sala Gaming', type: 'voice', userLimit: 6 },
  { id: 'voice-private', name: 'Entrega Especial / VIP', type: 'voice', userLimit: 4 }
];

// Mapa de socketId -> Usuario
const users = new Map();

// Listas de usuarios y direcciones IP baneadas
const bannedIPs = new Set();
const bannedUsers = new Set();

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

io.on('connection', (socket) => {
  const clientIP = getClientIP(socket);

  // Verificar baneo por IP inmediatamente (ignorando loopback/localhost del host)
  if (clientIP && !isLoopbackIP(clientIP) && bannedIPs.has(clientIP)) {
    console.log(`[Baneo Rechazado] Conexión rechazada por IP baneada: ${clientIP}`);
    socket.emit('user:banned_error', { reason: 'Has sido baneado de SpecialDeliverySpeak.' });
    return socket.disconnect(true);
  }

  // 1. Registro de usuario
  socket.on('user:join', ({ username, avatar, color }) => {
    const cleanUsername = (username || 'Amigo').trim().substring(0, 24);

    // Verificar si el apodo está baneado
    if (bannedUsers.has(cleanUsername.toLowerCase())) {
      socket.emit('user:banned_error', { reason: 'Este apodo o usuario ha sido baneado permanentemente.' });
      return socket.disconnect(true);
    }

    const user = {
      id: socket.id,
      username: cleanUsername,
      avatar: avatar || '📦',
      color: color || '#5865F2',
      isAdmin: false,
      isMasterAdmin: false,
      ip: clientIP,
      currentVoiceChannel: null,
      isMuted: false,
      isDeafened: false,
      isSpeaking: false
    };

    users.set(socket.id, user);
    socket.user = user;

    socket.emit('init:state', {
      user,
      channels,
      users: Array.from(users.values()),
      voiceState: getAllVoiceState(),
      messages
    });

    socket.broadcast.emit('user:joined', user);
    console.log(`[Usuario Registrado] ${cleanUsername} (${socket.id}) desde ${clientIP}`);
  });

  // 2. Autenticación de Administrador (Maestro o Regular)
  socket.on('admin:login', ({ password }) => {
    if (!socket.user) return;

    if (password === MASTER_ADMIN_PASSWORD) {
      socket.user.isMasterAdmin = true;
      socket.user.isAdmin = true;
      socket.emit('admin:login_success', { isAdmin: true, isMasterAdmin: true });
      io.emit('user:updated', socket.user);
      io.emit('voice:state_update', getAllVoiceState());

      const adminNotice = {
        id: `sys-${Date.now()}`,
        sender: 'Sistema',
        senderColor: '#FEE75C',
        isSystem: true,
        text: `👑⭐ ${socket.user.username} ha iniciado sesión como Administrador Maestro de SpecialDeliverySpeak.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      if (!messages['text-general']) messages['text-general'] = [];
      messages['text-general'].push(adminNotice);
      io.emit('chat:message', { channelId: 'text-general', message: adminNotice });

      console.log(`[Admin Maestro] ${socket.user.username} (${socket.id}) autenticado como MASTER ADMIN`);
    } else if (password === ADMIN_PASSWORD) {
      socket.user.isAdmin = true;
      socket.user.isMasterAdmin = false;
      socket.emit('admin:login_success', { isAdmin: true, isMasterAdmin: false });
      io.emit('user:updated', socket.user);
      io.emit('voice:state_update', getAllVoiceState());

      const adminNotice = {
        id: `sys-${Date.now()}`,
        sender: 'Sistema',
        senderColor: '#ED4245',
        isSystem: true,
        text: `👑 ${socket.user.username} ha iniciado sesión como Administrador.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      if (!messages['text-general']) messages['text-general'] = [];
      messages['text-general'].push(adminNotice);
      io.emit('chat:message', { channelId: 'text-general', message: adminNotice });

      console.log(`[Admin Regular] ${socket.user.username} (${socket.id}) autenticado como ADMIN`);
    } else {
      socket.emit('admin:login_failed', { message: 'Contraseña de administrador incorrecta' });
    }
  });

  // 3. Ascender o Degradar Administrador (Solo Administrador Maestro)
  socket.on('admin:promote_user', ({ targetSocketId, makeAdmin }) => {
    if (!socket.user || !socket.user.isMasterAdmin) {
      return socket.emit('error:permission', 'Solo el Administrador Maestro puede otorgar o quitar el rol de administrador.');
    }

    const targetUser = users.get(targetSocketId);
    if (!targetUser) return;

    // No se puede modificar el rol del propio Master Admin
    if (targetUser.isMasterAdmin) return;

    targetUser.isAdmin = !!makeAdmin;

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

    console.log(`[Promoción] ${targetUser.username} isAdmin=${makeAdmin} por ${socket.user.username}`);
  });

  // 4. Expulsar Usuario del Servidor (Kick)
  socket.on('admin:kick_user', ({ targetSocketId }) => {
    if (!socket.user || (!socket.user.isAdmin && !socket.user.isMasterAdmin)) {
      return socket.emit('error:permission', 'No tienes permisos para expulsar usuarios.');
    }

    const targetUser = users.get(targetSocketId);
    if (!targetUser) return;

    // No se puede expulsar al Administrador Maestro
    if (targetUser.isMasterAdmin) {
      return socket.emit('error:permission', 'No puedes expulsar al Administrador Maestro.');
    }

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.emit('user:kicked_by_admin', { by: socket.user.username });
      targetSocket.disconnect(true);
    }

    console.log(`[Kick Servidor] ${targetUser.username} expulsado por ${socket.user.username}`);
  });

  // 5. Banear Usuario del Servidor (Ban) - Solo Administrador Maestro
  socket.on('admin:ban_user', ({ targetSocketId, reason }) => {
    if (!socket.user || !socket.user.isMasterAdmin) {
      return socket.emit('error:permission', 'Solo el Administrador Maestro puede banear usuarios.');
    }

    const targetUser = users.get(targetSocketId);
    if (!targetUser) return;

    if (targetUser.isMasterAdmin) {
      return socket.emit('error:permission', 'No puedes banear al Administrador Maestro.');
    }

    // Registrar en listas de baneo (evitando banear el host local)
    if (targetUser.ip && !isLoopbackIP(targetUser.ip)) {
      bannedIPs.add(targetUser.ip);
    }
    bannedUsers.add(targetUser.username.toLowerCase());

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

    console.log(`[Ban Servidor] ${targetUser.username} (${targetUser.ip}) baneado por ${socket.user.username}`);
  });

  // 6. Mutear Usuario en Servidor (Server Mute)
  socket.on('admin:mute_user', ({ targetSocketId }) => {
    if (!socket.user || (!socket.user.isAdmin && !socket.user.isMasterAdmin)) {
      return socket.emit('error:permission', 'No tienes permisos para silenciar usuarios.');
    }

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.emit('voice:force_muted_by_admin', { by: socket.user.username });
    }
  });

  // 7. Crear Canal (Admin o Master Admin)
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

    io.emit('channel:created', newChannel);
    io.emit('voice:state_update', getAllVoiceState());

    console.log(`[Canal Creado] ${newChannel.name} (${newChannel.type}) por ${socket.user.username}`);
  });

  // 8. Eliminar Canal (Admin o Master Admin)
  socket.on('admin:delete_channel', ({ channelId }) => {
    if (!socket.user || (!socket.user.isAdmin && !socket.user.isMasterAdmin)) {
      return socket.emit('error:permission', 'Solo un administrador puede eliminar canales.');
    }

    const channelIndex = channels.findIndex(c => c.id === channelId);
    if (channelIndex === -1) return;

    const deleted = channels.splice(channelIndex, 1)[0];

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
    console.log(`[Canal Eliminado] ${deleted.name}`);
  });

  // 9. Expulsar de canal de voz (Admin Kick Voice)
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

    const existingPeers = currentUsers.map(u => ({
      socketId: u.id,
      user: u
    }));

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
    console.log(`[Voz] ${socket.user.username} se unió a ${channel.name}`);
  });

  socket.on('voice:leave', () => {
    if (!socket.user || !socket.user.currentVoiceChannel) return;

    const channelId = socket.user.currentVoiceChannel;
    socket.leave(`voice:${channelId}`);
    socket.user.currentVoiceChannel = null;
    socket.user.isSpeaking = false;

    socket.to(`voice:${channelId}`).emit('voice:peer_left', { socketId: socket.id });
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
    io.to(`voice:${socket.user.currentVoiceChannel}`).emit('voice:user_speaking', {
      socketId: socket.id,
      isSpeaking: socket.user.isSpeaking
    });
  });

  socket.on('voice:toggle_state', ({ isMuted, isDeafened }) => {
    if (!socket.user) return;
    if (typeof isMuted === 'boolean') socket.user.isMuted = isMuted;
    if (typeof isDeafened === 'boolean') socket.user.isDeafened = isDeafened;

    if (socket.user.currentVoiceChannel) {
      io.to(`voice:${socket.user.currentVoiceChannel}`).emit('voice:user_state_changed', {
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
        socket.to(`voice:${socket.user.currentVoiceChannel}`).emit('voice:peer_left', { socketId: socket.id });
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
