/** Copia deliberada del contenido de docs/legal/DISCLAIMER.md (raiz del repo)
 * -- no se lee ese archivo en runtime porque el backend corre en Docker con
 * contexto de build "./backend" (docs/legal/DISCLAIMER.md ni siquiera
 * entraria a esa imagen) y el frontend tampoco tiene pipeline para importar
 * markdown crudo. Mismo patron que lib/changelog.ts: el contenido vive como
 * dato en TS, no como archivo externo.
 *
 * IMPORTANTE: si cambias el contenido aqui, actualiza tambien
 * docs/legal/DISCLAIMER.md (la version "legible"/para revision legal) y sube
 * DISCLAIMER_VERSION --
 * DEBE coincidir exacto con settings.DISCLAIMER_VERSION en
 * backend/app/core/config.py, o el backend y el frontend van a discrepar
 * sobre si un usuario ya acepto la version vigente. */
export const DISCLAIMER_VERSION = '2026-08-15'

export const DISCLAIMER_TEXT = `
**Última actualización:** 15 de agosto de 2026

## 1. Quién es responsable de tus datos

NorthernLights es un proyecto independiente de finanzas personales (en adelante, "el responsable"),
operado de forma personal y no como una entidad empresarial constituida por ahora. Puedes contactar
al responsable para cualquier duda, solicitud o ejercicio de derechos relacionados con tus datos
personales usando el formulario de feedback dentro de la propia app (ícono de Novedades, en la barra
lateral) — no hace falta un canal externo.

## 2. Qué datos personales recabamos

### 2.1 Datos de identidad y cuenta
Nombre, correo electrónico, contraseña (protegida mediante cifrado, nunca almacenada en texto
plano), avatar, rol dentro de la plataforma, y proveedor de autenticación utilizado (correo/contraseña
o Google, este último aún no activo — ver sección 4.2).

### 2.2 Datos financieros
- Cuentas: nombre de la cuenta, **últimos 4 dígitos de tarjeta**, saldo, límite de crédito, tasa de
  interés, día de corte y pago.
- Transacciones: monto, fecha, descripción, categoría, notas, etiquetas y, en gastos compartidos, el
  **nombre de la persona** con quien se comparte.
- Deudas: nombre de la deuda, **nombre del acreedor o deudor**, monto, tasa, plan de pagos, y
  participantes si es compartida.
- Presupuestos, categorías personalizadas, gastos recurrentes/suscripciones (incluyendo la URL del
  servicio asociado).
- Reportes e insights financieros generados automáticamente sobre tu comportamiento financiero.

### 2.3 Datos del Asesor de IA (chat)
El texto completo de cada mensaje que envías al Asesor de IA **se guarda de forma permanente** en
nuestra base de datos, sin fecha de expiración automática, hasta que tú lo borres manualmente desde
Ajustes o el botón de "limpiar historial" dentro del chat.

Los archivos PDF de estados de cuenta bancarios que adjuntes en el chat **nunca se almacenan** — ni
el archivo ni su contraseña. Se procesan en memoria únicamente para esa respuesta y se descartan de
inmediato después. La excepción es el texto que, como resultado de esa conversación, termine
formando parte de una transacción o deuda que decidas crear, o del propio mensaje de chat guardado.

### 2.4 Datos de dispositivo
Nombre y tipo de dispositivo, y token de notificaciones push (una vez que esta función se active —
ver sección 4.3). El token que mantiene tu sesión iniciada en ese dispositivo también se guarda
protegido, nunca en texto plano.

### 2.5 Comentarios y reportes de errores
Si nos envías feedback o reportas un error desde la app, ese mensaje queda visible para cualquier
administrador de la plataforma, no solo para el equipo que lo atiende.

## 3. Para qué usamos tus datos

**Finalidades necesarias para operar el servicio:**
- Crear y administrar tu cuenta, autenticarte y mantener tu sesión.
- Registrar y mostrarte tus cuentas, transacciones, deudas, presupuestos y reportes.
- Generar recomendaciones, alertas e insights financieros automatizados.
- Permitir que el Asesor de IA responda tus preguntas y, si tú lo confirmas, cree movimientos en tu
  nombre.
- Enviarte notificaciones dentro de la app sobre deudas, presupuesto, pagos y suscripciones.
- Atender tus reportes de error o sugerencias.

No usamos tus datos financieros para publicidad, no los vendemos, y no existen hoy en la app
herramientas de analítica o rastreo de terceros (no hay Sentry, Google Analytics ni similares
integrados).

## 4. A quién le compartimos tu información

### 4.1 Proveedores de Inteligencia Artificial (Google Gemini / Anthropic Claude) — requiere tu consentimiento específico

Esta es la transferencia de datos más sensible de toda la app y la que más te conviene leer con
cuidado.

Cada vez que usas el Asesor de IA, le enviamos junto con tu mensaje **un resumen de tu situación
financiera actual**: tus cuentas, deudas, presupuesto, transacciones recientes y un panorama general
de tu salud financiera. Esto ocurre en **cada mensaje**, no solo cuando preguntas explícitamente
sobre tus finanzas. También reenviamos tu historial reciente de chat (los últimos ~10 intercambios)
en cada llamada, para que la conversación tenga contexto.

Si adjuntas un PDF de un estado de cuenta bancario, ese archivo (ya sin contraseña) se envía
directamente al proveedor de IA activo para que pueda leerlo.

El proveedor que procesa esta información puede ser **Google (Gemini)** o **Anthropic (Claude)**,
según la configuración vigente de la app.

En resumen: usar el Asesor de IA implica compartir tus datos financieros —potencialmente incluyendo
el contenido completo de tus estados de cuenta bancarios— con un proveedor externo de inteligencia
artificial.

### 4.2 Inicio de sesión con Google (implementado, no activo hoy)
La app tiene la capacidad técnica de ofrecer inicio de sesión con Google, pero **hoy está
deshabilitada** — no verás esa opción en la pantalla de login. Cuando se active, ese proceso
compartirá información con Google y recibirá de vuelta tu correo, nombre, foto de perfil e
identificador único de tu cuenta de Google. Actualizaremos este aviso o te notificaremos antes de
activar esta función si implica un cambio relevante en el tratamiento de tus datos.

### 4.3 Notificaciones push vía Firebase (implementado, no activo hoy)
El código para enviar notificaciones push a través de Firebase Cloud Messaging (Google) existe pero
**hoy no está en funcionamiento** por falta de configuración. Cuando se active, se compartirá con
Firebase el token de tu dispositivo y el contenido de la notificación correspondiente.

### 4.4 Lo que no compartimos
No usamos ni compartimos tus datos con servicios de analítica, publicidad o rastreo de terceros. No
enviamos correos electrónicos reales todavía (la recuperación de contraseña por correo existe en el
código pero no está activa ni conectada a un proveedor de envío).

## 5. Cuánto tiempo conservamos tus datos

Tus datos financieros y de cuenta se conservan mientras tu cuenta exista. El historial del Asesor de
IA se conserva de forma indefinida hasta que tú lo borres manualmente. Puedes eliminar datos de
forma selectiva o eliminar tu cuenta por completo en cualquier momento desde Ajustes (ver sección 8).

## 6. Cómo protegemos tus datos

Preferimos ser precisos aquí en vez de prometer de más:

- **Cada usuario solo puede ver su propia información**, gracias a un mecanismo de la base de datos
  llamado Row Level Security (RLS): controles de acceso que impiden que un usuario, incluso por
  error, llegue a ver los datos de otro.
- **Tus datos financieros y de cuenta no están cifrados mientras están guardados en nuestra base de
  datos.** El aislamiento por RLS es una buena práctica de seguridad, pero no es lo mismo que
  cifrado — preferimos decírtelo claro en vez de dejarte suponer algo que no es cierto.
- **Tu contraseña sí está protegida mediante un cifrado especializado para contraseñas (bcrypt)**:
  ni siquiera nosotros podemos ver tu contraseña original, solo una versión irreversible de ella.
- **El token que mantiene tu sesión iniciada también está cifrado** antes de guardarse, y se renueva
  automáticamente cada cierto tiempo para reducir el riesgo si alguna vez se filtrara.
- **La comunicación entre tu navegador y nuestros servidores viaja cifrada (HTTPS/TLS)** — la misma
  protección que representa el candado en tu navegador.
- **Las contraseñas de tus PDFs de estados de cuenta nunca se guardan** en ningún lado — se usan una
  sola vez para abrir el archivo y se descartan de inmediato.

## 7. Acceso interno — panel de administrador

Existe un rol de administrador de la plataforma con acceso limitado a datos de otros usuarios:

**Sí puede ver:** correo, nombre, rol, proveedor de autenticación, si la cuenta está activa, fecha de
alta, conteos (no montos) de cuentas y transacciones, estadísticas agregadas y anónimas de toda la
plataforma, y los mensajes de feedback/reporte de errores que envíes.

**No puede ver:** saldos, transacciones individuales, deudas, ni el contenido de tu chat con el
Asesor de IA de otros usuarios. El acceso administrativo está limitado a metadatos de cuenta,
agregados de plataforma y feedback.

## 8. Tus derechos sobre tus datos (derechos ARCO)

Tienes derecho a Acceder, Rectificar, Cancelar y Oponerte al tratamiento de tus datos personales, así
como a la portabilidad de los mismos.

Puedes ejercer varios de estos derechos directamente desde la app, en **Ajustes**:
- Borrado selectivo de datos específicos.
- Eliminación permanente de tu cuenta y de todos tus datos asociados.
- Cierre de sesión individual o de todas tus sesiones activas.

Para solicitudes que no puedas resolver directamente ahí (por ejemplo, rectificación puntual de un
dato o portabilidad completa de tu información en un formato específico), contáctanos usando el
formulario de feedback dentro de la app. Responderemos en un plazo razonable, no mayor a 20 días
hábiles.

## 9. Cómo mantenemos tu sesión iniciada

Usamos un sistema de sesión basado en tokens para que no tengas que volver a iniciar sesión cada vez
que abres la app. No usamos cookies de rastreo ni de terceros con fines publicitarios.

## 10. Menores de edad

NorthernLights no establece una edad mínima para su uso: administrar tus propias finanzas es algo
que no debería depender de haber alcanzado la mayoría de edad. No pedimos ni verificamos edad al
registrarte. Si eres menor de edad y la legislación de tu país exige el consentimiento de un padre,
madre o tutor para el tratamiento de tus datos personales, te recomendamos usar la app con su
conocimiento.

## 11. Cambios a este aviso

Podemos actualizar este aviso de privacidad en cualquier momento. Si el cambio es significativo (por
ejemplo, activar el inicio de sesión con Google o las notificaciones push descritas en las secciones
4.2 y 4.3), te lo notificaremos dentro de la app antes de que el cambio entre en vigor.

## 12. Contacto

Para cualquier duda, aclaración o solicitud relacionada con el tratamiento de tus datos personales,
usa el formulario de feedback dentro de la app.
`.trim()
