# Prompt de contexto — AeeS Acústico Web

> Copia TODO este archivo y pégalo en un chat nuevo con una IA (Claude, ChatGPT, Gemini…).
> No contiene claves ni contraseñas: esas viven solo en el `.env` de la PC y en el panel de Render.

---

## Lo que te pido

Eres mi asistente técnico. Soy Edson, estudiante de Ingeniería de Sistemas (Universidad Andina del Cusco) y dueño de **AeeS Acústico**, un negocio de alquiler de sonido, luces y pantallas LED en Cusco. Con la información de abajo, arma un **manual de operación en forma de formulario / preguntas y respuestas**, en español sencillo, que yo pueda consultar desde el celular. Debe cubrir:

1. **Qué tiene** el sistema (cada función del sitio y del panel).
2. **Cómo funciona** cada parte (flujo paso a paso).
3. **Dónde está** cada cosa (archivo, servicio en la nube, URL, menú del panel).
4. **Qué pasa si…** salgo, me equivoco o hago algo indebido (tabla de situaciones → consecuencia → cómo lo soluciono).
5. **Cómo resolver problemas** (síntoma → causa probable → solución, con los comandos exactos).
6. **Pruebas** para verificar que todo funciona antes de la exposición y después de cada cambio.
7. **Glosario** corto (API, JSON, Supabase, Render, variable de entorno, despliegue, etc.).

Reglas: comandos de Windows PowerShell **uno por bloque** (en PowerShell no se usa `&&`); nunca me pidas que pegue claves en un chat; si algo no está en este contexto, dilo en vez de inventarlo.

---

## 1. El proyecto en una frase

Web de AeeS Acústico donde el cliente ve equipos y combos con disponibilidad por fecha, arma su evento con un **asistente con IA**, marca el lugar en un **mapa** (ruta y transporte calculados), ve el **clima** del día y **reserva pagando un adelanto** (Yape o Mercado Pago). El personal lo administra todo en `/admin`. Es el **proyecto de fin de la Unidad II** del curso Desarrollo de Software II: el docente pide una plataforma que integre **3 APIs externas** que intercambian mensajes JSON (texto) por HTTP.

## 2. Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Sitio publicado | https://aees-web.onrender.com |
| Panel de administración | https://aees-web.onrender.com/admin |
| Asistente "Arma tu evento" | https://aees-web.onrender.com/asistente |
| Chequeo de salud (lo usa Render) | https://aees-web.onrender.com/salud |
| Chequeo de la base de datos | https://aees-web.onrender.com/salud/base |
| Código (GitHub, público) | https://github.com/020200141d-coder/aees_web (rama `main`) |
| Carpeta en la PC | `C:\proyectos\aees_web` |
| Base de datos | Supabase → organización "AeeS acústico" → proyecto **aees-web** (ref `eelmdkllwbrtamtmlzdj`, región EE. UU. Norte de Virginia, plan Free) |
| Servidor | Render → servicio **aees-web** (Web Service, Node, plan Free, creado con Blueprint desde `render.yaml`). En la misma cuenta existe otro servicio viejo: `tareas-api` |
| Claves y contraseñas | Archivo `C:\proyectos\aees_web\.env` (no se sube a GitHub) y Render → aees-web → **Environment** |
| Fotos originales del negocio | `C:\FOTOSPARAAEES` (23 fotos; 12 elegidas en `public/img/eventos/`) |
| Logo | `public/img/logo-aees.svg`, `logo-aees-compacto.svg`, `logo-aees.png`; en las páginas se incrusta desde `views/partials/logo.ejs` |
| Otro proyecto relacionado | App Flutter "aees_acustico" en `C:\andina\ds2\unidad2\aees_acustico` (repo github.com/020200141d-coder/aees_acustico), aún con Firebase |

## 3. Tecnología

- **Node.js 22 + Express 5**, vistas **EJS**, CSS y JavaScript sin frameworks (efectos reutilizados del portafolio: cursor, tilt 3D, botones magnéticos, carrusel, filtros, modal, ecualizador en canvas, parallax con GSAP).
- **Supabase (PostgreSQL)** como base de datos y **Supabase Storage** (bucket `fotos`) para las fotos subidas. En la PC, sin claves de Supabase, usa el archivo `data/db.local.json`.
- Sesión en **cookie firmada** (`cookie-session`), contraseñas y PIN con **scrypt**, protección **CSRF**, límites de peticiones, cabeceras de seguridad (CSP).
- Sonidos generados con **Web Audio API** (sin archivos de audio).
- Pruebas automáticas con `node --test` (13 pruebas).

