// =========================================================
// SpecialDeliverySpeak - Admin & Master Admin Manager
// =========================================================

class AdminManager {
  constructor(socket) {
    this.socket = socket;
    this.isAdmin = false;
    this.isMasterAdmin = false;

    this.initElements();
    this.bindEvents();
    this.setupSocketListeners();
  }

  initElements() {
    this.adminAuthModal = document.getElementById('modal-admin-auth');
    this.createChannelModal = document.getElementById('modal-create-channel');

    this.btnAdminPanel = document.getElementById('btn-admin-panel');
    this.btnAdminGear = document.getElementById('btn-admin-gear');
    this.btnAddVoice = document.getElementById('btn-add-voice-channel');
    this.btnAddText = document.getElementById('btn-add-text-channel');

    this.formAdminAuth = document.getElementById('form-admin-auth');
    this.inputAdminPass = document.getElementById('input-admin-auth-pass');
    this.adminAuthError = document.getElementById('admin-auth-error');

    this.formCreateChannel = document.getElementById('form-create-channel');
    this.inputChannelName = document.getElementById('input-channel-name');
    this.inputUserLimit = document.getElementById('input-user-limit');
    this.groupUserLimit = document.getElementById('group-user-limit');

    this.radioVoice = document.getElementById('radio-card-voice');
    this.radioText = document.getElementById('radio-card-text');
  }

