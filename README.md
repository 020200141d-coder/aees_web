# AeeS Acústico — Web de alquiler de equipos audiovisuales

Sitio web y panel de administración de **AeeS Acústico** (Cusco): sonido, iluminación, pantallas LED y estructuras para bodas, fiestas, conciertos y eventos corporativos en Cusco y el Valle Sagrado.

El cliente puede ver equipos y combos con disponibilidad por fecha, armar su evento con un **asistente con IA**, marcar el lugar en un **mapa** (ruta y transporte calculados), ver el **clima** de su fecha y **reservar pagando un adelanto** (Yape o Mercado Pago). El personal gestiona todo desde **/admin**.

Proyecto del curso Desarrollo de Software II — Unidad II · Ingeniería de Sistemas, Universidad Andina del Cusco.

---

## 1. Las 3 APIs del proyecto

| # | Rol | API | Para qué se usa | Archivo |
|---|-----|-----|-----------------|---------|
| 1 | Mapa y rutas | **OpenStreetMap (Leaflet + Nominatim) + OSRM / OpenRouteService** | Buscar el lugar del evento, poner el pin, calcular la ruta real por carretera desde el almacén y elegir el vehículo y su costo | `src/servicios/rutas.js`, `src/servicios/transporte.js` |
| 2 | Inteligencia artificial | **Claude API (Anthropic)** | Entender un pedido escrito con palabras comunes y explicar la recomendación de forma personal | `src/servicios/ia.js` |
| 3 | Pagos | **Mercado Pago Checkout Pro** (+ Yape manual) | Cobrar el adelanto que separa la fecha y los equipos | `src/servicios/pagos.js` |
| + | Clima | **OpenWeather** (o Open-Meteo) | Avisar si llueve el día del evento y sugerir toldo en eventos al aire libre | `src/servicios/clima.js` |

**Decisión de diseño:** la IA **no decide** qué equipos van ni cuánto cuestan. Eso lo hace un motor de reglas (`src/servicios/recomendador.js`) con el stock real: perfil acústico (SPL alto para fiestas, inteligibilidad para conferencias), personas, aire libre (+40%), músicos en vivo, etc. La IA solo interpreta el texto y redacta la explicación. Así los precios nunca son inventados, y si la IA falla el sitio sigue funcionando.

## 2. Tecnologías

- **Node.js 20+ y Express 5**, vistas **EJS**, CSS y JavaScript sin frameworks (efectos reutilizados del portafolio: cursor, tilt 3D, botones magnéticos, carrusel, filtros, modal, ecualizador en canvas, parallax con GSAP).
- **Supabase (PostgreSQL)** como base de datos. Sin Supabase funciona con un archivo local (`data/db.local.json`) para desarrollo.
- Sesión en **cookie firmada** (`cookie-session`), contraseñas y PIN con **scrypt**, protección **CSRF** y límites de peticiones.
- Sonido de la intro generado con la **Web Audio API** (sin archivos de audio).

## 3. Estructura

```
app.js                  arma la app Express (middlewares y rutas)
server.js               la enciende (Render / tu PC)
api/index.js            entrada para Vercel
data/semilla.json       inventario real, combos, ajustes y galería de ejemplo
supabase/esquema.sql    tablas para Supabase
scripts/cargar-semilla.js   sube la semilla a la base activa
src/db/                 acceso a datos: Supabase o archivo local (misma interfaz)
src/servicios/          reglas del negocio: catálogo, precios, transporte, rutas, clima, IA, pagos, reservas
src/rutas/              páginas y API: publico, cuenta, api, pagos, admin
src/middleware/auth.js  sesión y roles (cliente, publicador, admin)
views/                  plantillas EJS (sitio público y panel /admin)
public/                 css, js, fotos de eventos realizados
test/                   pruebas de las reglas (npm test)
```

## 4. Ejecutar en tu PC (Windows / PowerShell)

Escribe los comandos **uno por uno** (en PowerShell no se usa `&&`).

```powershell
cd C:\proyectos\aees_web
```

```powershell
npm install
```

```powershell
Copy-Item .env.example .env
```

Abre `.env` y completa como mínimo `ADMIN_EMAIL`, `ADMIN_PASS` y `SESSION_SECRET`.

```powershell
npm run dev
```

Abre http://localhost:3000. El panel está en http://localhost:3000/admin con el correo y la clave de tu `.env`.

Pruebas de las reglas:

```powershell
npm test
```

Para volver a la base local de ejemplo (borra reservas y clientes de prueba):

```powershell
npm run semilla
```

## 5. Configurar los servicios (cada uno es opcional)

| Servicio | Pasos | Variable |
|----------|-------|----------|
| **Supabase** | supabase.com → New project → SQL Editor → pega `supabase/esquema.sql` → Run. En Settings → API copia la URL y la *service_role key*. Luego `npm run semilla` | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| **Claude (IA)** | console.anthropic.com → API Keys | `ANTHROPIC_API_KEY` |
| **Google** | console.cloud.google.com → Credenciales → ID de cliente OAuth (aplicación web). Orígenes autorizados: `http://localhost:3000` y tu dominio de Render | `GOOGLE_CLIENT_ID` |
| **Mercado Pago** | mercadopago.com.pe/developers → Tus integraciones → credenciales de prueba (empiezan con `TEST-`) | `MP_ACCESS_TOKEN`, `BASE_URL` |
| **OpenWeather** | openweathermap.org → API keys | `OPENWEATHER_API_KEY` |
| **OpenRouteService** | openrouteservice.org → Dashboard → token | `ORS_API_KEY` |

> El plan gratis de Supabase pausa el proyecto tras ~7 días sin uso: entra al panel y reactívalo antes de una presentación.

## 6. Publicar en Render

1. Sube el repositorio a GitHub.
2. En render.com: **New → Web Service** → conecta el repositorio (o **New → Blueprint**, que lee `render.yaml`).
3. Build Command: `npm install` · Start Command: `npm start` · Plan: Free.
4. En **Environment** agrega: `NODE_ENV=production`, `ADMIN_EMAIL`, `ADMIN_PASS`, `SESSION_SECRET`, `BASE_URL` (la URL que te da Render), `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` y las claves de API que uses.
5. Deploy. El plan gratis "se duerme" tras 15 minutos sin visitas: la primera carga tarda unos 50 segundos.

**Importante:** en Render gratis el disco se borra en cada despliegue. Con Supabase no pasa nada; sin Supabase, usa **Admin → Respaldo** para descargar y restaurar los datos.

## 7. Publicar en Vercel (opcional)

`vercel.json` y `api/index.js` ya están listos: importa el repositorio en vercel.com y agrega las mismas variables. En Vercel **es obligatorio usar Supabase**, porque no hay disco permanente.

## 8. Fotos

- Eventos realizados y portada: fotos propias de AeeS Acústico (`public/img/eventos/`).
- Equipos sin foto: ilustraciones SVG propias según el tipo de equipo. Desde **Admin → Equipos** se puede subir la foto real de cada equipo.
- Mapas © colaboradores de OpenStreetMap.
