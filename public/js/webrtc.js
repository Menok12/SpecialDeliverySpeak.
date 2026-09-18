// =======================================================================
// SpecialDeliverySpeak - WebRTC Studio Voice Engine & DSP Manager
// =======================================================================

class VoiceEngine {
  constructor(socket) {
    this.socket = socket;
    this.rawStream = null;
    this.processedStream = null;

    this.peerConnections = new Map(); // socketId -> RTCPeerConnection
    this.remoteAudios = new Map(); // socketId -> HTMLAudioElement
    this.peerGainNodes = new Map(); // socketId -> GainNode (volumen individual)
    this.peerPanners = new Map(); // socketId -> StereoPannerNode (paneo espacial)
    this.peerVolumes = new Map(); // socketId -> 0.0 a 2.0
    this.peerPans = new Map(); // socketId -> -1.0 (L) a +1.0 (R)

    this.currentChannelId = null;
    this.currentChannelName = '';
    this.isMuted = false;
    this.isDeafened = false;
    this.isSpeaking = false;
    this.noiseSuppressionEnabled = true;

    // Modos de voz y puerta de ruido
    this.voiceMode = 'vad'; // 'vad' (activación por voz) o 'ptt' (push-to-talk)
    this.pttActive = false;
    this.pttKey = 'Space';
    this.noiseGateThreshold = 5; // 0 a 100 (sensibilidad mejorada para captar todo)
    this.onVolumeMeter = null; // Callback para el vúmetro visual
    this.selectedDeviceId = null;
    this.isLoopbackActive = false;
    this.loopbackGainNode = null;

    // DSP Nodes
    this.audioContext = null;
    this.highPassFilter = null;
    this.presenceEQ = null;
    this.compressor = null;
    this.analyser = null;
    this.animFrameId = null;
    this.currentDspProfile = 'gamer';

    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ];

