# 📦🎙️ SpecialDeliverySpeak - Canales de Voz DSP & Chat en Vivo

Una aplicación web avanzada (estilo Discord) diseñada para que tú y tus amigos puedan conectarse a salas de voz con **calidad de estudio en tiempo real (DSP)**, chatear por texto y donde tú como **Administrador Maestro** tienes el control total para gestionar canales, moderar y designar otros administradores.

---

## ✨ Nuevas Características Implementadas

### 1. 👑⭐ Administrador Maestro & Jerarquía de Moderación
- **Cuenta Maestra de Administrador**:
  - Clave en [`.env`](file:///C:/Users/Windows%2010%20Pro/.gemini/antigravity/scratch/voice-chat-app/.env): `MASTER_ADMIN_PASSWORD=master123`.
  - Insignia dorada exclusiva: `👑⭐ Super Admin`.
- **Facultades exclusivas del Administrador Maestro**:
  - **Dar o Quitar Administrador**: Asciende a tus amigos a Administrador (`👑`) o degrádalos a Miembro regular con un solo clic.
  - **Banear Usuarios (Ban permanente)**: Bloquea a usuarios indeseados para que no puedan volver a conectarse al servidor (bloqueo por IP y nombre).
- **Facultades de Moderación (Master Admin y Administradores regulares)**:
  - **Mutear a otros (Server Mute `🎙️🚫`)**: Silencia de forma remota el micrófono de un usuario ruidoso.
  - **Expulsar de Voz (`👢`)**: Desconecta al usuario del canal de voz.
  - **Expulsar del Servidor (Kick)**: Desconecta al usuario del servidor por completo.
  - **Crear y Borrar Canales**: Crea canales de voz o texto y elimina canales con confirmación.

### 2. 🎛️ Cadena de Audio DSP (Mejorador de Voz Siempre Conectado)
- **Filtro Pasa-Altos (High-Pass a 85 Hz)**: Elimina retumbes de escritorio, golpes accidentales y zumbidos de baja frecuencia.
- **Ecualizador de Presencia Vocal (Peaking EQ a 3 kHz)**: Añade +3.5 dB de presencia vocal cristalina para que las palabras se entiendan con máxima inteligibilidad.
- **Compresor Dinámico de Estudio (`DynamicsCompressorNode`)**: Nivela la voz automáticamente, amplificando susurros y reduciendo gritos para no saturar los altavoces de tus amigos.

### 3. 🛡️ Interruptor de Supresión de Sonido (Noise Suppression)
- Botón directo en la barra inferior `🛡️` para activar o desactivar la cancelación de ruido ambiente al vuelo.

### 4. 🔊 Control de Volumen Individual por Usuario (0% al 200%)
- Al lado de cada amigo en la sala de voz verás un control deslizante de volumen `🔊 [ ────●──── ] 100%`.
- Cada participante puede ajustar de forma personalizada el volumen de cada uno de sus amigos (¡incluso amplificar hasta el 200% a los que se escuchen bajito!).

---

## 🚀 Cómo Iniciar el Servidor

1. Inicia el servidor haciendo doble clic en:
   👉 **`iniciar-servidor.bat`**
2. Si quieres invitar a tus amigos por internet con HTTPS seguro (Cloudflare Tunnel), haz doble clic en:
   👉 **`compartir-con-amigos.bat`**
3. Entra desde tu navegador en:
   👉 **`http://localhost:3000`**

---

## 🔑 Contraseñas de Acceso

- **Administrador Maestro (Control Total)**: `master123`
- **Administrador Regular**: `admin123`
- *(Puedes cambiarlas en el archivo [`.env`](file:///C:/Users/Windows%2010%20Pro/.gemini/antigravity/scratch/voice-chat-app/.env))*.