## 4. Las APIs (lo que pide el docente)

Todas se llaman desde el servidor con `fetch` o su SDK, enviando y recibiendo **JSON**.

| # | Rol | API | Uso | Archivo | Si falla o no hay clave |
|---|---|---|---|---|---|
| 1 | Mapa / rutas | OpenStreetMap: **Nominatim** (buscar lugares) + **OSRM** (ruta real por carretera); OpenRouteService opcional | Pin del evento, km y minutos desde el almacén, link de ruta para el conductor | `src/servicios/rutas.js`, `transporte.js` | Estimación en línea recta × 1.35 |
| 2 | IA | **Google Gemini** (gratis) o **Claude** (de pago) | Convertir texto libre en la encuesta y redactar la explicación de la propuesta | `src/servicios/ia.js` | Intérprete por palabras clave y texto armado por reglas |
| 3 | Pagos | **Mercado Pago Checkout Pro** + Yape manual | Cobrar el adelanto de la reserva | `src/servicios/pagos.js`, `src/rutas/pagos.js` | Solo Yape manual (sin token de MP) |
| + | Clima | **OpenWeather** o **Open-Meteo** (sin clave) | Aviso de lluvia → toldo en eventos al aire libre | `src/servicios/clima.js` | Aviso por temporada (lluvias nov–mar) |

Detalles de la IA: Gemini se llama por REST a `generativelanguage.googleapis.com/v1beta/models/MODELO:generateContent`, con una cadena de modelos gratuitos: `gemini-3.1-flash-lite` → `gemini-3.5-flash-lite` → `gemini-flash-lite-latest` → `gemini-flash-latest`. Tiene un presupuesto de 30 s; si se pasa, usa el plan B. El nivel gratuito suele responder **503 "alta demanda"** y tarda entre 10 y 25 s. Los modelos `gemini-2.5-*` ya no están disponibles para cuentas nuevas. **La IA no decide equipos ni precios**: eso lo hacen las reglas de `src/servicios/recomendador.js`; la IA solo interpreta y redacta.

Además, la propia web expone una API JSON: `/api/equipos`, `/api/interpretar`, `/api/recomendar`, `/api/geocodificar`, `/api/ruta`, `/api/clima`, `/api/cotizar`, `/api/reservas`, `/api/contacto`, `/api/solicitudes`. Se puede mostrar en el navegador con F12 → pestaña Red (Network).

## 5. Funciones

**Sitio público:** el logo animado es el título (ondas que vibran); botón de volumen en el header (la primera vez suena la intro y, con sonido activo, las letras de los títulos suenan al pasar el mouse); servicios en carrusel; combos con adicionales; catálogo con filtros por categoría, ficha en modal con crédito de foto y **disponibilidad por fecha**; experiencias (boda, electrónica, corporativo); galería de eventos realizados con vista ampliada; "Cómo reservar"; contacto (formulario o WhatsApp 987166001); página 404.

**Asistente:** texto libre ("boda de 150 invitados en Urubamba…") → encuesta (tipo, invitados, interior/exterior, electricidad, fecha, horas, extras como orquesta, DJ, pantalla o luces) → mapa → propuesta con 3 opciones (Esencial, Recomendada, Premium) + combo sugerido, transporte, clima y explicación de la IA → "Elegir y reservar".

**Mi evento y reserva:** el carrito se guarda en el navegador. El servidor recalcula precios; para reservar se ingresa con Google o con celular + PIN de 6 dígitos y se piden DNI, celular y la aceptación de la Ley 29733. La reserva queda "pendiente de adelanto" y **bloquea los equipos 24 h**. Pago por Yape (número de operación que el admin aprueba) o Mercado Pago. Luego el cliente agenda la **reunión de confirmación**. Si la fecha está ocupada, "Pedir reunión" envía una solicitud para completar con un **proveedor aliado**.

