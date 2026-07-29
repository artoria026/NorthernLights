/** Prompt reusable para que el usuario lo pegue en OTRA IA (ChatGPT, Gemini,
 * etc. -- la conversación donde ya lleva el registro informal de sus
 * finanzas) y traiga de vuelta un resumen en el formato que el Asesor IA
 * espera para importarlo. Vivía en ImportarDatos.tsx antes de que esa
 * pantalla se consolidara dentro de Asesor IA. */
export const EXPORT_PROMPT = `A partir de todo nuestro historial de conversación sobre mis finanzas, genera
un resumen en Markdown que voy a importar a mi app de finanzas personales.
No inventes cifras que no hayamos discutido — si algo no está claro o no lo
mencioné, dilo explícitamente en vez de adivinar. Sigue esta estructura:

## Cuentas
Para cada cuenta bancaria, de ahorro, efectivo o tarjeta de crédito:
- Nombre, institución, tipo (débito/ahorro/efectivo/tarjeta de crédito)
- Saldo actual (lo que tengo, o lo que debo hoy si es tarjeta)
- Si es tarjeta de crédito: límite de crédito, tasa de interés anual,
  día de corte, día límite de pago

## Deudas con plan de pago activo
Deudas que estoy pagando regularmente:
- Nombre, acreedor, saldo actual, monto original (si cambió por quita/descuento)
- Cuota, frecuencia (semanal/quincenal/mensual), día de pago
- Cuotas totales y pagadas si aplica, tasa de interés si aplica

## Deudas sin plan de pago
Deudas que existen pero no tienen pagos organizados todavía:
- Nombre, acreedor, saldo actual, notas relevantes

## Gastos recurrentes, suscripciones e ingresos fijos
Cosas que se cobran o reciben periódicamente y no son una deuda con saldo:
- Nombre, monto, frecuencia, cuenta desde/hacia la que se mueve
- Categoría más parecida de esta lista: Comida y Bebidas, Transporte y
  Movilidad, Vivienda y Hogar, Salud y Bienestar, Ropa y Cuidado Personal,
  Ocio y Entretenimiento, Educación y Desarrollo, Mascotas, Otro Gasto,
  Empleo principal, Freelance, Otro

## Notas y dudas
Cualquier cosa ambigua o que discutimos sin llegar a una cifra clara.

Si no tienes información para alguna sección, escribe "Sin datos" en vez de
omitirla. No agregues explicaciones fuera de estas secciones.`
