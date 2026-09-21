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

  // ===================== SISTEMA DE ACTUALIZACIÓN EN VIVO =====================
  const CURRENT_APP_VERSION = '1.3.0';
  let isUpdateBannerDismissed = false;

  const updateBanner = document.getElementById('update-notification-banner');
  const updateVersionLabel = document.getElementById('update-version-label');
  const btnUpdateReload = document.getElementById('btn-update-reload');
  const btnUpdateDownload = document.getElementById('btn-update-download');
  const btnUpdateDismiss = document.getElementById('btn-update-dismiss');

  function showUpdateNotification(newVersion, downloadUrl) {
    if (isUpdateBannerDismissed) return;
    if (!updateBanner) return;

    if (updateVersionLabel && newVersion) {
      updateVersionLabel.textContent = 'v' + newVersion;
    }

    if (btnUpdateDownload && downloadUrl) {
      btnUpdateDownload.href = downloadUrl;
      btnUpdateDownload.classList.remove('hidden');
    }

    updateBanner.classList.remove('hidden');
  }

  if (btnUpdateReload) {
    btnUpdateReload.addEventListener('click', () => {
      btnUpdateReload.disabled = true;
      btnUpdateReload.textContent = '⚡ Actualizando...';
      try {
        if ('caches' in window) {
          caches.keys().then(names => {
            for (let name of names) caches.delete(name);
          });
        }
      } catch (e) {}
      setTimeout(() => {
        window.location.reload(true);
      }, 250);
    });
  }

  if (btnUpdateDismiss) {
    btnUpdateDismiss.addEventListener('click', () => {
      isUpdateBannerDismissed = true;
      if (updateBanner) updateBanner.classList.add('hidden');
    });
  }

  async function checkForUpdates() {
    try {
      const res = await fetch('/api/version?t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        if (data.version && data.version !== CURRENT_APP_VERSION) {
          showUpdateNotification(data.version, data.downloadUrl);
        }
      }
    } catch (e) {}
  }

  setInterval(checkForUpdates, 120000);

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

  const selectMicDevice = document.getElementById('select-mic-device');
  const btnTestMicLoopback = document.getElementById('btn-test-mic-loopback');

  async function populateMicDevices() {
    if (!selectMicDevice) return;
    try {
      const devices = await voiceEngine.getAudioDevices();
      selectMicDevice.innerHTML = '';
      if (devices.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Micrófono por defecto del sistema';
        selectMicDevice.appendChild(opt);
        return;
      }
      devices.forEach((d, idx) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `Micrófono ${idx + 1}`;
        if (voiceEngine.selectedDeviceId === d.deviceId) opt.selected = true;
        selectMicDevice.appendChild(opt);
      });
    } catch (e) {}
  }

  if (selectMicDevice) {
    selectMicDevice.addEventListener('change', async () => {
      const devId = selectMicDevice.value;
      if (devId) {
        await voiceEngine.initLocalMicrophone(devId);
      }
    });
  }

  if (btnTestMicLoopback) {
    btnTestMicLoopback.addEventListener('click', async () => {
      try {
        await voiceEngine.initLocalMicrophone();
        const active = voiceEngine.toggleMicLoopback();
        if (active) {
          btnTestMicLoopback.textContent = '🔴 Dejar de escuchar (Prueba Activa)';
          btnTestMicLoopback.classList.add('btn-primary');
          btnTestMicLoopback.classList.remove('btn-secondary');
        } else {
          btnTestMicLoopback.textContent = '🎧 Probar Micrófono (Escuchar mi propia voz)';
          btnTestMicLoopback.classList.remove('btn-primary');
          btnTestMicLoopback.classList.add('btn-secondary');
        }
      } catch (e) {
        alert('🎧 No se pudo activar la prueba. Por favor, asegúrate de que tus auriculares con micrófono estén conectados a la computadora.');
      }
    });
  }

  // Abrir / Cerrar modal de ajustes de voz
  if (btnVoiceSettings && modalVoiceSettings) {
    btnVoiceSettings.addEventListener('click', async () => {
      if (voiceEngine.audioContext && voiceEngine.audioContext.state === 'suspended') {
        await voiceEngine.audioContext.resume();
      }
      try {
        await voiceEngine.initLocalMicrophone();
      } catch (e) {}
      await populateMicDevices();
      modalVoiceSettings.classList.add('active');
    });

    if (btnCloseVoiceSettings) {
      btnCloseVoiceSettings.addEventListener('click', () => {
        voiceEngine.toggleMicLoopback(false);
        if (btnTestMicLoopback) {
          btnTestMicLoopback.textContent = '🎧 Probar Micrófono (Escuchar mi propia voz)';
          btnTestMicLoopback.classList.remove('btn-primary');
          btnTestMicLoopback.classList.add('btn-secondary');
        }
        modalVoiceSettings.classList.remove('active');
      });
    }
  }

  // Auto-resume global de AudioContext en cualquier interacción del usuario
  window.addEventListener('click', () => {
    if (voiceEngine.audioContext && voiceEngine.audioContext.state === 'suspended') {
      voiceEngine.audioContext.resume().catch(() => {});
    }
  });

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

  function handleMicError(err) {
    const isElectron = /Electron/i.test(navigator.userAgent);
    if (err && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError')) {
      alert('🎧 No se detectó ningún micrófono conectado a tu computadora.\n\nPor favor, conecta tus auriculares con micrófono o micrófono USB a la PC para poder hablar.');
    } else if (isElectron) {
      alert('No se pudo acceder al micrófono. Por favor, asegúrate de que tus auriculares o micrófono estén conectados a la PC.');
    } else {
      if (modalMicGuide) modalMicGuide.classList.add('active');
    }
  }

  if (btnRequestMic) {
    btnRequestMic.addEventListener('click', async () => {
      try {
        await voiceEngine.initLocalMicrophone();
      } catch (err) {
        handleMicError(err);
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
        handleMicError(err);
      }
    });
  }

  // ===================== SOCKET RECEIVERS =====================

  socket.on('init:state', (data) => {
    myUser = data.user;
    if (myUser) {
      window.myUser = myUser;
      if (adminManager) {
        adminManager.updateAdminState(myUser);
      }
    }
    channels = data.channels || [];
    voiceState = data.voiceState || {};
    messagesByChannel = data.messages || {};

    members.clear();
    (data.users || []).forEach(u => members.set(u.id, u));

    updateUserDock();
    renderChannelsList();
    renderMembersList();
    renderVoiceStage();

    const defaultChan = channels.find(c => c.type === 'text');
    if (defaultChan) {
      selectTextChannel(defaultChan.id);
    }

    // Verificar si hay versión nueva reportada por el servidor
    if (data.appVersion && data.appVersion !== CURRENT_APP_VERSION) {
      showUpdateNotification(data.appVersion, data.downloadUrl);
    }
  });

  socket.on('app:version_updated', (data) => {
    if (data && data.version && data.version !== CURRENT_APP_VERSION) {
      showUpdateNotification(data.version, data.downloadUrl);
    }
  });

  socket.on('user:joined', (user) => {
    members.set(user.id, user);
    renderMembersList();
    renderChannelsList();
    renderVoiceStage();
  });

  socket.on('user:left', ({ socketId }) => {
    members.delete(socketId);
    renderMembersList();
    renderChannelsList();
    renderVoiceStage();
  });

  socket.on('user:updated', (updatedUser) => {
    members.set(updatedUser.id, updatedUser);
    if (myUser && (myUser.id === updatedUser.id || myUser.username === updatedUser.username)) {
      myUser = updatedUser;
      window.myUser = myUser;
      if (adminManager) {
        adminManager.updateAdminState(myUser);
      }
      updateUserDock();
    }
    renderMembersList();
    renderChannelsList();
    renderVoiceStage();
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
    renderVoiceStage();
  });

  // ILUMINACIÓN EN VERDE NEÓN (O COLOR ESPECIAL DE CALLER) AL HABLAR
  socket.on('voice:user_speaking', ({ socketId, isSpeaking, isCaller, callerRole, username }) => {
    // Banner en pantalla si habla un Caller
    const callerBanner = document.getElementById('caller-broadcast-banner');
    const callerBannerName = document.getElementById('caller-banner-name');
    const callerBannerTarget = document.getElementById('caller-banner-target');
    const callerAnimIcon = document.getElementById('caller-anim-icon');

    if (callerBanner && callerBannerName) {
      if (isCaller && isSpeaking) {
        callerBannerName.textContent = username || 'Caller';
        if (callerRole === 'c1') {
          if (callerAnimIcon) callerAnimIcon.textContent = '📢⚔️';
          if (callerBannerTarget) callerBannerTarget.textContent = 'todas las Partys de Campo 1';
          callerBanner.className = 'caller-broadcast-banner caller-c1-banner';
        } else if (callerRole === 'c2') {
          if (callerAnimIcon) callerAnimIcon.textContent = '📢🛡️';
          if (callerBannerTarget) callerBannerTarget.textContent = 'todas las Partys de Campo 2';
          callerBanner.className = 'caller-broadcast-banner caller-c2-banner';
        } else {
          if (callerAnimIcon) callerAnimIcon.textContent = '📢⚡';
          if (callerBannerTarget) callerBannerTarget.textContent = 'todos los canales (Global)';
          callerBanner.className = 'caller-broadcast-banner caller-global-banner';
        }
        callerBanner.classList.remove('hidden');
      } else if (isCaller && !isSpeaking) {
        callerBanner.classList.add('hidden');
      }
    }

    // Iluminar avatar en canal de voz y voice-stage
    const avatarEls = document.querySelectorAll(`[data-voice-avatar-socket="${socketId}"]`);
    avatarEls.forEach(el => {
      el.classList.remove('speaking', 'caller-speaking', 'caller-c1-speaking', 'caller-c2-speaking', 'caller-global-speaking');
      if (isSpeaking) {
        if (callerRole === 'c1') el.classList.add('caller-c1-speaking');
        else if (callerRole === 'c2') el.classList.add('caller-c2-speaking');
        else if (callerRole === 'global' || isCaller) el.classList.add('caller-global-speaking');
        else el.classList.add('speaking');
      }
    });

    // Iluminar NOMBRE en canal de voz y voice-stage
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
      if (myUser.isCaller) {
        const callerCrown = document.createElement('span');
        callerCrown.className = 'caller-badge-crown';
        callerCrown.textContent = ' 📢';
        callerCrown.title = 'Rol: Caller (Transmisión Global a todos los canales)';
        nameEl.appendChild(callerCrown);
      }
    }
    if (roleEl) {
      if (myUser.isCaller) {
        const baseRole = myUser.isMasterAdmin ? '👑⭐ Super Admin' : (myUser.isAdmin ? '👑 Admin' : 'Miembro');
        roleEl.textContent = `${baseRole} • 📢 Caller`;
        roleEl.style.color = '#00B0F4';
        roleEl.style.fontWeight = '700';
      } else if (myUser.isMasterAdmin) {
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

    // 0. SECCIÓN: CONECTADOS EN ESPERA (LOBBY / ANTES DE EMPEZAR)
    // Permite ver el nick de todos los compañeros antes de entrar a una Party y asignarles roles
    const waitingUsers = [];
    members.forEach(u => {
      if (!u.currentVoiceChannel) {
        waitingUsers.push(u);
      }
    });

    const isLobbyCollapsed = collapsedCategories.has('Lobby');

    const lobbyBlock = document.createElement('div');
    lobbyBlock.className = 'channel-category lobby-category';
    lobbyBlock.dataset.category = 'Lobby';

    const lobbyHeader = document.createElement('div');
    lobbyHeader.className = `category-header lobby-header ${isLobbyCollapsed ? 'collapsed' : ''}`;

    const lobbyArrow = document.createElement('span');
    lobbyArrow.className = 'category-arrow';
    lobbyArrow.textContent = isLobbyCollapsed ? '▶' : '▼';

    const lobbyTitle = document.createElement('span');
    lobbyTitle.className = 'category-name';
    lobbyTitle.style.color = '#57F287';
    lobbyTitle.style.fontWeight = '800';
    lobbyTitle.textContent = `👥 CONECTADOS EN ESPERA (${waitingUsers.length})`;

    lobbyHeader.appendChild(lobbyArrow);
    lobbyHeader.appendChild(lobbyTitle);

    lobbyHeader.addEventListener('click', () => {
      if (collapsedCategories.has('Lobby')) {
        collapsedCategories.delete('Lobby');
      } else {
        collapsedCategories.add('Lobby');
      }
      renderChannelsList();
    });

    lobbyBlock.appendChild(lobbyHeader);

    const lobbyList = document.createElement('div');
    lobbyList.className = `channels-list ${isLobbyCollapsed ? 'collapsed' : ''}`;

    if (waitingUsers.length === 0) {
      const tipEmpty = document.createElement('div');
      tipEmpty.className = 'lobby-helper-tip';
      tipEmpty.textContent = '✨ Todos los compañeros están dentro de una Party.';
      lobbyList.appendChild(tipEmpty);
    } else {
      const tip = document.createElement('div');
      tip.className = 'lobby-helper-tip';
      tip.textContent = '💡 Antes de empezar: Clic derecho o [...] en tu amigo para asignarle rol Caller o Moderador.';
      lobbyList.appendChild(tip);

      waitingUsers.forEach(u => {
        const row = document.createElement('div');
        row.className = 'lobby-user-row';

        const avatar = document.createElement('div');
        avatar.className = 'voice-user-avatar';
        avatar.textContent = u.avatar || '📦';
        avatar.style.backgroundColor = (u.color || '#5865F2') + '33';

        const info = document.createElement('div');
        info.className = 'lobby-user-info';

        const name = document.createElement('span');
        name.className = 'lobby-user-name';
        name.textContent = u.username;
        name.style.color = u.color || '#f2f3f5';

        if (u.isMasterAdmin) {
          name.innerHTML += ' 👑⭐';
        } else if (u.isAdmin) {
          name.innerHTML += ' 👑';
        }
        if (u.callerRole === 'c1') {
          name.innerHTML += ' <span class="badge-role-inline c1">📢⚔️ C1</span>';
        } else if (u.callerRole === 'c2') {
          name.innerHTML += ' <span class="badge-role-inline c2">📢🛡️ C2</span>';
        } else if (u.callerRole === 'global' || u.isCaller) {
          name.innerHTML += ' <span class="badge-role-inline global">📢⚡ Global</span>';
        }

        const sub = document.createElement('span');
        sub.className = 'lobby-user-sub';
        sub.textContent = '⏳ En espera (Lobby)';

        info.appendChild(name);
        info.appendChild(sub);

        const btnDots = document.createElement('button');
        btnDots.className = 'btn-user-dots';
        btnDots.innerHTML = '⋮';
        btnDots.title = 'Asignar Roles o Opciones';
        btnDots.addEventListener('click', (e) => {
          e.stopPropagation();
          openContextMenu(e, u, u.id);
        });

        row.appendChild(avatar);
        row.appendChild(info);
        row.appendChild(btnDots);

        // Clic derecho en toda la fila para menú contextual
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          openContextMenu(e, u, u.id);
        });

        lobbyList.appendChild(row);
      });
    }

    lobbyBlock.appendChild(lobbyList);
    dynamicCategoriesContainer.appendChild(lobbyBlock);

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

      if (adminManager.isAdmin || adminManager.isMasterAdmin || (myUser && (myUser.isAdmin || myUser.isMasterAdmin))) {
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

        if ((adminManager.isAdmin || adminManager.isMasterAdmin || (myUser && (myUser.isAdmin || myUser.isMasterAdmin))) && chan.id !== 'text-general') {
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

        if (adminManager.isAdmin || adminManager.isMasterAdmin || (myUser && (myUser.isAdmin || myUser.isMasterAdmin))) {
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
          if (voiceEngine.audioContext && voiceEngine.audioContext.state === 'suspended') {
            voiceEngine.audioContext.resume().catch(() => {});
          }
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
            if (u.callerRole === 'c1') {
              name.innerHTML += ' <span class="badge-role-inline c1">📢⚔️ C1</span>';
            } else if (u.callerRole === 'c2') {
              name.innerHTML += ' <span class="badge-role-inline c2">📢🛡️ C2</span>';
            } else if (u.callerRole === 'global' || u.isCaller) {
              name.innerHTML += ' <span class="badge-role-inline global">📢⚡ Global</span>';
            }

            const statusIcons = document.createElement('div');
            statusIcons.className = 'voice-user-status-icons';
            if (u.isMuted) statusIcons.innerHTML += '🎙️🚫';
            if (u.isDeafened) statusIcons.innerHTML += '🔇';

            const btnDots = document.createElement('button');
            btnDots.className = 'btn-user-dots';
            btnDots.innerHTML = '⋮';
            btnDots.title = 'Asignar Roles / Opciones';
            btnDots.addEventListener('click', (e) => {
              e.stopPropagation();
              openContextMenu(e, u, u.id);
            });

            row.appendChild(avatar);
            row.appendChild(name);
            row.appendChild(statusIcons);
            row.appendChild(btnDots);

            // Clic derecho para menú contextual
            row.addEventListener('contextmenu', (e) => {
              e.preventDefault();
              openContextMenu(e, u, u.id);
            });

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

    if (msg.isCaller) {
      const badge = document.createElement('span');
      badge.className = 'caller-badge';
      badge.textContent = '📢 CALLER';
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

        if (u.callerRole === 'c1') {
          const callerCrown = document.createElement('span');
          callerCrown.className = 'caller-badge-crown caller-c1';
          callerCrown.textContent = ' 📢⚔️ [Caller C1]';
          callerCrown.title = 'Rol: Caller Campo 1 (Transmisión a todas las Partys de Campo 1)';
          nameRow.appendChild(callerCrown);
        } else if (u.callerRole === 'c2') {
          const callerCrown = document.createElement('span');
          callerCrown.className = 'caller-badge-crown caller-c2';
          callerCrown.textContent = ' 📢🛡️ [Caller C2]';
          callerCrown.title = 'Rol: Caller Campo 2 (Transmisión a todas las Partys de Campo 2)';
          nameRow.appendChild(callerCrown);
        } else if (u.callerRole === 'global' || u.isCaller) {
          const callerCrown = document.createElement('span');
          callerCrown.className = 'caller-badge-crown caller-global';
          callerCrown.textContent = ' 📢⚡ [Caller Global]';
          callerCrown.title = 'Rol: Caller Global (Transmisión a todos los canales)';
          nameRow.appendChild(callerCrown);
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

        const btnDots = document.createElement('button');
        btnDots.className = 'btn-user-dots';
        btnDots.innerHTML = '⋮';
        btnDots.title = 'Asignar Roles / Opciones';
        btnDots.addEventListener('click', (e) => {
          e.stopPropagation();
          openContextMenu(e, u, u.id);
        });

        item.appendChild(avatar);
        item.appendChild(details);
        item.appendChild(btnDots);

        // Clic derecho para menú contextual
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          openContextMenu(e, u, u.id);
        });

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

  // ===================== SISTEMA DE DESCARGA APP PC =====================
  const modalDownloadApp = document.getElementById('modal-download-app');
  const btnCloseDownload = document.getElementById('btn-close-download-modal');
  const btnTopDownload = document.getElementById('btn-header-download');
  const btnLoginDownload = document.getElementById('btn-login-download');
  const btnBannerDownload = document.getElementById('btn-banner-download');
  const btnDirectDownload = document.getElementById('btn-direct-download');
  const downloadNotice = document.getElementById('download-link-notice');
  const adminDownloadConfig = document.getElementById('admin-download-config-area');
  const inputDownloadUrl = document.getElementById('input-download-url');
  const btnSaveDownloadUrl = document.getElementById('btn-save-download-url');
  const downloadUrlFeedback = document.getElementById('download-url-feedback');

  let currentAppDownloadUrl = 'https://drive.google.com/file/d/1ZEyR_z44AheeCNDIkMlFmLbSp9jPqtGI/view?usp=sharing';

  // Si estamos dentro de la app Electron (PC), ajustar título
  const isRunningInElectron = /Electron/i.test(navigator.userAgent);
  if (isRunningInElectron) {
    if (btnTopDownload) btnTopDownload.title = 'Compartir / Configurar enlace de la App';
    const authBanner = document.getElementById('auth-download-banner');
    if (authBanner) authBanner.style.display = 'none';
  }

  function openDownloadModal() {
    if (modalDownloadApp) modalDownloadApp.classList.add('active');
    updateDownloadBtnState();
  }

  function closeDownloadModal() {
    if (modalDownloadApp) modalDownloadApp.classList.remove('active');
  }

  function updateDownloadBtnState() {
    if (!btnDirectDownload) return;
    const effectiveUrl = (currentAppDownloadUrl && currentAppDownloadUrl.startsWith('http')) 
      ? currentAppDownloadUrl 
      : 'https://drive.google.com/file/d/1ZEyR_z44AheeCNDIkMlFmLbSp9jPqtGI/view?usp=sharing';
      
    btnDirectDownload.href = effectiveUrl;
    btnDirectDownload.target = '_blank';
    if (downloadNotice) downloadNotice.classList.add('hidden');

    // Mostrar configuración si el usuario actual es Master Admin
    if (myUser && myUser.isMasterAdmin && adminDownloadConfig) {
      adminDownloadConfig.classList.remove('hidden');
      if (inputDownloadUrl && !inputDownloadUrl.value) {
        inputDownloadUrl.value = effectiveUrl;
      }
    } else if (adminDownloadConfig) {
      adminDownloadConfig.classList.add('hidden');
    }
  }

  // Obtener URL de descarga actual del servidor
  fetch('/api/app-download-url')
    .then(r => r.json())
    .then(data => {
      if (data && data.url) {
        currentAppDownloadUrl = data.url;
        updateDownloadBtnState();
      }
    })
    .catch(() => {});

  socket.on('app:download_url_updated', ({ url }) => {
    currentAppDownloadUrl = url;
    updateDownloadBtnState();
  });

  if (btnCloseDownload) btnCloseDownload.addEventListener('click', closeDownloadModal);
  if (modalDownloadApp) {
    modalDownloadApp.addEventListener('click', (e) => {
      if (e.target === modalDownloadApp) closeDownloadModal();
    });
  }

  if (btnDirectDownload) {
    btnDirectDownload.addEventListener('click', (e) => {
      const targetUrl = (currentAppDownloadUrl && currentAppDownloadUrl.startsWith('http')) 
        ? currentAppDownloadUrl 
        : 'https://drive.google.com/file/d/1ZEyR_z44AheeCNDIkMlFmLbSp9jPqtGI/view?usp=sharing';
      window.open(targetUrl, '_blank');
    });
  }

  if (btnSaveDownloadUrl) {
    btnSaveDownloadUrl.addEventListener('click', async () => {
      const newUrl = inputDownloadUrl.value.trim();
      const masterPass = prompt('Introduce la Contraseña de Master Admin para guardar:');
      if (!masterPass) return;

      try {
        const resp = await fetch('/api/app-download-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: newUrl, masterPassword: masterPass })
        });
        const result = await resp.json();
        if (resp.ok) {
          currentAppDownloadUrl = newUrl;
          updateDownloadBtnState();
          if (downloadUrlFeedback) {
            downloadUrlFeedback.classList.remove('hidden');
            setTimeout(() => downloadUrlFeedback.classList.add('hidden'), 3500);
          }
        } else {
          alert('Error: ' + (result.error || 'No autorizado'));
        }
      } catch (err) {
        alert('Error conectando al servidor');
      }
    });
  }

  // Si la URL viene con ?openDownload=true, abrir automáticamente
  if (new URLSearchParams(window.location.search).get('openDownload') === 'true') {
    openDownloadModal();
  }

  // ===================== ESCENARIO DE SALA DE VOZ (VOICE STAGE) =====================
  const voiceStage = document.getElementById('voice-stage');
  const voiceStageChannelName = document.getElementById('voice-stage-channel-name');
  const voiceStageCount = document.getElementById('voice-stage-count');
  const voiceStageGrid = document.getElementById('voice-stage-grid');

  function renderVoiceStage() {
    if (!voiceStage || !voiceStageGrid) return;

    if (!voiceEngine.currentChannelId) {
      voiceStage.classList.add('hidden');
      return;
    }

    voiceStage.classList.remove('hidden');
    if (voiceStageChannelName) {
      voiceStageChannelName.textContent = `🔊 ${voiceEngine.currentChannelName || 'SALA DE VOZ'}`;
    }

    const currentVoiceUsers = voiceState[voiceEngine.currentChannelId] || [];
    if (voiceStageCount) {
      voiceStageCount.textContent = `${currentVoiceUsers.length} participante${currentVoiceUsers.length === 1 ? '' : 's'}`;
    }

    voiceStageGrid.innerHTML = '';

    currentVoiceUsers.forEach(u => {
      const card = document.createElement('div');
      card.className = 'voice-stage-card';
      card.dataset.socketId = u.id;
      card.dataset.username = u.username;

      // Status icons (mute/deafen)
      const statusIcons = document.createElement('div');
      statusIcons.className = 'voice-stage-status-icons';
      if (u.isMuted) statusIcons.innerHTML += '🎙️🚫';
      if (u.isDeafened) statusIcons.innerHTML += '🔇';
      card.appendChild(statusIcons);

      // Determinar clase de animación al hablar
      let speakingClass = '';
      if (u.isSpeaking) {
        if (u.callerRole === 'c1') speakingClass = 'caller-c1-speaking';
        else if (u.callerRole === 'c2') speakingClass = 'caller-c2-speaking';
        else if (u.callerRole === 'global' || u.isCaller) speakingClass = 'caller-global-speaking';
        else speakingClass = 'speaking';
      }

      // Avatar con aro de habla dinámico
      const avatar = document.createElement('div');
      avatar.className = `voice-stage-avatar ${speakingClass}`;
      avatar.dataset.voiceAvatarSocket = u.id;
      avatar.textContent = u.avatar || '📦';
      avatar.style.backgroundColor = (u.color || '#5865F2') + '33';
      card.appendChild(avatar);

      // Nickname (Grande, en negrita y claramente visible)
      const name = document.createElement('div');
      name.className = `voice-stage-nick ${u.isSpeaking ? 'speaking' : ''}`;
      name.dataset.voiceNameSocket = u.id;
      name.textContent = u.username;
      name.style.color = u.color || '#ffffff';
      card.appendChild(name);

      // Badges de Roles
      const badges = document.createElement('div');
      badges.className = 'voice-stage-badges';
      if (u.isMasterAdmin) {
        const b = document.createElement('span');
        b.className = 'admin-badge';
        b.style.background = 'linear-gradient(135deg, #FEE75C, #F39C12)';
        b.style.color = '#111';
        b.textContent = '👑⭐ MASTER';
        badges.appendChild(b);
      } else if (u.isAdmin) {
        const b = document.createElement('span');
        b.className = 'admin-badge';
        b.textContent = '👑 ADMIN';
        badges.appendChild(b);
      }
      if (u.callerRole === 'c1') {
        const b = document.createElement('span');
        b.className = 'caller-badge caller-badge-c1';
        b.textContent = '📢⚔️ CALLER C1';
        badges.appendChild(b);
      } else if (u.callerRole === 'c2') {
        const b = document.createElement('span');
        b.className = 'caller-badge caller-badge-c2';
        b.textContent = '📢🛡️ CALLER C2';
        badges.appendChild(b);
      } else if (u.callerRole === 'global' || u.isCaller) {
        const b = document.createElement('span');
        b.className = 'caller-badge caller-badge-global';
        b.textContent = '📢⚡ CALLER GLOBAL';
        badges.appendChild(b);
      }
      card.appendChild(badges);

      // Slider de volumen individual directo en la tarjeta del compañero
      if (u.id !== socket.id) {
        const volWrap = document.createElement('div');
        volWrap.className = 'stage-vol-wrap';
        volWrap.style.marginTop = '6px';
        volWrap.style.display = 'flex';
        volWrap.style.alignItems = 'center';
        volWrap.style.gap = '4px';

        const volIcon = document.createElement('span');
        volIcon.textContent = '🔊';
        volIcon.style.fontSize = '10px';

        const volSlider = document.createElement('input');
        volSlider.type = 'range';
        volSlider.min = '0';
        volSlider.max = '2';
        volSlider.step = '0.05';
        volSlider.value = voiceEngine.getUserVolume(u.id);
        volSlider.style.width = '55px';
        volSlider.style.height = '4px';
        volSlider.style.cursor = 'pointer';
        volSlider.style.accentColor = '#5865F2';

        const volVal = document.createElement('span');
        volVal.textContent = `${Math.round(volSlider.value * 100)}%`;
        volVal.style.fontSize = '10px';
        volVal.style.color = '#949ba4';

        volSlider.addEventListener('input', (ev) => {
          ev.stopPropagation();
          const v = parseFloat(volSlider.value);
          voiceEngine.setUserVolume(u.id, v);
          volVal.textContent = `${Math.round(v * 100)}%`;
        });

        volSlider.addEventListener('click', (ev) => ev.stopPropagation());

        volWrap.appendChild(volIcon);
        volWrap.appendChild(volSlider);
        volWrap.appendChild(volVal);
        card.appendChild(volWrap);
      }

      // Clic derecho para menú contextual completo
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openContextMenu(e, u, u.id);
      });

      voiceStageGrid.appendChild(card);
    });
  }
  window.renderVoiceStage = renderVoiceStage;

  // ===================== MENÚ CONTEXTUAL FLOTANTE (CLIC DERECHO) =====================
  const contextMenu = document.getElementById('user-context-menu');
  const ctxUserAvatar = document.getElementById('ctx-user-avatar');
  const ctxUsername = document.getElementById('ctx-username');
  const ctxUserRole = document.getElementById('ctx-user-role');
  const ctxVolContainer = document.getElementById('ctx-vol-container');
  const ctxVolSlider = document.getElementById('ctx-vol-slider');
  const ctxVolVal = document.getElementById('ctx-vol-val');

  const ctxBtnMute = document.getElementById('ctx-btn-mute');
  const ctxMuteIcon = document.getElementById('ctx-mute-icon');
  const ctxMuteText = document.getElementById('ctx-mute-text');
  const ctxBtnCallerC1 = document.getElementById('ctx-btn-caller-c1');
  const ctxCallerC1Text = document.getElementById('ctx-caller-c1-text');
  const ctxBtnCallerC2 = document.getElementById('ctx-btn-caller-c2');
  const ctxCallerC2Text = document.getElementById('ctx-caller-c2-text');
  const ctxBtnCallerGlobal = document.getElementById('ctx-btn-caller-global');
  const ctxCallerGlobalText = document.getElementById('ctx-caller-global-text');
  const ctxBtnPromote = document.getElementById('ctx-btn-promote');
  const ctxPromoteText = document.getElementById('ctx-promote-text');
  const ctxBtnKickVoice = document.getElementById('ctx-btn-kick-voice');
  const ctxBtnKickServer = document.getElementById('ctx-btn-kick-server');
  const ctxBtnBan = document.getElementById('ctx-btn-ban');

  let activeCtxUser = null;
  let activeCtxSocketId = null;

  function openContextMenu(e, userObj, socketId) {
    if (!contextMenu) return;

    activeCtxUser = userObj;
    activeCtxSocketId = socketId;

    const isSelf = myUser && (socketId === socket.id || userObj.username === myUser.username);
    const isMasterUser = myUser && myUser.username && (myUser.username.toLowerCase() === 'elbolas' || myUser.username.toLowerCase() === 'progamer2026');
    const hasAdmin = isMasterUser || !!(
      (myUser && (myUser.isAdmin || myUser.isMasterAdmin)) ||
      (adminManager && (adminManager.isAdmin || adminManager.isMasterAdmin)) ||
      window.isAdmin || window.isMasterAdmin
    );
    const isMaster = isMasterUser || !!(
      (myUser && myUser.isMasterAdmin) ||
      (adminManager && adminManager.isMasterAdmin) ||
      window.isMasterAdmin
    );

    // Header del menú
    if (ctxUserAvatar) {
      ctxUserAvatar.textContent = userObj.avatar || '📦';
      ctxUserAvatar.style.backgroundColor = (userObj.color || '#5865F2') + '33';
    }
    if (ctxUsername) {
      ctxUsername.textContent = userObj.username;
      ctxUsername.style.color = userObj.color || '#f2f3f5';
    }
    if (ctxUserRole) {
      let roleDesc = userObj.isMasterAdmin ? '👑⭐ Super Admin' : (userObj.isAdmin ? '👑 Administrador' : 'Miembro');
      if (userObj.callerRole === 'c1') roleDesc += ' • 📢⚔️ Caller Campo 1';
      else if (userObj.callerRole === 'c2') roleDesc += ' • 📢🛡️ Caller Campo 2';
      else if (userObj.callerRole === 'global' || userObj.isCaller) roleDesc += ' • 📢⚡ Caller Global';
      ctxUserRole.textContent = roleDesc;
    }

    // Slider de volumen individual
    if (ctxVolContainer && ctxVolSlider && ctxVolVal) {
      if (isSelf) {
        ctxVolContainer.style.display = 'none';
      } else {
        ctxVolContainer.style.display = 'flex';
        const curVol = voiceEngine.getUserVolume(socketId);
        ctxVolSlider.value = curVol;
        ctxVolVal.textContent = `${Math.round(curVol * 100)}%`;
      }
    }

    // Botón Silenciar Servidor
    if (ctxBtnMute) {
      if (hasAdmin && !isSelf) {
        ctxBtnMute.style.display = 'flex';
        if (userObj.isMuted) {
          ctxMuteIcon.textContent = '🎙️';
          ctxMuteText.textContent = 'Desilenciar en Servidor';
        } else {
          ctxMuteIcon.textContent = '🎙️🚫';
          ctxMuteText.textContent = 'Silenciar en Servidor';
        }
      } else {
        ctxBtnMute.style.display = 'none';
      }
    }

    // Botones Asignar / Quitar Caller por Campo
    if (ctxBtnCallerC1) {
      if (hasAdmin && !isSelf) {
        ctxBtnCallerC1.style.display = 'flex';
        ctxCallerC1Text.textContent = userObj.callerRole === 'c1' ? 'Quitar Caller Campo 1' : 'Asignar: CALLER CAMPO 1';
      } else {
        ctxBtnCallerC1.style.display = 'none';
      }
    }
    if (ctxBtnCallerC2) {
      if (hasAdmin && !isSelf) {
        ctxBtnCallerC2.style.display = 'flex';
        ctxCallerC2Text.textContent = userObj.callerRole === 'c2' ? 'Quitar Caller Campo 2' : 'Asignar: CALLER CAMPO 2';
      } else {
        ctxBtnCallerC2.style.display = 'none';
      }
    }
    if (ctxBtnCallerGlobal) {
      if (hasAdmin && !isSelf) {
        ctxBtnCallerGlobal.style.display = 'flex';
        ctxCallerGlobalText.textContent = (userObj.callerRole === 'global' || (!userObj.callerRole && userObj.isCaller)) ? 'Quitar Caller Global' : 'Asignar: CALLER GLOBAL (Todos)';
      } else {
        ctxBtnCallerGlobal.style.display = 'none';
      }
    }

    // Botón Promover Administrador (Solo Master Admin)
    if (ctxBtnPromote) {
      if (isMaster && !isSelf && !userObj.isMasterAdmin) {
        ctxBtnPromote.style.display = 'flex';
        ctxPromoteText.textContent = userObj.isAdmin ? 'Quitar Administrador' : 'Hacer Administrador';
      } else {
        ctxBtnPromote.style.display = 'none';
      }
    }

    // Botones de expulsión
    const inVoice = !!userObj.currentVoiceChannel;
    if (ctxBtnKickVoice) {
      ctxBtnKickVoice.style.display = (hasAdmin && !isSelf && inVoice) ? 'flex' : 'none';
    }
    if (ctxBtnKickServer) {
      ctxBtnKickServer.style.display = (hasAdmin && !isSelf && !userObj.isMasterAdmin) ? 'flex' : 'none';
    }
    if (ctxBtnBan) {
      ctxBtnBan.style.display = (isMaster && !isSelf && !userObj.isMasterAdmin) ? 'flex' : 'none';
    }

    // Mostrar y posicionar menú adaptado a pantalla
    contextMenu.classList.remove('hidden');
    const menuWidth = 240;
    const menuHeight = 320;
    let posX = e.clientX;
    let posY = e.clientY;

    if (posX + menuWidth > window.innerWidth) {
      posX = window.innerWidth - menuWidth - 10;
    }
    if (posY + menuHeight > window.innerHeight) {
      posY = window.innerHeight - menuHeight - 10;
    }

    contextMenu.style.left = `${Math.max(10, posX)}px`;
    contextMenu.style.top = `${Math.max(10, posY)}px`;
  }

  function closeContextMenu() {
    if (contextMenu) contextMenu.classList.add('hidden');
    activeCtxUser = null;
    activeCtxSocketId = null;
  }

  // Cerrar menú con clic o tecla Escape
  document.addEventListener('click', (e) => {
    if (contextMenu && !contextMenu.contains(e.target)) {
      closeContextMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeContextMenu();
  });

  // Slider de volumen en menú contextual
  if (ctxVolSlider && ctxVolVal) {
    ctxVolSlider.addEventListener('input', (e) => {
      e.stopPropagation();
      if (!activeCtxSocketId) return;
      const vol = parseFloat(ctxVolSlider.value);
      voiceEngine.setUserVolume(activeCtxSocketId, vol);
      ctxVolVal.textContent = `${Math.round(vol * 100)}%`;
    });
  }

  // Eventos de botones del menú contextual
  if (ctxBtnMute) {
    ctxBtnMute.addEventListener('click', () => {
      if (!activeCtxUser || !activeCtxSocketId) return;
      if (activeCtxUser.isMuted) {
        adminManager.unmuteVoiceUser(activeCtxSocketId, activeCtxUser.username);
      } else {
        adminManager.muteVoiceUser(activeCtxSocketId, activeCtxUser.username);
      }
      closeContextMenu();
    });
  }

  if (ctxBtnCallerC1) {
    ctxBtnCallerC1.addEventListener('click', () => {
      if (!activeCtxUser || !activeCtxSocketId) return;
      adminManager.setCallerRole(activeCtxSocketId, activeCtxUser.username, activeCtxUser.callerRole === 'c1' ? null : 'c1');
      closeContextMenu();
    });
  }

  if (ctxBtnCallerC2) {
    ctxBtnCallerC2.addEventListener('click', () => {
      if (!activeCtxUser || !activeCtxSocketId) return;
      adminManager.setCallerRole(activeCtxSocketId, activeCtxUser.username, activeCtxUser.callerRole === 'c2' ? null : 'c2');
      closeContextMenu();
    });
  }

  if (ctxBtnCallerGlobal) {
    ctxBtnCallerGlobal.addEventListener('click', () => {
      if (!activeCtxUser || !activeCtxSocketId) return;
      adminManager.setCallerRole(activeCtxSocketId, activeCtxUser.username, activeCtxUser.callerRole === 'global' ? null : 'global');
      closeContextMenu();
    });
  }

  if (ctxBtnPromote) {
    ctxBtnPromote.addEventListener('click', () => {
      if (!activeCtxUser || !activeCtxSocketId) return;
      adminManager.promoteUser(activeCtxSocketId, activeCtxUser.username, !activeCtxUser.isAdmin);
      closeContextMenu();
    });
  }

  if (ctxBtnKickVoice) {
    ctxBtnKickVoice.addEventListener('click', () => {
      if (!activeCtxUser || !activeCtxSocketId) return;
      adminManager.kickVoiceUser(activeCtxSocketId, activeCtxUser.username);
      closeContextMenu();
    });
  }

  if (ctxBtnKickServer) {
    ctxBtnKickServer.addEventListener('click', () => {
      if (!activeCtxUser || !activeCtxSocketId) return;
      adminManager.kickServerUser(activeCtxSocketId, activeCtxUser.username);
      closeContextMenu();
    });
  }

  if (ctxBtnBan) {
    ctxBtnBan.addEventListener('click', () => {
      if (!activeCtxUser || !activeCtxSocketId) return;
      adminManager.banServerUser(activeCtxSocketId, activeCtxUser.username);
      closeContextMenu();
    });
  }
});