**Panel /admin:**
- Rol **admin**: inicio y agenda (calendario, próximos eventos, confirmar y completar con un clic, Yapes por verificar, solicitudes de fecha ocupada), reservas (detalle, pagos, estado, notas, ruta para el conductor), mensajes, clientes (frecuentes y promo por WhatsApp), equipos (CRUD, buscar, filtrar, publicar, estado operativo/mantenimiento/baja), combos (CRUD con vista previa en vivo y adicionales), galería, promociones, negocio y tarifas (datos, Yape, reglas, vehículos, fotos de portada), personal, respaldo (descargar y restaurar JSON).
- Rol **publicador**: solo combos y galería.
- **Subir fotos:** recorte con la proporción del lugar (4:3 equipos, 16:10 combos, 16:9 portada, 4:5 tarjetas, 1:1 QR, libre en galería) y conversión a WebP de máximo 1600 px.

## 6. Reglas del negocio (editables en Admin → Negocio y tarifas)

- Precio por **jornada de 4 h**; cada jornada extra × 1 (8 h = el doble). Si hay combo, la jornada del evento es la del combo.
- **Adelanto 40 %**, bloqueo de 24 h, técnico S/ 150 por jornada, cliente frecuente con 2 o más reservas pagadas → 10 %. Promos: FRECUENTE10 y BIENVENIDA5. No se suman: se aplica la mayor.
- Tachos LED S/ 25 c/u; S/ 20 desde 13 unidades; S/ 5 menos sin DMX. Cabeza móvil Beam 290: S/ 80. LED P3.9: S/ 120 por m². **Combo Line Array S/ 800** (2 EAW XRS212 + 2 JBL SRX828SP + 2 EAW LA151 + 2 EON615 como monitores); +2 EON615 = S/ 100.
- Transporte ida y vuelta = base + S/ por km × km de ida. Auto/taxi 60 + 3.60 (Cusco–Urubamba, 66 km ≈ S/ 298); station wagon 80 + 4.85 (≈ S/ 400); camioncito 150 + 7. Se elige el vehículo más barato donde entre la carga (volumen, peso y largo, con 15 % de margen).
- Perfiles acústicos del recomendador: **SPL** (fiesta electrónica, concierto), **baile** (bodas, cumpleaños, quinceañeros), **voz** (corporativo, conferencia). Al aire libre se calcula con +40 % de invitados.
- Inventario real cargado: 28 equipos (EAW XRS212 y LA151, JBL EON615, EV ZLX-15P, JBL SRX818SP/SRX828SP, RCF pasivos + Crest 4000, Soundcraft Ui24R/Ui16, Behringer 24 y Soundcraft 8 canales, micrófonos Shure y Sennheiser, Beam 290, tachos 54×3W, matrix, humo, minibrut, DMX, LED P3.9, cables, trípodes) y 6 combos. **Varias cantidades y precios fueron supuestos** y deben revisarse; el modelo "Sennheiser e832" está por confirmar.
- Fotos de equipos: 15 son **referenciales de Wikimedia Commons** (CC BY, CC BY-SA o dominio público), con autor, licencia y enlace visibles en la ficha, como exigen esas licencias. Las demás usan una ilustración SVG. Lo ideal es reemplazarlas por fotos propias.

## 7. Base de datos (Supabase)

Tablas: `ajustes` (negocio, reglas, vehiculos, portada), `equipos`, `combos`, `promociones`, `publicaciones`, `usuarios` (roles admin/publicador/cliente), `reservas`, `pagos`, `mensajes`. Están definidas en `supabase/esquema.sql`, con RLS activado y sin políticas: solo el servidor, con la clave **secret**, puede leer y escribir. El plan Free **pausa el proyecto tras ~7 días sin uso** (se reactiva desde el panel de Supabase). Fotos subidas → bucket `fotos` (se crea solo).

## 8. Variables de entorno (solo los nombres)

