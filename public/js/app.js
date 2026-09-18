// =========================================================
// SpecialDeliverySpeak - Main Application Controller
// =========================================================

document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

  const voiceEngine = new VoiceEngine(socket);
  const adminManager = new AdminManager(socket);

  window.voiceEngine = voiceEngine;
  window.adminManager = adminManager;

  let myUser = null;
  let channels = [];
  let currentTextChannelId = 'text-general';
  let members = new Map(); // socketId -> user
  let voiceState = {}; // channelId -> array of users
  let messagesByChannel = {};

  // Elementos del DOM
  const loginOverlay = document.getElementById('login-overlay');
  const loginForm = document.getElementById('login-form');
  const inputUsername = document.getElementById('input-username');
  const checkIsAdmin = document.getElementById('check-is-admin');
  const groupAdminPass = document.getElementById('group-admin-pass');
  const inputLoginAdminPass = document.getElementById('input-login-admin-pass');

  // Pickers de Login
  let selectedAvatar = '📦';
  let selectedColor = '#5865F2';

  const avatarOpts = document.querySelectorAll('.avatar-opt');
  avatarOpts.forEach(btn => {
    btn.addEventListener('click', () => {
      avatarOpts.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedAvatar = btn.dataset.avatar;
    });
  });

  const colorOpts = document.querySelectorAll('.color-opt');
  colorOpts.forEach(btn => {
    btn.addEventListener('click', () => {
      colorOpts.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedColor = btn.dataset.color;
    });
  });

  if (checkIsAdmin && groupAdminPass) {
    checkIsAdmin.addEventListener('change', () => {
      if (checkIsAdmin.checked) {
        groupAdminPass.classList.remove('hidden');
        inputLoginAdminPass.setAttribute('required', 'true');
        inputLoginAdminPass.focus();
      } else {
        groupAdminPass.classList.add('hidden');
        inputLoginAdminPass.removeAttribute('required');
      }
    });
  }

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = inputUsername.value.trim();
    if (!username) return;

    socket.emit('user:join', {
      username,
      avatar: selectedAvatar,
      color: selectedColor
    });

    if (checkIsAdmin.checked && inputLoginAdminPass.value.trim()) {
      socket.emit('admin:login', { password: inputLoginAdminPass.value.trim() });
    }

    loginOverlay.classList.remove('active');
  });

  // ===================== ELEMENTOS DEL CHAT =====================
  const textChannelsContainer = document.getElementById('text-channels-list');
  const voiceChannelsContainer = document.getElementById('voice-channels-list');
  const messagesContainer = document.getElementById('messages-container');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const activeChannelTitle = document.getElementById('active-channel-title');
  const activeChannelDesc = document.getElementById('active-channel-desc');
  const membersListContainer = document.getElementById('members-list');
  const totalMembersCount = document.getElementById('total-members-count');

  // Controles inferiores
  const btnToggleMic = document.getElementById('btn-toggle-mic');
  const btnToggleDeafen = document.getElementById('btn-toggle-deafen');
  const btnToggleNoise = document.getElementById('btn-toggle-noise');
  const btnDisconnectVoice = document.getElementById('btn-disconnect-voice');
  const btnQuickSmile = document.getElementById('btn-quick-smile');

  // Modal de Invitación
  const btnInvite = document.getElementById('btn-invite');
  const modalInvite = document.getElementById('modal-invite');
  const btnCloseInvite = document.getElementById('btn-close-invite-modal');
  const btnCopyInvite = document.getElementById('btn-copy-invite');
  const inputInviteLink = document.getElementById('input-invite-link');
  const copyFeedback = document.getElementById('copy-feedback');

  if (btnInvite && modalInvite) {
    btnInvite.addEventListener('click', () => {
      inputInviteLink.value = window.location.href;
      copyFeedback.classList.add('hidden');
      modalInvite.classList.add('active');
    });

    if (btnCloseInvite) {
      btnCloseInvite.addEventListener('click', () => {
        modalInvite.classList.remove('active');
      });
    }

    if (btnCopyInvite && inputInviteLink) {
      btnCopyInvite.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(inputInviteLink.value);
          copyFeedback.classList.remove('hidden');
          setTimeout(() => copyFeedback.classList.add('hidden'), 3500);
        } catch (e) {
          inputInviteLink.select();
          document.execCommand('copy');
          copyFeedback.classList.remove('hidden');
        }
      });
    }
  }

  if (btnToggleMic) {
    btnToggleMic.addEventListener('click', () => voiceEngine.toggleMute());
  }
  if (btnToggleDeafen) {
    btnToggleDeafen.addEventListener('click', () => voiceEngine.toggleDeafen());
  }
  if (btnToggleNoise) {
    btnToggleNoise.addEventListener('click', () => voiceEngine.toggleNoiseSuppression());
  }
  if (btnDisconnectVoice) {
    btnDisconnectVoice.addEventListener('click', () => voiceEngine.leaveVoiceChannel(true));
  }
  if (btnQuickSmile && chatInput) {
    btnQuickSmile.addEventListener('click', () => {
      chatInput.value += ' 😄 ';
      chatInput.focus();
    });
  }

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !currentTextChannelId) return;

    socket.emit('chat:message', {
      channelId: currentTextChannelId,
      text
    });

    chatInput.value = '';
    chatInput.focus();
  });

  // ===================== SOCKET RECEIVERS =====================

  socket.on('init:state', (data) => {
    myUser = data.user;
    channels = data.channels || [];
    voiceState = data.voiceState || {};
    messagesByChannel = data.messages || {};

    members.clear();
    (data.users || []).forEach(u => members.set(u.id, u));

    updateUserDock();
    renderChannelsList();
    renderMembersList();

    const defaultChan = channels.find(c => c.type === 'text');
    if (defaultChan) {
      selectTextChannel(defaultChan.id);
    }
  });

  socket.on('user:joined', (user) => {
    members.set(user.id, user);
    renderMembersList();
  });

  socket.on('user:left', ({ socketId }) => {
    members.delete(socketId);
    renderMembersList();
    renderChannelsList();
  });

  socket.on('user:updated', (updatedUser) => {
    members.set(updatedUser.id, updatedUser);
    if (myUser && myUser.id === updatedUser.id) {
      myUser = updatedUser;
      updateUserDock();
    }
    renderMembersList();
    renderChannelsList();
  });

  socket.on('channel:created', (newChannel) => {
    channels.push(newChannel);
    if (newChannel.type === 'text') {
      messagesByChannel[newChannel.id] = [];
    }
    renderChannelsList();
  });

  socket.on('channel:deleted', ({ channelId }) => {
    channels = channels.filter(c => c.id !== channelId);
    delete messagesByChannel[channelId];

    if (currentTextChannelId === channelId) {
      const fallback = channels.find(c => c.type === 'text');
      if (fallback) selectTextChannel(fallback.id);
    }
    renderChannelsList();
  });

  socket.on('voice:state_update', (newVoiceState) => {
    voiceState = newVoiceState;
    renderChannelsList();
    renderMembersList();
  });

  socket.on('voice:user_speaking', ({ socketId, isSpeaking }) => {
    const avatarEls = document.querySelectorAll(`[data-voice-avatar-socket="${socketId}"]`);
    avatarEls.forEach(el => {
      if (isSpeaking) {
        el.classList.add('speaking');
      } else {
        el.classList.remove('speaking');
      }
    });
  });

  socket.on('chat:message', ({ channelId, message }) => {
    if (!messagesByChannel[channelId]) {
      messagesByChannel[channelId] = [];
    }
    messagesByChannel[channelId].push(message);

    if (currentTextChannelId === channelId) {
      appendChatMessage(message);
      scrollToBottom();
    }
  });

  // ===================== FUNCIONES DE RENDERIZADO =====================

  function updateUserDock() {
    if (!myUser) return;
    const avatarEl = document.getElementById('my-avatar');
    const nameEl = document.getElementById('my-username-display');
    const roleEl = document.getElementById('my-role-display');

    if (avatarEl) {
      avatarEl.textContent = myUser.avatar;
      avatarEl.style.backgroundColor = myUser.color + '25';
    }
    if (nameEl) {
      nameEl.textContent = myUser.username;
      nameEl.style.color = myUser.color;
      if (myUser.isMasterAdmin) {
        const crown = document.createElement('span');
        crown.className = 'master-admin-badge-crown';
        crown.textContent = '👑⭐';
        nameEl.appendChild(crown);
      } else if (myUser.isAdmin) {
        const crown = document.createElement('span');
        crown.className = 'admin-badge-crown';
        crown.textContent = '👑';
        nameEl.appendChild(crown);
      }
    }
    if (roleEl) {
      if (myUser.isMasterAdmin) {
        roleEl.textContent = '👑⭐ Super Admin';
        roleEl.style.color = '#FEE75C';
        roleEl.style.fontWeight = '800';
      } else if (myUser.isAdmin) {
        roleEl.textContent = '👑 Administrador';
        roleEl.style.color = '#57F287';
        roleEl.style.fontWeight = '700';
      } else {
        roleEl.textContent = 'Miembro';
        roleEl.style.color = 'var(--text-muted)';
        roleEl.style.fontWeight = 'normal';
      }
    }
  }

  function renderChannelsList() {
    textChannelsContainer.innerHTML = '';
    voiceChannelsContainer.innerHTML = '';

    // Canales de Texto
    channels.filter(c => c.type === 'text').forEach(chan => {
      const wrapper = document.createElement('div');
      wrapper.className = 'channel-item-wrapper';

      const item = document.createElement('div');
      item.className = `channel-item ${chan.id === currentTextChannelId ? 'active' : ''}`;

      const prefix = document.createElement('span');
      prefix.className = 'channel-prefix';
      prefix.textContent = '#';

      const title = document.createElement('span');
      title.className = 'channel-title';
      title.textContent = chan.name;

      item.appendChild(prefix);
      item.appendChild(title);

      if ((adminManager.isAdmin || adminManager.isMasterAdmin) && chan.id !== 'text-general') {
        const btnDelete = document.createElement('button');
        btnDelete.className = 'btn-delete-channel';
        btnDelete.innerHTML = '🗑️';
        btnDelete.title = 'Eliminar canal';
        btnDelete.addEventListener('click', (e) => {
          e.stopPropagation();
          adminManager.deleteChannel(chan.id, chan.name);
        });
        item.appendChild(btnDelete);
      }

      item.addEventListener('click', () => selectTextChannel(chan.id));

      wrapper.appendChild(item);
      textChannelsContainer.appendChild(wrapper);
    });

    // Canales de Voz (DSP HQ)
    channels.filter(c => c.type === 'voice').forEach(chan => {
      const wrapper = document.createElement('div');
      wrapper.className = 'channel-item-wrapper';

      const inThisChannel = voiceEngine.currentChannelId === chan.id;

      const item = document.createElement('div');
      item.className = `channel-item ${inThisChannel ? 'in-voice active' : ''}`;

      const prefix = document.createElement('span');
      prefix.className = 'channel-prefix';
      prefix.textContent = inThisChannel ? '🔊' : '🔈';

      const title = document.createElement('span');
      title.className = 'channel-title';
      title.textContent = chan.name;

      item.appendChild(prefix);
      item.appendChild(title);

      const activeVoiceUsers = voiceState[chan.id] || [];
      const limitBadge = document.createElement('span');
      limitBadge.className = 'channel-limit-badge';
      if (chan.userLimit > 0) {
        limitBadge.textContent = `${activeVoiceUsers.length}/${chan.userLimit}`;
      } else if (activeVoiceUsers.length > 0) {
        limitBadge.textContent = `${activeVoiceUsers.length}`;
      }
      if (chan.userLimit > 0 || activeVoiceUsers.length > 0) {
        item.appendChild(limitBadge);
      }

      if (adminManager.isAdmin || adminManager.isMasterAdmin) {
        const btnDelete = document.createElement('button');
        btnDelete.className = 'btn-delete-channel';
        btnDelete.innerHTML = '🗑️';
        btnDelete.title = 'Eliminar canal de voz';
        btnDelete.addEventListener('click', (e) => {
          e.stopPropagation();
          adminManager.deleteChannel(chan.id, chan.name);
        });
        item.appendChild(btnDelete);
      }

      item.addEventListener('click', () => {
        voiceEngine.joinVoiceChannel(chan.id, chan.name);
      });

      wrapper.appendChild(item);

      // Renderizar participantes del canal con volumen individual y moderación
      if (activeVoiceUsers.length > 0) {
        const usersList = document.createElement('div');
        usersList.className = 'voice-users-list';

        activeVoiceUsers.forEach(u => {
          const row = document.createElement('div');
          row.className = 'voice-user-row';

          const avatar = document.createElement('div');
          avatar.className = `voice-user-avatar ${u.isSpeaking ? 'speaking' : ''}`;
          avatar.dataset.voiceAvatarSocket = u.id;
          avatar.textContent = u.avatar;
          avatar.style.backgroundColor = u.color + '33';

          const name = document.createElement('span');
          name.className = 'voice-user-name';
          name.textContent = u.username;
          name.style.color = u.color;
          if (u.isMasterAdmin) {
            name.innerHTML += ' 👑⭐';
          } else if (u.isAdmin) {
            name.innerHTML += ' 👑';
          }

          const statusIcons = document.createElement('div');
          statusIcons.className = 'voice-user-status-icons';
          if (u.isMuted) statusIcons.innerHTML += '🎙️🚫';
          if (u.isDeafened) statusIcons.innerHTML += '🔇';

          row.appendChild(avatar);
          row.appendChild(name);
          row.appendChild(statusIcons);

          // Controles para otros usuarios (Volumen Individual + Moderación)
          if (u.id !== socket.id) {
            const controls = document.createElement('div');
            controls.className = 'voice-user-controls';

            // 1. Control de volumen individual (0% a 200%)
            const currentVol = voiceEngine.getUserVolume(u.id);
            const volWrap = document.createElement('div');
            volWrap.className = 'vol-slider-wrap';

            const volIcon = document.createElement('span');
            volIcon.textContent = '🔊';

            const volSlider = document.createElement('input');
            volSlider.type = 'range';
            volSlider.className = 'user-vol-slider';
            volSlider.min = '0';
            volSlider.max = '2';
            volSlider.step = '0.05';
            volSlider.value = currentVol;
            volSlider.title = `Volumen de ${u.username}`;

            const volLabel = document.createElement('span');
            volLabel.textContent = `${Math.round(currentVol * 100)}%`;

            volSlider.addEventListener('input', (e) => {
              e.stopPropagation();
              const newVol = parseFloat(volSlider.value);
              voiceEngine.setUserVolume(u.id, newVol);
              volLabel.textContent = `${Math.round(newVol * 100)}%`;
            });
            volSlider.addEventListener('click', (e) => e.stopPropagation());

            volWrap.appendChild(volIcon);
            volWrap.appendChild(volSlider);
            volWrap.appendChild(volLabel);
            controls.appendChild(volWrap);

            // 2. Acciones de Administrador regular y Master Admin
            if (adminManager.isAdmin || adminManager.isMasterAdmin) {
              // Mutear usuario en voz
              const btnMute = document.createElement('button');
              btnMute.className = 'btn-mod-action';
              btnMute.innerHTML = '🎙️🚫';
              btnMute.title = `Silenciar a ${u.username}`;
              btnMute.addEventListener('click', (e) => {
                e.stopPropagation();
                adminManager.muteVoiceUser(u.id, u.username);
              });
              controls.appendChild(btnMute);

              // Expulsar de la voz
              const btnKickVoice = document.createElement('button');
              btnKickVoice.className = 'btn-mod-action';
              btnKickVoice.innerHTML = '👢';
              btnKickVoice.title = `Desconectar a ${u.username} de la voz`;
              btnKickVoice.addEventListener('click', (e) => {
                e.stopPropagation();
                adminManager.kickVoiceUser(u.id, u.username);
              });
              controls.appendChild(btnKickVoice);
            }

            // 3. Acciones exclusivas del Administrador Maestro
            if (adminManager.isMasterAdmin && !u.isMasterAdmin) {
              // Promover / Degradar Administrador
              const btnPromote = document.createElement('button');
              btnPromote.className = 'btn-mod-action';
              btnPromote.innerHTML = u.isAdmin ? '🛡️❌' : '👑';
              btnPromote.title = u.isAdmin ? `Quitar Admin a ${u.username}` : `Hacer Administrador a ${u.username}`;
              btnPromote.addEventListener('click', (e) => {
                e.stopPropagation();
                adminManager.promoteUser(u.id, u.username, !u.isAdmin);
              });
              controls.appendChild(btnPromote);

              // Banear permanentemente
              const btnBan = document.createElement('button');
              btnBan.className = 'btn-mod-action action-ban';
              btnBan.innerHTML = '🚫';
              btnBan.title = `Banear permanentemente a ${u.username}`;
              btnBan.addEventListener('click', (e) => {
                e.stopPropagation();
                adminManager.banServerUser(u.id, u.username);
              });
              controls.appendChild(btnBan);
            }

            row.appendChild(controls);
          }

          usersList.appendChild(row);
        });

        wrapper.appendChild(usersList);
      }

      voiceChannelsContainer.appendChild(wrapper);
    });
  }
  window.renderChannelsList = renderChannelsList;

  function selectTextChannel(channelId) {
    currentTextChannelId = channelId;
    const chan = channels.find(c => c.id === channelId);
    if (chan) {
      activeChannelTitle.textContent = chan.name;
      activeChannelDesc.textContent = chan.description || '';
      chatInput.placeholder = `Enviar mensaje a #${chan.name}...`;
    }

    renderChannelsList();
    renderChatMessages();
  }

  function renderChatMessages() {
    messagesContainer.innerHTML = '';
    const msgs = messagesByChannel[currentTextChannelId] || [];
    msgs.forEach(appendChatMessage);
    scrollToBottom();
  }

  function appendChatMessage(msg) {
    const item = document.createElement('div');
    item.className = `message-item ${msg.isSystem ? 'system-msg' : ''}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = msg.avatar || '💬';
    avatar.style.backgroundColor = (msg.senderColor || '#5865F2') + '25';

    const content = document.createElement('div');
    content.className = 'message-content';

    const header = document.createElement('div');
    header.className = 'message-header';

    const sender = document.createElement('span');
    sender.className = 'message-sender';
    sender.textContent = msg.sender;
    sender.style.color = msg.senderColor || '#5865F2';

    header.appendChild(sender);

    if (msg.isMasterAdmin) {
      const badge = document.createElement('span');
      badge.className = 'admin-badge';
      badge.style.background = 'linear-gradient(135deg, #FEE75C, #F39C12)';
      badge.style.color = '#111';
      badge.textContent = '👑⭐ MASTER ADMIN';
      header.appendChild(badge);
    } else if (msg.isAdmin) {
      const badge = document.createElement('span');
      badge.className = 'admin-badge';
      badge.textContent = 'ADMIN';
      header.appendChild(badge);
    }

    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = msg.timestamp;
    header.appendChild(time);

    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = msg.text;

    content.appendChild(header);
    content.appendChild(text);

    item.appendChild(avatar);
    item.appendChild(content);

    messagesContainer.appendChild(item);
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function renderMembersList() {
    membersListContainer.innerHTML = '';
    totalMembersCount.textContent = members.size;

    const masterAdmins = [];
    const regularAdmins = [];
    const regularMembers = [];

    members.forEach(u => {
      if (u.isMasterAdmin) {
        masterAdmins.push(u);
      } else if (u.isAdmin) {
        regularAdmins.push(u);
      } else {
        regularMembers.push(u);
      }
    });

    const createMemberSection = (title, list) => {
      if (list.length === 0) return;

      const header = document.createElement('div');
      header.className = 'category-header';
      header.style.marginTop = '8px';
      header.textContent = `${title} — ${list.length}`;
      membersListContainer.appendChild(header);

      list.forEach(u => {
        const item = document.createElement('div');
        item.className = 'member-item';

        const avatar = document.createElement('div');
        avatar.className = 'member-avatar';
        avatar.textContent = u.avatar;
        avatar.style.backgroundColor = u.color + '33';

        const dot = document.createElement('span');
        dot.className = 'member-status-dot';
        avatar.appendChild(dot);

        const details = document.createElement('div');
        details.className = 'member-details';

        const nameRow = document.createElement('div');
        nameRow.className = 'member-name-row';

        const name = document.createElement('span');
        name.className = 'member-name';
        name.textContent = u.username;
        name.style.color = u.color;
        nameRow.appendChild(name);

        if (u.isMasterAdmin) {
          const crown = document.createElement('span');
          crown.className = 'master-admin-badge-crown';
          crown.textContent = '👑⭐';
          nameRow.appendChild(crown);
        } else if (u.isAdmin) {
          const crown = document.createElement('span');
          crown.className = 'admin-badge-crown';
          crown.textContent = '👑';
          nameRow.appendChild(crown);
        }

        const subtext = document.createElement('span');
        subtext.className = 'member-subtext';
        if (u.currentVoiceChannel) {
          const chan = channels.find(c => c.id === u.currentVoiceChannel);
          subtext.textContent = `En voz: ${chan ? chan.name : 'Voz'}`;
        } else {
          subtext.textContent = 'En línea';
        }

        details.appendChild(nameRow);
        details.appendChild(subtext);

        item.appendChild(avatar);
        item.appendChild(details);

        // Controles de moderación rápida en la lista de miembros para Master Admin
        if (adminManager.isMasterAdmin && u.id !== socket.id && !u.isMasterAdmin) {
          const quickActions = document.createElement('div');
          quickActions.style.display = 'flex';
          quickActions.style.gap = '2px';

          const btnRole = document.createElement('button');
          btnRole.className = 'btn-mod-action';
          btnRole.innerHTML = u.isAdmin ? '🛡️❌' : '👑';
          btnRole.title = u.isAdmin ? 'Quitar rango de Administrador' : 'Dar rango de Administrador';
          btnRole.addEventListener('click', () => {
            adminManager.promoteUser(u.id, u.username, !u.isAdmin);
          });

          const btnKick = document.createElement('button');
          btnKick.className = 'btn-mod-action';
          btnKick.innerHTML = '👢';
          btnKick.title = 'Expulsar del servidor';
          btnKick.addEventListener('click', () => {
            adminManager.kickServerUser(u.id, u.username);
          });

          const btnBan = document.createElement('button');
          btnBan.className = 'btn-mod-action action-ban';
          btnBan.innerHTML = '🚫';
          btnBan.title = 'Banear permanentemente';
          btnBan.addEventListener('click', () => {
            adminManager.banServerUser(u.id, u.username);
          });

          quickActions.appendChild(btnRole);
          quickActions.appendChild(btnKick);
          quickActions.appendChild(btnBan);
          item.appendChild(quickActions);
        }

        membersListContainer.appendChild(item);
      });
    };

    createMemberSection('👑⭐ SUPER ADMINISTRADOR', masterAdmins);
    createMemberSection('👑 ADMINISTRADORES', regularAdmins);
    createMemberSection('🟢 EN LÍNEA', regularMembers);
  }
  window.renderMembersList = renderMembersList;
});