    this.setupSocketListeners();
  }

  // Modificar SDP para forzar Opus a 128 kbps con FEC (Forward Error Correction)
  setOpusPreferences(sdp) {
    const lines = sdp.split('\r\n');
    let opusPayload = null;

    for (const line of lines) {
      if (line.includes('opus/48000')) {
        const match = line.match(/a=rtpmap:(\d+)\s+opus\/48000/);
        if (match) {
          opusPayload = match[1];
          break;
        }
      }
    }

    if (!opusPayload) return sdp;

    const newLines = [];
    let fmtpFound = false;

    for (let line of lines) {
      if (line.startsWith(`a=fmtp:${opusPayload}`)) {
        fmtpFound = true;
        line = `a=fmtp:${opusPayload} maxaveragebitrate=128000;stereo=1;sprop-stereo=1;useinbandfec=1;cbr=1`;
      }
      newLines.push(line);
    }

    if (!fmtpFound) {
      for (let i = 0; i < newLines.length; i++) {
        if (newLines[i].startsWith(`a=rtpmap:${opusPayload}`)) {
          newLines.splice(i + 1, 0, `a=fmtp:${opusPayload} maxaveragebitrate=128000;stereo=1;sprop-stereo=1;useinbandfec=1;cbr=1`);
          break;
        }
      }
    }

    return newLines.join('\r\n');
  }

  // ========================================================
  // SINTETIZADOR ACÚSTICO ESTILO DISCORD HQ
  // ========================================================
  playDiscordTone(freq, duration = 0.15, gainVal = 0.12, startTime = 0, isSub = false) {
    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }
      const now = this.audioContext.currentTime + startTime;
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      const filter = this.audioContext.createBiquadFilter();

      osc.type = isSub ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, now);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2600, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(gainVal, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.audioContext.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {}
  }

  playDiscordSlide(startFreq, endFreq, duration = 0.09, gainVal = 0.10) {
    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }
      const now = this.audioContext.currentTime;
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      const filter = this.audioContext.createBiquadFilter();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2400, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(gainVal, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.audioContext.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {}
  }

  playFeedbackTone(type) {
    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      if (type === 'join') {
        // DISCORD VOICE CONNECT (Bloop-Bloop cálido característico)
        // Nota 1: E5 (659.25 Hz)
        this.playDiscordTone(659.25, 0.08, 0.09, 0.00);
        // Nota 2: C6 (1046.50 Hz) + subarmónico C5 (523.25 Hz)
        this.playDiscordTone(1046.50, 0.36, 0.12, 0.08);
        this.playDiscordTone(523.25, 0.32, 0.06, 0.08, true);
      } else if (type === 'leave') {
        // DISCORD VOICE DISCONNECT (3 notas descendentes suaves)
        // C6 (1046.50 Hz) -> G5 (783.99 Hz) -> C5 (523.25 Hz)
        this.playDiscordTone(1046.50, 0.08, 0.09, 0.00);
        this.playDiscordTone(783.99, 0.08, 0.09, 0.07);
        this.playDiscordTone(523.25, 0.30, 0.10, 0.14, true);
      } else if (type === 'message') {
        // DISCORD INCOMING MESSAGE POP ("doot-doot")
        // Nota 1: F5 (698.46 Hz)
        this.playDiscordTone(698.46, 0.045, 0.08, 0.00);
        // Nota 2: A5 (880.00 Hz) con decaimiento limpio
        this.playDiscordTone(880.00, 0.13, 0.13, 0.065);
      } else if (type === 'mute') {
        // DISCORD MUTE (Pitch slide descendente suave 540Hz -> 240Hz)
        this.playDiscordSlide(540, 240, 0.085, 0.09);
      } else if (type === 'unmute') {
        // DISCORD UNMUTE (Pitch slide ascendente 240Hz -> 540Hz)
        this.playDiscordSlide(240, 540, 0.085, 0.09);
      } else if (type === 'deafen') {
        // DISCORD DEAFEN
        this.playDiscordSlide(460, 280, 0.08, 0.09);
      } else if (type === 'undeafen') {
        // DISCORD UNDEAFEN
        this.playDiscordSlide(260, 480, 0.08, 0.09);
      } else if (type === 'ptt_on') {
        this.playDiscordTone(880, 0.035, 0.06, 0.00);
      } else if (type === 'ptt_off') {
        this.playDiscordTone(440, 0.035, 0.06, 0.00);
      }
    } catch (e) {}
  }

  playMessageTone() {
    this.playFeedbackTone('message');
  }

  // Inicializar captura y cadena DSP de mejora de voz
  async initLocalMicrophone(deviceId = null) {
    if (deviceId) {
      this.selectedDeviceId = deviceId;
      if (this.rawStream) {
        this.rawStream.getTracks().forEach(t => t.stop());
        this.rawStream = null;
        this.processedStream = null;
      }
    }

    if (this.processedStream) {
      this.isListenerMode = false;
      this.isMuted = false;
      return this.processedStream;
    }

    // Comprobación de contexto seguro y soporte de medios
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn('[Microphone] getUserMedia no está disponible. Requiere HTTPS o localhost.');
      this.isListenerMode = true;
      const err = new Error('Insecure origin or unsupported browser media API');
      err.name = 'InsecureContextError';
      throw err;
    }

    try {
      let stream = null;

      const baseAudio = {
        echoCancellation: true,
        noiseSuppression: this.noiseSuppressionEnabled,
        autoGainControl: true
      };
      if (this.selectedDeviceId) {
        baseAudio.deviceId = { exact: this.selectedDeviceId };
      }

      // Intento 1: Con cancelación de eco y mejoras
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: baseAudio,
          video: false
        });
      } catch (errAdv) {
        console.warn('[Microphone] Filtros avanzados no admitidos por el driver, intentando audio directo:', errAdv);
        // Intento 2: Fallback simple a audio puro
        stream = await navigator.mediaDevices.getUserMedia({
          audio: this.selectedDeviceId ? { deviceId: { exact: this.selectedDeviceId } } : true,
          video: false
        });
      }

      this.rawStream = stream;
      this.isListenerMode = false;
      this.isMuted = false;

      // Habilitar pistas de audio
      this.rawStream.getAudioTracks().forEach(track => {
        track.enabled = true;
      });

      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // ========================================================
      // CADENA DSP: Raw Mic -> HighPass -> Presence EQ -> Compressor -> Destination
      // ========================================================
      const micSource = this.audioContext.createMediaStreamSource(stream);

      this.highPassFilter = this.audioContext.createBiquadFilter();
      this.highPassFilter.type = 'highpass';

      this.presenceEQ = this.audioContext.createBiquadFilter();
      this.presenceEQ.type = 'peaking';

      this.compressor = this.audioContext.createDynamicsCompressor();

      this.applyDspProfileSettings(this.currentDspProfile);

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.3;

      const mediaDest = this.audioContext.createMediaStreamDestination();

      micSource.connect(this.highPassFilter);
      this.highPassFilter.connect(this.presenceEQ);
      this.presenceEQ.connect(this.compressor);
      this.compressor.connect(this.analyser);
      this.compressor.connect(mediaDest);

      this.processedStream = mediaDest.stream;

      this.setupSpeakingDetector();

      // Si la prueba de escucha propia está activa, reconectar loopback
      if (this.isLoopbackActive && this.loopbackGainNode) {
        try {
          this.compressor.connect(this.loopbackGainNode);
          this.loopbackGainNode.connect(this.audioContext.destination);
        } catch (e) {}
      }

      // Quitar estado de silencio visualmente en el dock
      const btnMic = document.getElementById('btn-toggle-mic');
      const iconMic = document.getElementById('icon-mic');
      if (btnMic && iconMic) {
        btnMic.classList.remove('active-danger');
        iconMic.textContent = '🎙️';
        btnMic.title = 'Silenciar Micrófono';
      }

      // Actualizar pistas en conexiones WebRTC
      this.peerConnections.forEach((pc, peerSocketId) => {
        try {
          const senders = pc.getSenders();
          const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
          const newTrack = this.processedStream.getAudioTracks()[0];
          if (audioSender) {
            audioSender.replaceTrack(newTrack);
          } else {
            pc.addTrack(newTrack, this.processedStream);
            pc.createOffer().then(offer => {
              offer.sdp = this.setOpusPreferences(offer.sdp);
              return pc.setLocalDescription(offer);
            }).then(() => {
              this.socket.emit('voice:signal', {
                to: peerSocketId,
                signal: pc.localDescription
              });
            }).catch(() => {});
          }
        } catch (err) {}
      });

      this.updateUIStatus(true);
      return this.processedStream;
    } catch (err) {
      console.warn('[Microphone] No se pudo acceder al micrófono (Modo Oyente activado):', err.name, err.message);
      this.isListenerMode = true;
      this.isMuted = true;
      throw err;
    }
  }

  async getAudioDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'audioinput');
    } catch (e) {
      return [];
    }
  }

  toggleMicLoopback() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    this.isLoopbackActive = !this.isLoopbackActive;

    if (!this.loopbackGainNode) {
      this.loopbackGainNode = this.audioContext.createGain();
      this.loopbackGainNode.gain.value = 1.0;
    }

    if (this.isLoopbackActive) {
      if (this.compressor) {
        this.compressor.connect(this.loopbackGainNode);
        this.loopbackGainNode.connect(this.audioContext.destination);
      }
    } else {
      if (this.loopbackGainNode) {
        try { this.loopbackGainNode.disconnect(); } catch (e) {}
      }
    }

    return this.isLoopbackActive;
  }

  // Perfiles de sonido DSP
  applyDspProfileSettings(profile) {
    if (!this.highPassFilter || !this.presenceEQ || !this.compressor) return;

    if (profile === 'gamer') {
      // Máxima claridad vocal en partida, corta retumbes y saca la voz
      this.highPassFilter.frequency.value = 110;
      this.highPassFilter.Q.value = 0.7;

      this.presenceEQ.frequency.value = 3200;
      this.presenceEQ.Q.value = 1.4;
      this.presenceEQ.gain.value = 4.0; // +4dB brillo

      this.compressor.threshold.value = -26;
      this.compressor.knee.value = 24;
      this.compressor.ratio.value = 5;
      this.compressor.attack.value = 0.002;
      this.compressor.release.value = 0.2;
    } else if (profile === 'podcast') {
      // Voz cálida, suave y con cuerpo
      this.highPassFilter.frequency.value = 75;
      this.highPassFilter.Q.value = 0.6;

      this.presenceEQ.frequency.value = 2800;
      this.presenceEQ.Q.value = 1.0;
      this.presenceEQ.gain.value = 2.5;

      this.compressor.threshold.value = -20;
      this.compressor.knee.value = 35;
      this.compressor.ratio.value = 3.5;
      this.compressor.attack.value = 0.005;
      this.compressor.release.value = 0.28;
    } else {
      // Neutro / Natural
      this.highPassFilter.frequency.value = 45;
      this.highPassFilter.Q.value = 0.5;

      this.presenceEQ.frequency.value = 3000;
      this.presenceEQ.gain.value = 0; // Plano

      this.compressor.threshold.value = -16;
      this.compressor.ratio.value = 2;
      this.compressor.attack.value = 0.01;
      this.compressor.release.value = 0.25;
    }

    this.currentDspProfile = profile;
  }

  setDspProfile(profile) {
    this.applyDspProfileSettings(profile);
  }

  // Detección de voz con Puerta de Ruido y soporte de Push-to-Talk
  setupSpeakingDetector() {
    if (!this.analyser) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let speakingDebounce = false;

    const checkVolume = () => {
      if (!this.analyser) {
        this.animFrameId = requestAnimationFrame(checkVolume);
        return;
      }

      this.analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const rawAvg = sum / bufferLength;
      // Normalizar nivel de 0 a 100
      const currentLevel = Math.min(100, Math.round((rawAvg / 128) * 100));

      // Callback para el vúmetro visual en los ajustes
      if (this.onVolumeMeter) {
        this.onVolumeMeter(currentLevel, this.isSpeaking);
      }

      let isNowSpeaking = false;

      if (this.isMuted) {
        isNowSpeaking = false;
      } else if (this.voiceMode === 'ptt') {
        // En modo Push-to-Talk, solo habla si mantiene presionada la tecla
        isNowSpeaking = this.pttActive;
      } else {
        // En modo VAD (activación por voz), compara contra el umbral de la Puerta de Ruido
        isNowSpeaking = currentLevel >= this.noiseGateThreshold;
      }

      if (isNowSpeaking !== this.isSpeaking) {
        if (isNowSpeaking) {
          this.setLocalSpeakingState(true);
          speakingDebounce = true;
        } else {
          setTimeout(() => {
            if (speakingDebounce) {
              speakingDebounce = false;
              this.setLocalSpeakingState(false);
            }
          }, 320);
        }
      }

      this.animFrameId = requestAnimationFrame(checkVolume);
    };

    checkVolume();
  }

  setLocalSpeakingState(isSpeaking) {
    this.isSpeaking = isSpeaking;

    const myAvatar = document.getElementById('my-avatar');
    const myName = document.getElementById('my-username-display');

    if (isSpeaking && !this.isMuted) {
      if (myAvatar) myAvatar.classList.add('speaking');
      if (myName) myName.classList.add('speaking');
    } else {
      if (myAvatar) myAvatar.classList.remove('speaking');
      if (myName) myName.classList.remove('speaking');
    }

    if (this.currentChannelId) {
      this.socket.emit('voice:speaking', { isSpeaking: isSpeaking && !this.isMuted });
    }
  }

  // Manejador Push-to-Talk
  handlePushToTalk(active) {
    if (this.voiceMode !== 'ptt') return;
    if (this.pttActive === active) return;

    this.pttActive = active;

    // Habilitar o silenciar pista local al pulsar/soltar
    const streamToSend = this.processedStream || this.rawStream;
    if (streamToSend && !this.isMuted) {
      streamToSend.getAudioTracks().forEach(track => {
        track.enabled = active;
      });
    }

    this.playFeedbackTone(active ? 'ptt_on' : 'ptt_off');
    this.setLocalSpeakingState(active);
  }

  // Supresión de sonido
  async toggleNoiseSuppression() {
    this.noiseSuppressionEnabled = !this.noiseSuppressionEnabled;

    if (this.rawStream) {
      const audioTracks = this.rawStream.getAudioTracks();
      for (const track of audioTracks) {
        try {
          await track.applyConstraints({
            noiseSuppression: this.noiseSuppressionEnabled,
            echoCancellation: this.noiseSuppressionEnabled
          });
        } catch (e) {}
      }
    }

    const btnNoise = document.getElementById('btn-toggle-noise');
    if (btnNoise) {
      if (this.noiseSuppressionEnabled) {
        btnNoise.classList.add('active-feature');
        btnNoise.title = 'Supresión de Ruido: ACTIVADA';
      } else {
        btnNoise.classList.remove('active-feature');
        btnNoise.title = 'Supresión de Ruido: DESACTIVADA';
      }
    }

    return this.noiseSuppressionEnabled;
  }

  // ===================== CONTROL DE VOLUMEN Y AUDIO ESPACIAL =====================

  setUserVolume(peerSocketId, volumeRatio) {
    const ratio = Math.max(0, Math.min(2.0, parseFloat(volumeRatio)));
    this.peerVolumes.set(peerSocketId, ratio);

    const gainNode = this.peerGainNodes.get(peerSocketId);
    if (gainNode && !this.isDeafened) {
      gainNode.gain.setValueAtTime(ratio, this.audioContext ? this.audioContext.currentTime : 0);
    }

    const audio = this.remoteAudios.get(peerSocketId);
    if (audio) {
      audio.volume = Math.min(1.0, ratio);
    }
  }

  getUserVolume(peerSocketId) {
    return this.peerVolumes.has(peerSocketId) ? this.peerVolumes.get(peerSocketId) : 1.0;
  }

  setUserPan(peerSocketId, panValue) {
    const pan = Math.max(-1.0, Math.min(1.0, parseFloat(panValue)));
    this.peerPans.set(peerSocketId, pan);

    const pannerNode = this.peerPanners.get(peerSocketId);
    if (pannerNode && pannerNode.pan) {
      pannerNode.pan.setValueAtTime(pan, this.audioContext ? this.audioContext.currentTime : 0);
    }
  }

  getUserPan(peerSocketId) {
    return this.peerPans.has(peerSocketId) ? this.peerPans.get(peerSocketId) : 0;
  }

  // ===================== UNIRSE Y SALIR =====================

  async joinVoiceChannel(channelId, channelName) {
    if (this.currentChannelId === channelId) return;

    try {
      await this.initLocalMicrophone();
      this.isListenerMode = false;
      this.isMuted = false;
    } catch (e) {
      console.warn('Entrando en modo solo escucha.', e);
      this.isListenerMode = true;
      this.isMuted = true;
      const btnMic = document.getElementById('btn-toggle-mic');
      const iconMic = document.getElementById('icon-mic');
      if (btnMic && iconMic) {
        btnMic.classList.add('active-danger');
        iconMic.textContent = '🎙️🚫';
        btnMic.title = 'Micrófono desactivado (Modo solo escucha)';
      }
    }

    if (this.currentChannelId) {
      this.leaveVoiceChannel(false);
    }

    this.currentChannelId = channelId;
    this.currentChannelName = channelName;

    this.socket.emit('voice:join', { channelId });
    this.playFeedbackTone('join');
    this.updateUIStatus(true);
  }

  leaveVoiceChannel(playSound = true) {
    if (!this.currentChannelId) return;

    this.socket.emit('voice:leave');

    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();

    this.remoteAudios.forEach((audio) => {
      audio.srcObject = null;
      audio.remove();
    });
    this.remoteAudios.clear();
    this.peerGainNodes.clear();
    this.peerPanners.clear();

    this.currentChannelId = null;
    this.currentChannelName = '';
    this.setLocalSpeakingState(false);

    if (playSound) this.playFeedbackTone('leave');
    this.updateUIStatus(false);
  }

  // ===================== WEBRTC SIGNALING =====================

  setupSocketListeners() {
    this.socket.on('voice:joined_success', async ({ channelId, peers }) => {
      for (const peer of peers) {
        await this.createPeerConnection(peer.socketId, true);
      }
    });

    this.socket.on('voice:peer_joined', async ({ socketId, user }) => {
      await this.createPeerConnection(socketId, false);
    });

    this.socket.on('voice:signal', async ({ from, signal }) => {
      let pc = this.peerConnections.get(from);
      if (!pc) {
        pc = await this.createPeerConnection(from, false);
      }

      if (signal.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        const answer = await pc.createAnswer();
        answer.sdp = this.setOpusPreferences(answer.sdp);
        await pc.setLocalDescription(answer);
        this.socket.emit('voice:signal', {
          to: from,
          signal: pc.localDescription
        });
      } else if (signal.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
      } else if (signal.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch (err) {}
      }
    });

    this.socket.on('voice:peer_left', ({ socketId }) => {
      const pc = this.peerConnections.get(socketId);
      if (pc) {
        pc.close();
        this.peerConnections.delete(socketId);
      }
      const audio = this.remoteAudios.get(socketId);
      if (audio) {
        audio.srcObject = null;
        audio.remove();
        this.remoteAudios.delete(socketId);
      }
      this.peerGainNodes.delete(socketId);
      this.peerPanners.delete(socketId);
    });

    this.socket.on('voice:channel_deleted', () => {
      alert('El canal de voz fue eliminado por un Administrador.');
      this.leaveVoiceChannel(true);
    });

    this.socket.on('voice:kicked_by_admin', ({ by }) => {
      alert(`Has sido desconectado de la voz por el Administrador (${by}).`);
      this.leaveVoiceChannel(true);
    });

    this.socket.on('voice:force_muted_by_admin', ({ by }) => {
      if (!this.isMuted) {
        this.toggleMute(true);
        alert(`Has sido silenciado por un Administrador (${by || 'Admin'}).`);
      }
    });

    this.socket.on('voice:full_error', ({ message }) => {
      alert(message);
      this.updateUIStatus(false);
    });
  }

  async createPeerConnection(peerSocketId, isInitiator) {
    if (this.peerConnections.has(peerSocketId)) {
      return this.peerConnections.get(peerSocketId);
    }

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers
    });

    this.peerConnections.set(peerSocketId, pc);

    const streamToSend = this.processedStream || this.rawStream;
    if (streamToSend) {
      streamToSend.getAudioTracks().forEach((track) => {
        // En modo PTT, iniciar silenciado hasta que presione la tecla
        if (this.voiceMode === 'ptt' && !this.pttActive) {
          track.enabled = false;
        }
        pc.addTrack(track, streamToSend);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('voice:signal', {
          to: peerSocketId,
          signal: { candidate: event.candidate }
        });
      }
    };

    // Recepción con GainNode y StereoPannerNode
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      let audio = this.remoteAudios.get(peerSocketId);

      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        audio.playsInline = true;
        document.getElementById('remote-audio-container').appendChild(audio);
        this.remoteAudios.set(peerSocketId, audio);
      }

      audio.srcObject = remoteStream;

      try {
        if (!this.audioContext) {
          this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        const source = this.audioContext.createMediaStreamSource(remoteStream);
        const gainNode = this.audioContext.createGain();

        // Stereo Panner (Audio Espacial)
        let pannerNode = null;
        if (typeof this.audioContext.createStereoPanner === 'function') {
          pannerNode = this.audioContext.createStereoPanner();
          const userPan = this.peerPans.get(peerSocketId) || 0;
          pannerNode.pan.value = userPan;
          source.connect(pannerNode);
          pannerNode.connect(gainNode);
          this.peerPanners.set(peerSocketId, pannerNode);
        } else {
          source.connect(gainNode);
        }

        const userVol = this.peerVolumes.has(peerSocketId) ? this.peerVolumes.get(peerSocketId) : 1.0;
        gainNode.gain.value = this.isDeafened ? 0 : userVol;
        gainNode.connect(this.audioContext.destination);

        audio.muted = true;
        this.peerGainNodes.set(peerSocketId, gainNode);
      } catch (err) {
        console.warn('Fallback a audio element estándar:', err);
        audio.muted = this.isDeafened;
        audio.volume = Math.min(1.0, this.peerVolumes.get(peerSocketId) || 1.0);
      }
    };

    if (isInitiator) {
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: false
        });
        offer.sdp = this.setOpusPreferences(offer.sdp);
        await pc.setLocalDescription(offer);
        this.socket.emit('voice:signal', {
          to: peerSocketId,
          signal: pc.localDescription
        });
      } catch (err) {
        console.error('Error creando oferta WebRTC:', err);
      }
    }

    return pc;
  }

  // ===================== MUTE Y DEAFEN =====================

  async toggleMute(forceState = null) {
    if (!this.processedStream && (forceState === false || (forceState === null && this.isMuted))) {
      try {
        await this.initLocalMicrophone();
        if (this.processedStream) {
          this.peerConnections.forEach((pc) => {
            this.processedStream.getAudioTracks().forEach((track) => {
              pc.addTrack(track, this.processedStream);
            });
          });
          this.isMuted = false;
        }
      } catch (err) {
        alert('Para hablar, permite el acceso al micrófono en el icono del candado 🔒 del navegador.');
        return;
      }
    } else {
      this.isMuted = forceState !== null ? forceState : !this.isMuted;
    }

    if (this.rawStream) {
      this.rawStream.getAudioTracks().forEach(t => t.enabled = !this.isMuted);
    }
    if (this.processedStream) {
      this.processedStream.getAudioTracks().forEach(t => t.enabled = !this.isMuted);
    }

    this.playFeedbackTone(this.isMuted ? 'mute' : 'unmute');

    const btnMic = document.getElementById('btn-toggle-mic');
    const iconMic = document.getElementById('icon-mic');
    if (btnMic && iconMic) {
      if (this.isMuted) {
        btnMic.classList.add('active-danger');
        iconMic.textContent = '🎙️🚫';
        btnMic.title = 'Activar Micrófono';
      } else {
        btnMic.classList.remove('active-danger');
        iconMic.textContent = '🎙️';
        btnMic.title = 'Silenciar Micrófono';
      }
    }

    this.socket.emit('voice:toggle_state', {
      isMuted: this.isMuted,
      isDeafened: this.isDeafened
    });
  }

  toggleDeafen() {
    this.isDeafened = !this.isDeafened;

    if (this.isDeafened && !this.isMuted) {
      this.toggleMute(true);
    }

    this.peerGainNodes.forEach((gainNode, socketId) => {
      const userVol = this.peerVolumes.get(socketId) || 1.0;
      gainNode.gain.value = this.isDeafened ? 0 : userVol;
    });

    this.remoteAudios.forEach((audio) => {
      audio.muted = true;
    });

    this.playFeedbackTone(this.isDeafened ? 'mute' : 'unmute');

    const btnDeafen = document.getElementById('btn-toggle-deafen');
    const iconDeafen = document.getElementById('icon-deafen');
    if (btnDeafen && iconDeafen) {
      if (this.isDeafened) {
        btnDeafen.classList.add('active-danger');
        iconDeafen.textContent = '🔇';
        btnDeafen.title = 'Activar Sonido';
      } else {
        btnDeafen.classList.remove('active-danger');
        iconDeafen.textContent = '🎧';
        btnDeafen.title = 'Ensordecer';
      }
    }

    this.socket.emit('voice:toggle_state', {
      isMuted: this.isMuted,
      isDeafened: this.isDeafened
    });
  }

  updateUIStatus(connected) {
    const box = document.getElementById('voice-connection-box');
    const chanName = document.getElementById('current-voice-channel-name');
    const stateTitle = document.getElementById('voice-state-title');
    const btnRequestMic = document.getElementById('btn-request-mic');
    const signalIndicator = document.getElementById('voice-signal-indicator');

    if (box && chanName) {
      if (connected) {
        box.classList.remove('hidden');
        chanName.textContent = this.currentChannelName;

        if (this.isListenerMode) {
          if (stateTitle) stateTitle.textContent = '🎧 Modo Oyente';
          if (btnRequestMic) btnRequestMic.classList.remove('hidden');
          if (signalIndicator) signalIndicator.style.backgroundColor = '#00B0F4';
        } else {
          if (stateTitle) stateTitle.textContent = '🟢 Voz Conectada';
          if (btnRequestMic) btnRequestMic.classList.add('hidden');
          if (signalIndicator) signalIndicator.style.backgroundColor = '#57F287';
        }
      } else {
        box.classList.add('hidden');
        chanName.textContent = '';
        if (btnRequestMic) btnRequestMic.classList.add('hidden');
      }
    }
  }
}

window.VoiceEngine = VoiceEngine;
