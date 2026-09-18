// =======================================================================
// SpecialDeliverySpeak - Main Application Controller & Auth System
// =======================================================================

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

  // ===================== SISTEMA DE CUENTAS & AUTO-LOGIN =====================
  const loginOverlay = document.getElementById('login-overlay');
  const tabBtnLogin = document.getElementById('tab-btn-login');
  const tabBtnRegister = document.getElementById('tab-btn-register');
  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');
  const loginErrorMsg = document.getElementById('login-error-msg');
  const regErrorMsg = document.getElementById('reg-error-msg');

  const loginUser = document.getElementById('login-user');
  const loginPass = document.getElementById('login-pass');
  const regUser = document.getElementById('reg-user');
  const regPass = document.getElementById('reg-pass');
  const regCheckAdmin = document.getElementById('reg-check-admin');
  const regGroupAdminPass = document.getElementById('reg-group-admin-pass');
  const regAdminPass = document.getElementById('reg-admin-pass');

  // Alternar pestañas
  tabBtnLogin.addEventListener('click', () => {
    tabBtnLogin.classList.add('active');
    tabBtnRegister.classList.remove('active');
    formLogin.classList.remove('hidden');
    formRegister.classList.add('hidden');
  });

  tabBtnRegister.addEventListener('click', () => {
    tabBtnRegister.classList.add('active');
    tabBtnLogin.classList.remove('active');
    formRegister.classList.remove('hidden');
    formLogin.classList.add('hidden');
  });

  if (regCheckAdmin && regGroupAdminPass) {
    regCheckAdmin.addEventListener('change', () => {
      if (regCheckAdmin.checked) {
        regGroupAdminPass.classList.remove('hidden');
        regAdminPass.focus();
      } else {
        regGroupAdminPass.classList.add('hidden');
      }
    });
  }

  // Pickers de Avatar y Color
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

  // 1. Enviar Login
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginErrorMsg.classList.add('hidden');
    const username = loginUser.value.trim();
    const password = loginPass.value.trim();
    if (!username || !password) return;

    // Intentar solicitar micrófono en el evento de clic del usuario
    try {
      await voiceEngine.initLocalMicrophone();
    } catch (err) {}

    socket.emit('auth:login', { username, password });
  });

  // 2. Enviar Registro
  formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    regErrorMsg.classList.add('hidden');
    const username = regUser.value.trim();
    const password = regPass.value.trim();
    const adminPass = regCheckAdmin.checked ? regAdminPass.value.trim() : null;

    if (!username || !password) return;

    // Intentar solicitar micrófono en el evento de clic del usuario
    try {
      await voiceEngine.initLocalMicrophone();
    } catch (err) {}

    socket.emit('auth:register', {
      username,
      password,
      avatar: selectedAvatar,
      color: selectedColor,
      adminPass
    });
  });

  // 3. Respuesta de Autenticación
  socket.on('auth:success', ({ user, token }) => {
    // Guardar token en localStorage para AUTO-LOGIN permanente
    if (token) {
      localStorage.setItem('sds_token', token);
    }
    loginOverlay.classList.remove('active');
  });

  socket.on('auth:error', ({ message }) => {
    if (!formLogin.classList.contains('hidden')) {
      loginErrorMsg.textContent = message;
      loginErrorMsg.classList.remove('hidden');
    } else {
      regErrorMsg.textContent = message;
      regErrorMsg.classList.remove('hidden');
    }
  });

  socket.on('auth:session_invalid', () => {
    localStorage.removeItem('sds_token');
    loginOverlay.classList.add('active');
  });

  // Cerrar Sesión
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      if (confirm('¿Deseas cerrar tu sesión en este dispositivo?')) {
        localStorage.removeItem('sds_token');
        window.location.reload();
      }
    });
  }

  // AUTO-LOGIN AL ENTRAR: Verificar si ya hay un token guardado en el navegador
  const savedToken = localStorage.getItem('sds_token');
  if (savedToken) {
    socket.emit('auth:verify_session', { token: savedToken });
  }

  // ===================== ELEMENTOS DEL CHAT =====================
  const dynamicCategoriesContainer = document.getElementById('dynamic-categories-container');
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
      btnCloseInvite.addEventListener('click', () => modalInvite.classList.remove('active'));
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

  // ===================== MODAL DE AJUSTES DE VOZ & VÚMETRO =====================
  const btnVoiceSettings = document.getElementById('btn-voice-settings');
  const modalVoiceSettings = document.getElementById('modal-voice-settings');
  const btnCloseVoiceSettings = document.getElementById('btn-close-voice-settings');

  const micMeterBar = document.getElementById('mic-meter-bar');
  const micMeterThresholdLine = document.getElementById('mic-meter-threshold-line');
  const sliderNoiseGate = document.getElementById('slider-noise-gate');
  const valNoiseGate = document.getElementById('val-noise-gate');

  const radioModeVad = document.getElementById('radio-mode-vad');
  const radioModePtt = document.getElementById('radio-mode-ptt');
  const pttKeybindContainer = document.getElementById('ptt-keybind-container');
  const btnAssignPttKey = document.getElementById('btn-assign-ptt-key');

  const btnDspProfiles = document.querySelectorAll('.btn-dsp-profile');
  const badgeActiveDsp = document.getElementById('badge-active-dsp');

  // Abrir / Cerrar modal de ajustes de voz
  if (btnVoiceSettings && modalVoiceSettings) {
    btnVoiceSettings.addEventListener('click', async () => {
      try {
        await voiceEngine.initLocalMicrophone();
      } catch (e) {}
      modalVoiceSettings.classList.add('active');
    });

    if (btnCloseVoiceSettings) {
      btnCloseVoiceSettings.addEventListener('click', () => {
        modalVoiceSettings.classList.remove('active');
      });
    }
  }

  // Actualización del vúmetro en vivo desde Web Audio
  voiceEngine.onVolumeMeter = (level, isSpeaking) => {
    if (micMeterBar) {
      micMeterBar.style.width = `${level}%`;
    }
  };

  // Puerta de ruido (Noise Gate Slider)
  const savedNoiseGate = localStorage.getItem('sds_noise_gate');
  if (savedNoiseGate) {
    const val = parseInt(savedNoiseGate, 10);
    voiceEngine.noiseGateThreshold = val;
    if (sliderNoiseGate) sliderNoiseGate.value = val;
    if (valNoiseGate) valNoiseGate.textContent = `${val}%`;
    if (micMeterThresholdLine) micMeterThresholdLine.style.left = `${val}%`;
  }

  if (sliderNoiseGate) {
    sliderNoiseGate.addEventListener('input', () => {
      const val = parseInt(sliderNoiseGate.value, 10);
      voiceEngine.noiseGateThreshold = val;
      valNoiseGate.textContent = `${val}%`;
      micMeterThresholdLine.style.left = `${val}%`;
      localStorage.setItem('sds_noise_gate', val);
    });
  }

  // Modos de transmisión: VAD vs PTT
  if (radioModeVad && radioModePtt) {
    radioModeVad.addEventListener('click', () => {
      radioModeVad.classList.add('selected');
      radioModePtt.classList.remove('selected');
      radioModeVad.querySelector('input').checked = true;
      pttKeybindContainer.classList.add('hidden');
      voiceEngine.voiceMode = 'vad';
    });

    radioModePtt.addEventListener('click', () => {
      radioModePtt.classList.add('selected');
      radioModeVad.classList.remove('selected');
      radioModePtt.querySelector('input').checked = true;
      pttKeybindContainer.classList.remove('hidden');
      voiceEngine.voiceMode = 'ptt';
      voiceEngine.handlePushToTalk(false);
    });
  }

  // Asignar tecla Push-to-Talk
  let isRecordingKey = false;
  if (btnAssignPttKey) {
    btnAssignPttKey.addEventListener('click', () => {
      isRecordingKey = true;
      btnAssignPttKey.classList.add('recording');
      btnAssignPttKey.textContent = 'Presiona una tecla...';
    });
  }

  window.addEventListener('keydown', (e) => {
    // Si está asignando la tecla PTT
    if (isRecordingKey) {
      e.preventDefault();
      voiceEngine.pttKey = e.code;
      btnAssignPttKey.textContent = e.code.replace('Key', '').replace('Digit', '');
      btnAssignPttKey.classList.remove('recording');
      isRecordingKey = false;
      return;
    }

    // Si está escribiendo en el chat o en un input, ignorar PTT
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      return;
    }

    // Si está en modo Push-to-Talk y presiona la tecla asignada
    if (voiceEngine.voiceMode === 'ptt' && (e.code === voiceEngine.pttKey || (voiceEngine.pttKey === 'Space' && e.code === 'Space'))) {
      if (!e.repeat) {
        if (e.code === 'Space') e.preventDefault();
        voiceEngine.handlePushToTalk(true);
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (voiceEngine.voiceMode === 'ptt' && (e.code === voiceEngine.pttKey || (voiceEngine.pttKey === 'Space' && e.code === 'Space'))) {
      voiceEngine.handlePushToTalk(false);
    }
  });

  // Selector de perfiles DSP
  btnDspProfiles.forEach(btn => {
    btn.addEventListener('click', () => {
      btnDspProfiles.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const profile = btn.dataset.profile;
      voiceEngine.setDspProfile(profile);

      if (badgeActiveDsp) {
        badgeActiveDsp.textContent = `✨ ${profile.toUpperCase()}`;
      }
    });
  });

  // Botones de prueba de efectos sonoros de Discord
  const btnTestJoin = document.getElementById('btn-test-join');
  const btnTestLeave = document.getElementById('btn-test-leave');
  const btnTestMsg = document.getElementById('btn-test-msg');
  const btnTestMute = document.getElementById('btn-test-mute');
  const btnTestUnmute = document.getElementById('btn-test-unmute');

  if (btnTestJoin) btnTestJoin.addEventListener('click', () => voiceEngine.playFeedbackTone('join'));
  if (btnTestLeave) btnTestLeave.addEventListener('click', () => voiceEngine.playFeedbackTone('leave'));
  if (btnTestMsg) btnTestMsg.addEventListener('click', () => voiceEngine.playFeedbackTone('message'));
  if (btnTestMute) btnTestMute.addEventListener('click', () => voiceEngine.playFeedbackTone('mute'));
  if (btnTestUnmute) btnTestUnmute.addEventListener('click', () => voiceEngine.playFeedbackTone('unmute'));

  // Botón y Modal de Ayuda para Micrófono
  const modalMicGuide = document.getElementById('modal-mic-guide');
  const btnCloseMicGuide = document.getElementById('btn-close-mic-guide');
  const btnRetryMic = document.getElementById('btn-retry-mic');
  const btnRequestMic = document.getElementById('btn-request-mic');

  if (btnRequestMic) {
    btnRequestMic.addEventListener('click', async () => {
      try {
        await voiceEngine.initLocalMicrophone();
      } catch (err) {
        if (modalMicGuide) modalMicGuide.classList.add('active');
      }
    });
  }

  if (btnCloseMicGuide && modalMicGuide) {
    btnCloseMicGuide.addEventListener('click', () => modalMicGuide.classList.remove('active'));
  }

  if (btnRetryMic) {
    btnRetryMic.addEventListener('click', async () => {
      try {
        await voiceEngine.initLocalMicrophone();
        if (modalMicGuide) modalMicGuide.classList.remove('active');
      } catch (err) {
        alert('El navegador aún no permite el micrófono. Haz clic en el icono 🔒 del candado en la barra URL de tu navegador y pon "Permitir", luego pulsa aquí de nuevo.');
      }
    });
  }

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

  // ILUMINACIÓN EN VERDE NEÓN DE AVATAR Y NOMBRE AL HABLAR
  socket.on('voice:user_speaking', ({ socketId, isSpeaking }) => {
    // Iluminar avatar en canal de voz
    const avatarEls = document.querySelectorAll(`[data-voice-avatar-socket="${socketId}"]`);
    avatarEls.forEach(el => {
      if (isSpeaking) el.classList.add('speaking');
      else el.classList.remove('speaking');
    });

    // Iluminar NOMBRE en canal de voz
    const voiceNameEls = document.querySelectorAll(`[data-voice-name-socket="${socketId}"]`);
    voiceNameEls.forEach(el => {
      if (isSpeaking) el.classList.add('speaking');
      else el.classList.remove('speaking');
    });

    // Iluminar NOMBRE en la barra lateral de miembros
    const memberNameEls = document.querySelectorAll(`[data-member-name-socket="${socketId}"]`);
    memberNameEls.forEach(el => {
      if (isSpeaking) el.classList.add('speaking');
      else el.classList.remove('speaking');
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

    // Sonido sutil de mensaje nuevo si no fue enviado por mí
    if (myUser && message.sender !== myUser.username) {
      voiceEngine.playMessageTone();
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

  const collapsedCategories = new Set();

  function renderChannelsList() {
    if (!dynamicCategoriesContainer) {
      if (textChannelsContainer) textChannelsContainer.innerHTML = '';
      if (voiceChannelsContainer) voiceChannelsContainer.innerHTML = '';
      return;
    }

    dynamicCategoriesContainer.innerHTML = '';

    // Agrupar canales por categoría (General -> Campo 1 -> Campo 2 -> otras)
    const categoryNames = ['General', 'Campo 1', 'Campo 2'];
    channels.forEach(c => {
      const cat = c.category || (c.type === 'text' ? 'General' : 'Salas de Voz');
      if (!categoryNames.includes(cat)) {
        categoryNames.push(cat);
      }
    });

    const categoryIcons = {
      'General': '💬 CANAL GENERAL / TEXTO',
      'Campo 1': '⚔️ CAMPO 1 (8 PARTIES)',
      'Campo 2': '🛡️ CAMPO 2 (8 PARTIES)'
    };

    categoryNames.forEach(catName => {
      const catChannels = channels.filter(c => {
        const cat = c.category || (c.type === 'text' ? 'General' : 'Salas de Voz');
        return cat === catName;
      });

      if (catChannels.length === 0) return;

      const isCollapsed = collapsedCategories.has(catName);

      const catBlock = document.createElement('div');
      catBlock.className = 'channel-category';
      catBlock.dataset.category = catName;

      const header = document.createElement('div');
      header.className = `category-header ${isCollapsed ? 'collapsed' : ''}`;

      const arrow = document.createElement('span');
      arrow.className = 'category-arrow';
      arrow.textContent = isCollapsed ? '▶' : '▼';

      const title = document.createElement('span');
      title.className = 'category-name';
      title.textContent = categoryIcons[catName] || `📁 ${catName.toUpperCase()}`;

      header.appendChild(arrow);
      header.appendChild(title);

      if (adminManager.isAdmin || adminManager.isMasterAdmin) {
        const btnAdd = document.createElement('button');
        btnAdd.className = 'btn-add-channel admin-only';
        btnAdd.textContent = '+';
        btnAdd.title = `Crear canal en ${catName}`;
        btnAdd.addEventListener('click', (e) => {
          e.stopPropagation();
          const modalCreate = document.getElementById('modal-create-channel');
          if (modalCreate) modalCreate.classList.add('active');
        });
        header.appendChild(btnAdd);
      }

      header.addEventListener('click', () => {
        if (collapsedCategories.has(catName)) {
          collapsedCategories.delete(catName);
        } else {
          collapsedCategories.add(catName);
        }
        renderChannelsList();
      });

      const listContainer = document.createElement('div');
      listContainer.className = `channels-list ${isCollapsed ? 'collapsed' : ''}`;

      // 1. Primero canales de texto
      catChannels.filter(c => c.type === 'text').forEach(chan => {
        const wrapper = document.createElement('div');
        wrapper.className = 'channel-item-wrapper';

        const item = document.createElement('div');
        item.className = `channel-item ${chan.id === currentTextChannelId ? 'active' : ''}`;

        const prefix = document.createElement('span');
        prefix.className = 'channel-prefix';
        prefix.textContent = '#';

        const cTitle = document.createElement('span');
        cTitle.className = 'channel-title';
        cTitle.textContent = chan.name;

        item.appendChild(prefix);
        item.appendChild(cTitle);

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
        listContainer.appendChild(wrapper);
      });

      // 2. Luego canales de voz (Parties)
      catChannels.filter(c => c.type === 'voice').forEach(chan => {
        const wrapper = document.createElement('div');
        wrapper.className = 'channel-item-wrapper';

        const inThisChannel = voiceEngine.currentChannelId === chan.id;

        const item = document.createElement('div');
        item.className = `channel-item ${inThisChannel ? 'in-voice active' : ''}`;

        const prefix = document.createElement('span');
        prefix.className = 'channel-prefix';
        prefix.textContent = inThisChannel ? '🔊' : '🔈';

        const cTitle = document.createElement('span');
        cTitle.className = 'channel-title';
        cTitle.textContent = chan.name;

        item.appendChild(prefix);
        item.appendChild(cTitle);

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

        // Participantes activos en la Party
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
            name.className = `voice-user-name ${u.isSpeaking ? 'speaking' : ''}`;
            name.dataset.voiceNameSocket = u.id;
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

            // Controles de audio individuales
            if (u.id !== socket.id) {
              const controls = document.createElement('div');
              controls.className = 'voice-user-controls';

              // 1. Slider de Volumen (0% a 200%)
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

              // 2. Slider de Paneo Estéreo (Audio Espacial)
              const currentPan = voiceEngine.getUserPan(u.id);
              const panWrap = document.createElement('div');
              panWrap.className = 'pan-slider-wrap';
              panWrap.title = `Ubicación estéreo de ${u.username} (Izquierda / Derecha)`;

              const panIcon = document.createElement('span');
              panIcon.textContent = '🎧';

              const panSlider = document.createElement('input');
              panSlider.type = 'range';
              panSlider.className = 'user-pan-slider';
              panSlider.min = '-1';
              panSlider.max = '1';
              panSlider.step = '0.1';
              panSlider.value = currentPan;

              panSlider.addEventListener('input', (e) => {
                e.stopPropagation();
                voiceEngine.setUserPan(u.id, panSlider.value);
              });
              panSlider.addEventListener('click', (e) => e.stopPropagation());

              panWrap.appendChild(panIcon);
              panWrap.appendChild(panSlider);
              controls.appendChild(panWrap);

              // 3. Moderación
              if (adminManager.isAdmin || adminManager.isMasterAdmin) {
                const btnMute = document.createElement('button');
                btnMute.className = 'btn-mod-action';
                btnMute.innerHTML = '🎙️🚫';
                btnMute.title = `Silenciar a ${u.username}`;
                btnMute.addEventListener('click', (e) => {
                  e.stopPropagation();
                  adminManager.muteVoiceUser(u.id, u.username);
                });
                controls.appendChild(btnMute);

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

              if (adminManager.isMasterAdmin && !u.isMasterAdmin) {
                const btnPromote = document.createElement('button');
                btnPromote.className = 'btn-mod-action';
                btnPromote.innerHTML = u.isAdmin ? '🛡️❌' : '👑';
                btnPromote.title = u.isAdmin ? `Quitar Admin a ${u.username}` : `Hacer Administrador a ${u.username}`;
                btnPromote.addEventListener('click', (e) => {
                  e.stopPropagation();
                  adminManager.promoteUser(u.id, u.username, !u.isAdmin);
                });
                controls.appendChild(btnPromote);

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

        listContainer.appendChild(wrapper);
      });

      catBlock.appendChild(header);
      catBlock.appendChild(listContainer);
      dynamicCategoriesContainer.appendChild(catBlock);
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
        name.className = `member-name ${u.isSpeaking ? 'speaking' : ''}`;
        name.dataset.memberNameSocket = u.id;
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
