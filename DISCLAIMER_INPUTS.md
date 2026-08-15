# Insumos para el aviso de privacidad / disclaimer — NorthernLights

Este documento **no es el disclaimer** — es el inventario de features y manejo de datos que otro
agente (o abogado) va a usar como insumo para redactarlo. Todo lo aquí escrito está verificado
contra el código real del repo (`/home/artoria026/projects/personal/northern_lights`), con
referencias de archivo:línea para poder confirmarlo. Fecha del corte: 2026-08-14.

**Regla de oro para quien redacte el disclaimer con esto**: no prometer nada que no esté confirmado
aquí. En particular, ver la sección 4 — hay una distinción legal importante entre "cifrado" y
"aislado por RLS" que no se puede mezclar.

---

## 1. Qué es la app

App web de finanzas personales de un solo usuario por cuenta (no hay cuentas compartidas/familiares
como concepto de producto, aunque una deuda o transacción individual sí puede marcarse como
"compartida" con un tercero por nombre libre). Contabilidad de doble entrada, presupuesto,
seguimiento de deudas, gastos recurrentes/suscripciones, reportes históricos, y un asesor financiero
con IA que puede leer y crear movimientos por chat, incluyendo adjuntar PDFs de estados de cuenta
bancarios.

---

## 2. Inventario de pantallas/features

| Pantalla | Qué hace | Datos del usuario involucrados |
|---|---|---|
| Login / Registro | Alta e inicio de sesión con email+contraseña; login con Google existe en el backend pero **está deshabilitado hoy** en el botón del frontend (`frontend-web/src/pages/Login.tsx` — `GOOGLE_LOGIN_ENABLED = false`, sin `GOOGLE_CLIENT_ID`/`SECRET` configurados). | Nombre, email, contraseña. |
| Inicio (Dashboard) | Resumen general: cuentas, presupuesto, deudas, recurrentes, insights, reportes del mes, transacciones recientes. | Prácticamente todo el snapshot financiero del usuario, de un vistazo. |
| Cuentas | Alta/edición/eliminación de cuentas (banco, efectivo, TDC, ahorro), reconciliación, logo propio. | Nombre de cuenta, **últimos 4 dígitos de tarjeta**, saldo, límite de crédito, tasa de interés, día de corte/pago, logo (imagen). |
| Transacciones | Alta/edición/borrado de movimientos, gastos compartidos, calendario. | Monto, fecha, descripción, categoría, notas, tags, y **nombre de la persona** en un gasto compartido. |
| Categorías | Categorías propias y del sistema, ocultar categorías. | Nombres/colores de categorías propias. |
| Deudas | Deudas propias o de terceros que le deben al usuario, planes de pago, "deuda sin plan". | Nombre de la deuda, **nombre del acreedor**, monto, tasa, cuotas, y quién más participa si es compartida. |
| Recurrentes / Suscripciones | Gastos/ingresos periódicos, confirmar o rechazar cobros generados automáticamente. | Monto, frecuencia, cuenta asociada, URL del servicio. |
| Presupuesto | Límites mensuales por categoría, tendencia, sugerencias. | Montos presupuestados vs. gastados. |
| Metas | Pantalla placeholder ("Próximamente") — no hay datos reales todavía. | Ninguno. |
| Insights | Recomendaciones/alertas generadas por IA sobre hábitos financieros. | Texto generado por IA + métricas financieras del usuario en ese momento. |
| Reportes | Reportes mensuales/anuales con resumen e insights de IA sobre el periodo. | Resúmenes financieros por periodo + insights de IA guardados. |
| Notificaciones | Bandeja in-app (alertas de deuda, presupuesto, tarjeta, pagos, suscripciones). | Título/cuerpo del aviso. |
| **Asesor IA** | Chat con IA que ve el estado financiero real, puede crear cuentas/deudas/gastos si se confirma, y puede leer PDFs de estados de cuenta adjuntos. | **La más sensible de todas** — ver sección 3, se manda info a un proveedor externo. |
| Ajustes | Perfil, cambio de password, preferencias, desvincular Google, **borrado selectivo de datos**, **eliminar cuenta permanentemente**, cerrar sesión (una o todas). | Control real del usuario sobre sus propios datos — relevante para cualquier derecho tipo ARCO/portabilidad que el disclaimer prometa. |
| Admin (solo rol admin) | Panel de administración de la plataforma. | Ve datos de **todos los usuarios** — ver sección 5. |

---

## 3. Qué datos personales/financieros se recolectan y guardan

- **Identidad**: nombre, email, contraseña (hasheada), avatar, rol, proveedor de auth (email/Google).
- **Dispositivos**: nombre y tipo de dispositivo, token de push (cuando se active), refresh token
  (hasheado, nunca en texto plano).