`PORT`, `NODE_ENV`, `BASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASS`, `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (la **secret** `sb_secret_…`, nunca la publishable), `GEMINI_API_KEY`, `GEMINI_MODELO`, `ANTHROPIC_API_KEY`, `IA_MODELO`, `IA_PROVEEDOR`, `GOOGLE_CLIENT_ID`, `MP_ACCESS_TOKEN`, `PAGOS_SIMULADOS`, `OPENWEATHER_API_KEY`, `ORS_API_KEY`. La plantilla está en `.env.example`. La cuenta de admin se crea sola al arrancar si el correo de `ADMIN_EMAIL` no existe.

## 9. Comandos en la PC (PowerShell, uno por uno)

```powershell
cd C:\proyectos\aees_web
```
```powershell
npm install
```
```powershell
npm run dev
```
(abre http://localhost:3000)
```powershell
npm test
```
```powershell
npm run semilla
```
(vuelve a cargar equipos, combos, galería y ajustes en la base activa; en Supabase hace upsert y no borra reservas)
```powershell
git add -A
```
```powershell
git commit -m "Describe el cambio"
```
```powershell
git push
```
(cada push a `main` hace que Render vuelva a desplegar solo)

## 10. Despliegue en Render (cómo quedó)

Blueprint desde `render.yaml`: build `npm install`, start `npm start`, Node 22 (`.node-version` y `engines`), health check `/salud` (responde al instante sin tocar la base). Plan Free: **se duerme tras 15 min sin visitas** (la primera carga tarda ~50 s; 750 h al mes por cuenta). Para la exposición: ping en cron-job.org cada 10 min o abrir la página 2 minutos antes. En producción no existe el botón "Simular pago". Vercel está configurado (`vercel.json`, `api/index.js`) pero **no se ha probado**; necesitaría las mismas variables.

## 11. Problemas que ya ocurrieron (y cómo se resolvieron)

| Síntoma | Causa | Solución aplicada |
|---|---|---|
| Deploy "Failed" tras 15 min: *Timed out waiting for health check* | El servidor consultaba Supabase antes de abrir el puerto | `server.js` abre el puerto primero; health check en `/salud` |
| Deploy atascado en el chequeo | `/salud` esperaba a la base (~7 s) | `/salud` instantánea; diagnóstico aparte en `/salud/base` |
| Todas las páginas con error 500, salvo `/salud` y los CSS | La clave de Supabase pegada en Render tenía un **salto de línea en medio** | El código quita todos los espacios de URL y clave |
| Deploy fallido por error de sintaxis | Un cambio hecho con `sed` borró una barra invertida | Corregido; lección: probar en modo producción antes de cada push |
| Gemini 404 | `gemini-2.5-flash` retirado para cuentas nuevas | Cadena de modelos vigentes |
| Gemini 503 / lento | Alta demanda del nivel gratuito | Presupuesto de 30 s y plan B por reglas |
| Calca salía a 130 km | La búsqueda tomaba el centro de la provincia | Se priorizan lugares sobre límites administrativos |
| Página más ancha que el celular | Correo largo en una grilla CSS | `min-width: 0` en las grillas |

## 12. Pendientes y riesgos conocidos

- **Rotar la clave secreta de Supabase**: quedó expuesta unos minutos en `/salud/base` y en un chat. Pasos: Supabase → Settings → API Keys → New secret key → pegarla en Render (Environment, en **una sola línea**) y en el `.env` → borrar la clave vieja "default". Se decidió hacerlo después de la exposición y antes de tener clientes reales.
- Borrar la cuenta de desarrollo `admin@aees.local` en Admin → Personal.
- Descargar un respaldo con regularidad (Admin → Respaldo).
- Opcionales: token de prueba de Mercado Pago, Google Client ID, OpenWeather; probar Vercel; fotos propias; revisar cantidades y precios; facturación electrónica; conectar la app Flutter a Supabase; API REST `/api/v1` con token para una versión futura.

## 13. Pistas para la sección "Qué pasa si…"

Incluye al menos estos casos: cerrar sesión o perder el celular · olvidar la contraseña del panel (se cambia `ADMIN_PASS` en Render solo si el correo no existe; si existe, otro admin la cambia o se edita la tabla `usuarios` en Supabase) · borrar un equipo que está en un combo (no deja) · borrar un combo o una foto por error (restaurar respaldo) · subir una foto vertical (el recortador la ajusta) · cambiar precios (las reservas ya hechas conservan su precio) · un cliente no paga en 24 h (la reserva expira y libera los equipos) · paga tarde (queda "expirada" y el admin decide) · dos clientes reservan el mismo equipo a la vez (el segundo recibe "ocupado") · Render dormido o caído · Supabase pausado · Gemini saturado · pegar mal una clave en Render · hacer push con un error (Render mantiene la versión anterior; botón **Rollback** en Deploys) · borrar el `.env` · subir el `.env` a GitHub por error (rotar todas las claves) · la clave de Gemini se expone o agota su cuota · el día de la exposición sin internet.
