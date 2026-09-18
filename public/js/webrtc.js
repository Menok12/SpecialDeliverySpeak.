// =========================================================
// SpecialDeliverySpeak - WebRTC, Studio DSP & Audio Manager
// =========================================================

class VoiceEngine {
  constructor(socket) {
    this.socket = socket;
    this.rawStream = null;
    this.processedStream = null;

    this.peerConnections = new Map(); // socketId -> RTCPeerConnection
    this.remoteAudios = new Map(); // socketId -> HTMLAudioElement
    this.peerGainNodes = new Map(); // socketId -> GainNode (control de volumen individual)
    this.peerVolumes = new Map(); // socketId -> volume ratio (0.0 a 2.0, default 1.0)

    this.currentChannelId = null;
    this.currentChannelName = '';
    this.isMuted = false;
    this.isDeafened = false;
    this.isSpeaking = false;
    this.noiseSuppressionEnabled = true; // Supresión de sonido activada por defecto

    this.audioContext = null;
    this.analyser = null;
    this.animFrameId = null;

    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ];

    this.setupSocketListeners();
  }

  // Sintetizador de tonos para eventos
  playFeedbackTone(type) {
    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      osc.connect(gain);
      gain.connect(this.audioContext.destination);

      const now = this.audioContext.currentTime;

      if (type === 'join') {
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(660, now + 0.12);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
      } else if (type === 'leave') {
        osc.frequency.setValueAtTime(580, now);
        osc.frequency.exponentialRampToValueAtTime(330, now + 0.12);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
      } else if (type === 'mute') {
        osc.frequency.setValueAtTime(320, now);
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
      } else if (type === 'unmute') {
        osc.frequency.setValueAtTime(620, now);
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
      }
    } catch (e) {
      // Ignorar restricciones de reproducción previa
    }
  }

  // Inicializar captura y cadena DSP de mejora de voz (Studio Voice Enhancer)
  async initLocalMicrophone() {
    if (this.processedStream) return this.processedStream;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: this.noiseSuppressionEnabled,
          autoGainControl: true
        },
        video: false
      });

      this.rawStream = stream;

      // Crear o reanudar AudioContext
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // ========================================================
      // CADENA DSP: MEJORADOR DE VOZ SIEMPRE CONECTADO
      // Raw Mic -> HighPass (85Hz) -> Presence EQ (3kHz) -> Compressor -> Destination
      // ========================================================
      const micSource = this.audioContext.createMediaStreamSource(stream);

      // 1. Filtro Pasa-Altos: Elimina retumbes graves de escritorio y ruidos de ventilador
      const highPassFilter = this.audioContext.createBiquadFilter();
      highPassFilter.type = 'highpass';
      highPassFilter.frequency.value = 85;
      highPassFilter.Q.value = 0.7;

      // 2. Ecualizador de Presencia Vocal: Acentúa la articulación y claridad de las palabras
      const presenceEQ = this.audioContext.createBiquadFilter();
      presenceEQ.type = 'peaking';
      presenceEQ.frequency.value = 3000;
      presenceEQ.Q.value = 1.2;
      presenceEQ.gain.value = 3.5; // +3.5 dB de presencia cristalina

      // 3. Compresor de Dinámica de Estudio: Nivela la voz y evita saturación de picos
      const compressor = this.audioContext.createDynamicsCompressor();
      compressor.threshold.value = -24; // dB
      compressor.knee.value = 30; // dB transición suave
      compressor.ratio.value = 4; // ratio 4:1
      compressor.attack.value = 0.003; // 3ms respuesta ultra rápida
      compressor.release.value = 0.25; // 250ms

      // 4. Analizador de Volumen para detección de habla
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.4;

      // 5. Destino de stream procesado para WebRTC
      const mediaDest = this.audioContext.createMediaStreamDestination();

      // Conexiones de la cadena
      micSource.connect(highPassFilter);
      highPassFilter.connect(presenceEQ);
      presenceEQ.connect(compressor);
      compressor.connect(this.analyser);
      compressor.connect(mediaDest);

      this.processedStream = mediaDest.stream;

      // Configurar detector de habla en tiempo real
      this.setupSpeakingDetector();

      const banner = document.getElementById('mic-perm-banner');
      if (banner) banner.classList.add('hidden');

      return this.processedStream;
    } catch (err) {
      console.warn('Error accediendo al micrófono:', err);
      const banner = document.getElementById('mic-perm-banner');
      if (banner) banner.classList.remove('hidden');
      throw err;
    }
  }

  // Detección en vivo de voz activa
  setupSpeakingDetector() {
    if (!this.analyser) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let speakingDebounce = false;

    const checkVolume = () => {
      if (!this.analyser || this.isMuted) {
        if (this.isSpeaking) {
          this.setLocalSpeakingState(false);
        }
        this.animFrameId = requestAnimationFrame(checkVolume);
        return;
      }

      this.analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;

      const isNowSpeaking = average > 14;

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
          }, 300);
        }
      }

      this.animFrameId = requestAnimationFrame(checkVolume);
    };

    checkVolume();
  }

  setLocalSpeakingState(isSpeaking) {
    this.isSpeaking = isSpeaking;
    const myAvatar = document.getElementById('my-avatar');
    if (myAvatar) {
      if (isSpeaking && !this.isMuted) {
        myAvatar.classList.add('speaking');
      } else {
        myAvatar.classList.remove('speaking');
      }
    }

    if (this.currentChannelId) {
      this.socket.emit('voice:speaking', { isSpeaking: isSpeaking && !this.isMuted });
    }
  }

  // Alternar supresión de sonido (Noise Suppression)
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
        } catch (e) {
          console.warn('No se pudieron aplicar restricciones de supresión de ruido:', e);
        }
      }
    }

    // Actualizar botón en la UI
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

  // ===================== CONTROL DE VOLUMEN INDIVIDUAL =====================

  setUserVolume(peerSocketId, volumeRatio) {
    const ratio = Math.max(0, Math.min(2.0, parseFloat(volumeRatio)));
    this.peerVolumes.set(peerSocketId, ratio);

    const gainNode = this.peerGainNodes.get(peerSocketId);
    if (gainNode) {
      if (!this.isDeafened) {
        gainNode.gain.setValueAtTime(ratio, this.audioContext ? this.audioContext.currentTime : 0);
      }
    }

    // También actualizar volumen directo del elemento audio si existe
    const audio = this.remoteAudios.get(peerSocketId);
    if (audio) {
      audio.volume = Math.min(1.0, ratio);
    }
  }

  getUserVolume(peerSocketId) {
    if (this.peerVolumes.has(peerSocketId)) {
      return this.peerVolumes.get(peerSocketId);
    }
    return 1.0;
  }

  // ===================== UNIRSE Y SALIR DE CANALES =====================

  async joinVoiceChannel(channelId, channelName) {
    if (this.currentChannelId === channelId) return;

    try {
      await this.initLocalMicrophone();
    } catch (e) {
      console.warn('Micrófono no disponible. Entrando en modo solo escucha.', e);
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
        } catch (err) {
          console.warn('Error añadiendo ICE Candidate:', err);
        }
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
    });

    this.socket.on('voice:channel_deleted', () => {
      alert('El canal de voz en el que estabas fue eliminado por un Administrador.');
      this.leaveVoiceChannel(true);
    });

    this.socket.on('voice:kicked_by_admin', ({ by }) => {
      alert(`Has sido desconectado de la sala de voz por el Administrador (${by}).`);
      this.leaveVoiceChannel(true);
    });

    this.socket.on('voice:force_muted_by_admin', ({ by }) => {
      if (!this.isMuted) {
        this.toggleMute(true);
        alert(`Has sido silenciado en el servidor por un Administrador (${by || 'Admin'}).`);
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

    // Enviar el stream con audio mejorado (DSP Studio) si está disponible
    const streamToSend = this.processedStream || this.rawStream;
    if (streamToSend) {
      streamToSend.getAudioTracks().forEach((track) => {
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

    // Recepción y control individual de volumen con GainNode
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

      // Conectar a GainNode para permitir subir volumen hasta el 200%
      try {
        if (!this.audioContext) {
          this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        const source = this.audioContext.createMediaStreamSource(remoteStream);
        const gainNode = this.audioContext.createGain();

        const userVol = this.peerVolumes.has(peerSocketId) ? this.peerVolumes.get(peerSocketId) : 1.0;
        gainNode.gain.value = this.isDeafened ? 0 : userVol;

        source.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        // Como el gainNode ya suena en destination, silenciamos el <audio> tag para no duplicar sonido
        audio.muted = true;
        this.peerGainNodes.set(peerSocketId, gainNode);
      } catch (err) {
        console.warn('GainNode fallback a elemento HTML audio:', err);
        audio.muted = this.isDeafened;
        audio.volume = Math.min(1.0, this.peerVolumes.get(peerSocketId) || 1.0);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        const audio = this.remoteAudios.get(peerSocketId);
        if (audio) {
          audio.srcObject = null;
          audio.remove();
          this.remoteAudios.delete(peerSocketId);
        }
        this.peerGainNodes.delete(peerSocketId);
      }
    };

    if (isInitiator) {
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: false
        });
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
        alert('Para hablar, haz clic en el icono de candado 🔒 o ajustes junto a la dirección del navegador y cambia el Micrófono a "Permitir".');
        return;
      }
    } else {
      this.isMuted = forceState !== null ? forceState : !this.isMuted;
    }

    // Silenciar pistas de audio
    if (this.rawStream) {
      this.rawStream.getAudioTracks().forEach((track) => {
        track.enabled = !this.isMuted;
      });
    }
    if (this.processedStream) {
      this.processedStream.getAudioTracks().forEach((track) => {
        track.enabled = !this.isMuted;
      });
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

    // Ajustar todos los gainNodes remotos
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
    if (box && chanName) {
      if (connected) {
        box.classList.remove('hidden');
        chanName.textContent = this.currentChannelName;
      } else {
        box.classList.add('hidden');
        chanName.textContent = '';
      }
    }
  }
}

window.VoiceEngine = VoiceEngine;