- **Financieros**: cuentas (con últimos 4 dígitos de tarjeta), todas las transacciones con doble
  entrada contable, deudas (incluyendo **nombre de acreedores/terceros**), presupuestos, gastos
  recurrentes/suscripciones, reportes e insights generados por IA sobre el comportamiento financiero
  del usuario.
- **Chat del Asesor IA**: el **texto completo de cada mensaje se guarda de forma permanente** en la
  base de datos (sin fecha de expiración automática) hasta que el usuario lo borre manualmente desde
  Ajustes o el botón de "limpiar historial" del chat. Los PDFs de estados de cuenta que se adjuntan
  **nunca se guardan** (ni el archivo ni su contraseña) — se procesan en memoria y se descartan
  después de la respuesta; lo que sí puede quedar es el texto extraído de ahí, si termina como parte
  de una transacción/deuda creada o del propio mensaje de chat guardado.
- **Feedback**: mensajes de bug/sugerencia que el usuario manda desde la app, visibles para
  cualquier administrador de la plataforma (no solo el propio usuario).

---

## 4. Terceros a los que se envía información del usuario

Esta es la sección más importante para el aviso de privacidad — probablemente donde se necesita
consentimiento explícito.

### Proveedores de IA (Google Gemini / Anthropic Claude)
- **En cada mensaje** que el usuario manda al Asesor IA, se envía junto con él **el snapshot
  financiero completo del usuario** (cuentas, deudas, presupuesto, transacciones recientes, salud
  financiera) como contexto — no solo cuando se pregunta explícitamente por finanzas.
- También se reenvía el **historial reciente del chat** (últimos ~10 intercambios) en cada llamada.
- Si el usuario adjunta un **PDF de estado de cuenta bancario**, ese archivo (ya sin contraseña) se
  manda directo al proveedor de IA para que lo lea.
- El proveedor activo es configurable (`AI_PROVIDER`: Gemini o Claude) — hoy el proyecto tiene
  configuradas credenciales para ambos.
- **Esto es, en la práctica, compartir datos financieros bancarios completos con un proveedor de IA
  externo (Google o Anthropic) en cada uso del Asesor.** El disclaimer necesita cubrir esto de forma
  explícita y probablemente pedir consentimiento específico, separado del consentimiento general de
  la app.

### Google OAuth (login) — implementado pero inactivo hoy
- El flujo existe en el backend y, si se activa, envía credenciales OAuth a Google y recibe de vuelta
  email, nombre, foto de perfil e ID único de Google.
- **No está activo en producción todavía** (botón deshabilitado en el frontend por falta de
  credenciales configuradas) — pero el disclaimer debería contemplarlo desde ahora si se planea
  activar pronto, para no tener que re-notificar después.

### Firebase Cloud Messaging (push notifications) — implementado pero inactivo hoy
- El código para mandar notificaciones push vía Firebase (Google) existe pero hoy es un no-op (no
  hay credenciales de Firebase configuradas). Cuando se active, se enviaría el token del dispositivo
  más el contenido de la notificación a Firebase.

### Lo que NO existe (para no prometer de más ni tampoco quedarse corto)
- No hay Sentry, analytics, ni ningún otro rastreador de terceros integrado hoy.
- No hay envío real de emails — la recuperación de contraseña por correo está *stubbeada* (solo
  registra en logs, nunca llega un correo real al usuario), y esa pantalla ni siquiera está expuesta
  en el frontend.

---

## 5. Panel de Administrador — qué puede ver un admin sobre otros usuarios

- **Sí puede ver**: email, nombre, rol, proveedor de auth, si la cuenta está activa, fecha de alta, y
  **conteos** de cuentas/transacciones (números, no montos ni contenido) de cualquier usuario de la
  plataforma. Estadísticas agregadas de toda la plataforma (usuarios totales, activos, nuevos,
  cuentas/transacciones/deudas totales — todo anónimo/agregado). El mensaje de feedback (bug/sugerencia)
  de cualquier usuario, con su estado.
- **Puede hacer**: activar/desactivar cualquier cuenta de usuario, cambiar el rol de cualquier
  usuario a admin/user (con excepción de sí mismo en ambos casos).
- **No puede ver** (no hay evidencia en el código de que exista): saldos, transacciones individuales,
  deudas, ni el contenido del chat de otros usuarios. El acceso cross-usuario está limitado a
  metadatos de cuenta + agregados de plataforma + feedback.

---

## 6. Seguridad real que existe hoy (ser precisos, no prometer de más)

