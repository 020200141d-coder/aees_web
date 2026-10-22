# Plan de trabajo — AeeS Acústico Web

Pista de lo que está hecho y lo que sigue. Marca `[x]` al terminar cada punto.

## Fase 0 — Base
- [x] Repositorio `aees_web` y estructura Express + EJS
- [x] Paleta de la app Flutter (azul marino + dorado) como variables CSS
- [x] Capa de datos con dos motores: Supabase y archivo local (misma interfaz)
- [x] Esquema SQL para Supabase (`supabase/esquema.sql`) y script de semilla
- [x] Inventario real cargado (line array EAW, JBL SRX, EON615, Ui24R, Beam 290, LED P3.9…)
- [x] Despliegue preparado: Render (`render.yaml`) y Vercel (`vercel.json`)

## Fase 1 — Sitio público
- [x] Logo del negocio vectorizado con ondas animadas (header, hero, footer, favicon)
- [x] Botón de volumen en el header (sin pantalla de entrada) y títulos que suenan al pasar el mouse
- [x] Hero con foto real, haces de luz y ecualizador interactivo
- [x] Cinta de marcas, servicios en carrusel, experiencias (boda, electrónica, corporativo)
- [x] Catálogo con filtros, ficha en modal y disponibilidad por fecha
- [x] Combos con adicionales de precio especial
- [x] Galería de eventos realizados con filtros y vista ampliada
- [x] Contacto con formulario y WhatsApp; 404 con estilo
- [x] Fotos referenciales con licencia libre (Wikimedia Commons) en 15 equipos, con crédito
- [x] Recorte por proporción y conversión a WebP al subir fotos
- [ ] Fotos propias de cada equipo (subirlas desde Admin → Equipos)
- [ ] Video corto de un evento en el hero (opcional)

## Fase 2 — Panel /admin
- [x] Login del personal y roles (admin / publicador)
- [x] Agenda: calendario del mes, próximos eventos, botones rápidos (confirmar, completar)
- [x] CRUD de equipos (buscar, filtrar, publicar, estado, eliminar con confirmación)
- [x] CRUD de combos con vista previa en vivo y comparación de precio suelto
- [x] Galería: subir fotos (se reducen en el navegador) y publicarlas
- [x] Reservas: detalle, pagos, aprobar Yape, estado, notas, ruta para el conductor
- [x] Clientes (frecuentes), mensajes, promociones, ajustes, personal, respaldo

## Fase 3 — Asistente con IA (API 2)
- [x] Texto libre → encuesta (IA con plan B por palabras clave)
- [x] Reglas por perfil acústico: SPL (fiestas), baile (bodas), voz (corporativo)
- [x] Tres opciones (esencial, recomendada, premium) + combo sugerido, ajustadas al stock del día
- [x] Explicación personalizada con IA
- [ ] Medir con clientes reales y ajustar las escaleras de equipos

## Fase 4 — Mapa, ruta y transporte (API 1)
- [x] Mapa Leaflet + OpenStreetMap, búsqueda de lugares y pin arrastrable
- [x] Ruta real por carretera (OSRM / OpenRouteService) y link para el conductor
- [x] Vehículo según volumen, peso y largo de la carga (auto, station wagon, camioncito)
- [x] Clima del día del evento (OpenWeather / Open-Meteo) y aviso de lluvia

## Fase 5 — Cuentas, reservas y pagos (API 3)
- [x] Registro en un paso: Google o celular + PIN
- [x] Reserva con DNI, consentimiento de datos y bloqueo de fecha (24 h)
- [x] Adelanto configurable (40%): Yape con verificación y Mercado Pago
- [x] Doble reserva bloqueada (control optimista)
- [x] Fecha ocupada → solicitud de reunión para completar con proveedor aliado
- [x] Reunión de confirmación agendada por el cliente
- [ ] Probar Mercado Pago con credenciales de prueba y el webhook en Render
- [ ] Culqi como segunda pasarela (Yape automático)

## Fase 6 — Después
- [ ] Facturación electrónica (Nubefact u otro proveedor autorizado por SUNAT)
- [ ] Verificación del celular por código de WhatsApp en lugar del PIN
- [ ] Inventario con proveedores aliados (equipos de terceros con su propio stock)
- [ ] Conectar la app Flutter a la misma base de Supabase (`supabase_flutter`)