  bindEvents() {
    if (this.btnAdminPanel) {
      this.btnAdminPanel.addEventListener('click', () => this.openAdminAuthModal());
    }
    if (this.btnAdminGear) {
      this.btnAdminGear.addEventListener('click', () => {
        if (!this.isAdmin) {
          this.openAdminAuthModal();
        } else {
          const roleTitle = this.isMasterAdmin ? '👑⭐ Administrador Maestro' : '👑 Administrador';
          alert(`¡Tu rol actual es ${roleTitle}! Puedes gestionar canales, moderar usuarios y otorgar permisos.`);
        }
      });
    }

    const btnCloseAdmin = document.getElementById('btn-close-admin-modal');
    const btnCancelAdmin = document.getElementById('btn-cancel-admin-auth');
    if (btnCloseAdmin) btnCloseAdmin.addEventListener('click', () => this.closeAdminAuthModal());
    if (btnCancelAdmin) btnCancelAdmin.addEventListener('click', () => this.closeAdminAuthModal());

    const btnCloseCreate = document.getElementById('btn-close-create-modal');
    const btnCancelCreate = document.getElementById('btn-cancel-create-channel');
    if (btnCloseCreate) btnCloseCreate.addEventListener('click', () => this.closeCreateChannelModal());
    if (btnCancelCreate) btnCancelCreate.addEventListener('click', () => this.closeCreateChannelModal());

    if (this.btnAddVoice) {
      this.btnAddVoice.addEventListener('click', () => this.openCreateChannelModal('voice'));
    }
    if (this.btnAddText) {
      this.btnAddText.addEventListener('click', () => this.openCreateChannelModal('text'));
    }

    if (this.formAdminAuth) {
      this.formAdminAuth.addEventListener('submit', (e) => {
        e.preventDefault();
        const password = this.inputAdminPass.value.trim();
        if (password) {
          this.socket.emit('admin:login', { password });
        }
      });
    }

    if (this.radioVoice && this.radioText) {
      this.radioVoice.addEventListener('click', () => {
        this.radioVoice.classList.add('selected');
        this.radioText.classList.remove('selected');
        this.radioVoice.querySelector('input').checked = true;
        this.groupUserLimit.classList.remove('hidden');
      });

      this.radioText.addEventListener('click', () => {
        this.radioText.classList.add('selected');
        this.radioVoice.classList.remove('selected');
        this.radioText.querySelector('input').checked = true;
        this.groupUserLimit.classList.add('hidden');
      });
    }

    if (this.formCreateChannel) {
      this.formCreateChannel.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = this.inputChannelName.value.trim();
        const type = this.radioVoice.querySelector('input').checked ? 'voice' : 'text';
        const userLimit = parseInt(this.inputUserLimit.value, 10) || 0;

        if (!name) return;

        this.socket.emit('admin:create_channel', {
          name,
          type,
          userLimit
        });

        this.closeCreateChannelModal();
        this.inputChannelName.value = '';
        this.inputUserLimit.value = '0';
      });
    }
  }

  setupSocketListeners() {
    this.socket.on('admin:login_success', ({ isAdmin, isMasterAdmin }) => {
      this.isAdmin = !!isAdmin;
      this.isMasterAdmin = !!isMasterAdmin;
      window.isAdmin = this.isAdmin;
      window.isMasterAdmin = this.isMasterAdmin;

      this.closeAdminAuthModal();

      document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
      if (this.isMasterAdmin) {
        document.querySelectorAll('.master-admin-only').forEach(el => el.classList.remove('hidden'));
      }

      const myRole = document.getElementById('my-role-display');
      if (myRole) {
        if (this.isMasterAdmin) {
          myRole.textContent = '👑⭐ Master Admin';
          myRole.style.color = '#FEE75C';
          myRole.style.fontWeight = '800';
        } else {
          myRole.textContent = '👑 Administrador';
          myRole.style.color = '#57F287';
          myRole.style.fontWeight = '700';
        }
      }

      if (window.renderChannelsList) window.renderChannelsList();
      if (window.renderMembersList) window.renderMembersList();
    });

    this.socket.on('admin:role_updated', ({ isAdmin, isMasterAdmin }) => {
      this.isAdmin = !!isAdmin;
      this.isMasterAdmin = !!isMasterAdmin;
      window.isAdmin = this.isAdmin;
      window.isMasterAdmin = this.isMasterAdmin;

      if (this.isAdmin) {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
      } else {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
      }

      const myRole = document.getElementById('my-role-display');
      if (myRole) {
        myRole.textContent = this.isAdmin ? '👑 Administrador' : 'Miembro';
        myRole.style.color = this.isAdmin ? '#57F287' : 'var(--text-muted)';
      }

      alert(this.isAdmin 
        ? '¡Has sido ascendido a Administrador por el Administrador Maestro! 🎉'
        : 'Tus permisos de Administrador han sido revocados por el Administrador Maestro.');

      if (window.renderChannelsList) window.renderChannelsList();
      if (window.renderMembersList) window.renderMembersList();
    });

    this.socket.on('admin:login_failed', ({ message }) => {
      if (this.adminAuthError) {
        this.adminAuthError.textContent = message || 'Contraseña incorrecta';
        this.adminAuthError.classList.remove('hidden');
      }
    });

    this.socket.on('error:permission', (msg) => {
      alert(msg);
    });

    this.socket.on('user:kicked_by_admin', ({ by }) => {
      alert(`Has sido expulsado del servidor por ${by}.`);
      window.location.reload();
    });

    this.socket.on('user:banned_by_admin', ({ by, reason }) => {
      alert(`HAS SIDO BANEADO PERMANENTEMENTE del servidor por ${by}.\nRazón: ${reason || 'Infracción de normas'}`);
      document.body.innerHTML = `
        <div style="display:flex;height:100vh;align-items:center;justify-content:center;background:#1e1f22;color:#ED4245;font-family:sans-serif;text-align:center;flex-direction:column;gap:16px;">
          <h1 style="font-size:32px;">🚫 Acceso Bloqueado</h1>
          <p style="font-size:18px;color:#dbdee1;">Has sido baneado permanentemente de SpecialDeliverySpeak.</p>
        </div>
      `;
    });

    this.socket.on('user:banned_error', ({ reason }) => {
      alert(reason || 'Tu acceso a este servidor se encuentra bloqueado.');
      document.body.innerHTML = `
        <div style="display:flex;height:100vh;align-items:center;justify-content:center;background:#1e1f22;color:#ED4245;font-family:sans-serif;text-align:center;flex-direction:column;gap:16px;">
          <h1 style="font-size:32px;">🚫 Acceso Denegado</h1>
          <p style="font-size:18px;color:#dbdee1;">${reason || 'Estás baneado de este servidor.'}</p>
        </div>
      `;
    });
  }

  openAdminAuthModal() {
    if (this.adminAuthModal) {
      this.adminAuthModal.classList.add('active');
      if (this.adminAuthError) this.adminAuthError.classList.add('hidden');
      if (this.inputAdminPass) {
        this.inputAdminPass.value = '';
        setTimeout(() => this.inputAdminPass.focus(), 50);
      }
    }
  }

  closeAdminAuthModal() {
    if (this.adminAuthModal) {
      this.adminAuthModal.classList.remove('active');
    }
  }

  openCreateChannelModal(defaultType = 'voice') {
    if (!this.isAdmin && !this.isMasterAdmin) {
      alert('Solo un administrador puede crear canales.');
      return;
    }

    if (this.createChannelModal) {
      this.createChannelModal.classList.add('active');

      if (defaultType === 'voice') {
        this.radioVoice.click();
      } else {
        this.radioText.click();
      }

      setTimeout(() => this.inputChannelName.focus(), 50);
    }
  }

  closeCreateChannelModal() {
    if (this.createChannelModal) {
      this.createChannelModal.classList.remove('active');
    }
  }

  deleteChannel(channelId, channelName) {
    if (!this.isAdmin && !this.isMasterAdmin) return;
    if (confirm(`¿Estás seguro de que deseas eliminar el canal "${channelName}"?`)) {
      this.socket.emit('admin:delete_channel', { channelId });
    }
  }

  // Acciones de Moderación Maestra
  promoteUser(socketId, username, makeAdmin) {
    if (!this.isMasterAdmin) {
      alert('Solo el Administrador Maestro puede ascender o degradar administradores.');
      return;
    }
    const actionText = makeAdmin ? 'otorgar rango de Administrador' : 'remover rango de Administrador';
    if (confirm(`¿Deseas ${actionText} a "${username}"?`)) {
      this.socket.emit('admin:promote_user', { targetSocketId: socketId, makeAdmin });
    }
  }

  kickServerUser(socketId, username) {
    if (!this.isAdmin && !this.isMasterAdmin) return;
    if (confirm(`¿Expulsar del servidor a "${username}"? (Podrá volver a entrar si no está baneado)`)) {
      this.socket.emit('admin:kick_user', { targetSocketId: socketId });
    }
  }

  banServerUser(socketId, username) {
    if (!this.isMasterAdmin) {
      alert('Solo el Administrador Maestro puede banear permanentemente a usuarios.');
      return;
    }
    const reason = prompt(`BANEAR PERMANENTEMENTE a "${username}".\nIntroduce el motivo del baneo:`, 'Infracción de normas');
    if (reason !== null) {
      this.socket.emit('admin:ban_user', { targetSocketId: socketId, reason: reason.trim() });
    }
  }

  muteVoiceUser(socketId, username) {
    if (!this.isAdmin && !this.isMasterAdmin) return;
    this.socket.emit('admin:mute_user', { targetSocketId: socketId });
  }

  unmuteVoiceUser(socketId, username) {
    if (!this.isAdmin && !this.isMasterAdmin) return;
    this.socket.emit('admin:unmute_user', { targetSocketId: socketId });
  }

  setCallerUser(socketId, username, isCaller) {
    if (!this.isAdmin && !this.isMasterAdmin) return;
    const actionText = isCaller ? 'asignar el rol de CALLER (Transmisión Global a todos los canales)' : 'remover el rol de Caller';
    if (confirm(`¿Deseas ${actionText} a "${username}"?`)) {
      this.socket.emit('admin:set_caller', { targetSocketId: socketId, isCaller });
    }
  }

  kickVoiceUser(socketId, username) {
    if (!this.isAdmin && !this.isMasterAdmin) return;
    if (confirm(`¿Desconectar a "${username}" de la sala de voz?`)) {
      this.socket.emit('admin:kick_voice', { targetSocketId: socketId });
    }
  }
}

window.AdminManager = AdminManager;