- **Los datos NO están cifrados en reposo.** La separación entre usuarios es mediante **Row Level
  Security (RLS) de PostgreSQL** — un aislamiento lógico a nivel de motor de base de datos, reforzado
  por un rol de solo-lectura separado (`BYPASSRLS`) que usa el panel de Admin para sus agregaciones.
  Esto es real y es una buena práctica de arquitectura, pero **no es lo mismo que "cifrado"** — si el
  disclaimer va a usar la palabra "cifrado", tiene que ser sobre algo que de verdad esté cifrado (ver
  los dos puntos siguientes), no sobre el aislamiento entre cuentas.
- **Las contraseñas de usuario sí están hasheadas** con bcrypt (con salt, no reversible) — esto sí se
  puede llamar protección criptográfica real.
- **Los refresh tokens de sesión están hasheados** (SHA-256) antes de guardarse, nunca en texto
  plano; con rotación de un solo uso en cada renovación.
- **Hay HTTPS/TLS en producción** (Let's Encrypt vía Certbot sobre el dominio de la app) — el tráfico
  entre el navegador del usuario y el servidor sí viaja cifrado en tránsito. (El tramo interno entre
  el proxy y el backend, dentro del mismo servidor, es HTTP plano — patrón estándar, no expuesto a
  internet.)
- **Las contraseñas de los PDFs de estados de cuenta nunca se guardan** en ningún lado (ni disco, ni
  base de datos, ni logs) — se usan una sola vez en memoria para abrir el archivo y se descartan.

---

## 7. Estado legal actual — esto todavía no existe

- **No hay ningún checkbox de "Acepto los términos" ni link a política de privacidad** en el registro
  ni en el login, hoy.
- **No existe ningún archivo de términos y condiciones ni aviso de privacidad** en el repo todavía.
- Lo único parecido son frases de marketing en las pantallas de login/registro ("Tus datos, tus
  reglas", "Privado desde el día uno") que describen el aislamiento por RLS — hay que revisar que el
  disclaimer no contradiga ni sobre-prometa respecto a esas frases ya visibles.

---

## 8. Puntos clave que el disclaimer debería cubrir (checklist para quien lo redacte)

1. Qué datos personales se recolectan (identidad + financieros + chat) — ver secciones 2-3.
2. Que se comparte información financiera completa (incluyendo PDFs de estados de cuenta bancarios)
   con proveedores de IA externos (Google Gemini / Anthropic Claude) en cada uso del Asesor —
   probablemente amerita un consentimiento específico, no solo genérico.
3. Que el chat con el asesor se guarda de forma permanente hasta que el usuario lo borre.
4. Que existe un rol de administrador con visibilidad limitada (metadatos + agregados + feedback,
   no montos/transacciones/chat) sobre otros usuarios.
5. Descripción honesta de la seguridad: aislamiento por RLS + TLS en tránsito + hashing de
   contraseñas/tokens — **evitar la palabra "cifrado" para los datos en reposo**, no aplica hoy.
6. Derechos del usuario sobre sus datos: ya existe borrado selectivo y eliminación de cuenta en
   Ajustes — el disclaimer puede apoyarse en eso para hablar de derechos ARCO/portabilidad.
7. Uso de cookies/tokens de sesión (JWT + refresh token) para mantener la sesión iniciada.
8. Que Google OAuth y las notificaciones push están implementadas pero no activas todavía — dejar
   redactado para cubrir ambos casos sin tener que renotificar cuando se activen.
9. Edad mínima / no dirigido a menores (criterio de negocio a definir, no hay nada en el código hoy
   que lo determine).
10. Contacto para ejercer derechos / dudas de privacidad (canal a definir).

---

## 9. Dónde mostrarlo en la app (recomendación, no implementado todavía)

- **Registro**: checkbox obligatorio "Acepto los Términos y el Aviso de Privacidad" con link al
  documento, antes de poder crear la cuenta — hoy `Register.tsx` no tiene nada de esto.
- **Login/Registro**: link visible a los términos/privacidad en el pie de ambas pantallas, sin
  necesidad de tener cuenta para poder leerlo.
- **Ajustes**: link permanente para releer el aviso en cualquier momento.
- **Usuarios ya existentes**: si el aviso se agrega después de que ya haya cuentas creadas, conviene
  un aviso de "una sola vez" tipo el que ya existe para el changelog (`user.last_seen_changelog_version`
  + modal que se auto-abre — ver `frontend-web/src/components/ChangelogButton.tsx` como referencia de
  patrón) pero para una nueva versión de términos, bloqueando el uso hasta aceptar.
- **Asesor IA específicamente**: dado que es el único punto donde se comparten datos financieros con
  un tercero (Google/Anthropic), vale la pena un aviso corto y específico ahí (ej. la primera vez que
  se abre esa pantalla, o la primera vez que se adjunta un PDF) además del aviso general — no alcanza
  con que quede enterrado dentro del aviso de privacidad general.
