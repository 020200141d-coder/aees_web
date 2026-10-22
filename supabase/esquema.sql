-- ============================================================================
--  supabase/esquema.sql — tablas de AeeS Acústico en PostgreSQL (Supabase)
--
--  Cómo usarlo:
--   1. Supabase → tu proyecto → SQL Editor → New query.
--   2. Pega todo este archivo y presiona Run.
--   3. En tu PC: npm run semilla  (sube equipos, combos y ajustes de ejemplo).
--
--  Decisiones:
--   • Los ids son texto: así los equipos conservan su código legible
--     (aud-001) y el resto usa UUID generado por la base.
--   • items de combos y reservas se guardan como JSONB (lista de
--     {equipo_id, cantidad}). Para el tamaño del negocio es más simple que una
--     tabla intermedia y se consulta igual de fácil.
--   • RLS (Row Level Security) activado y SIN políticas: la clave pública
--     (anon) no puede leer ni escribir nada. Solo el servidor Express, que usa
--     la service key, accede a los datos.
-- ============================================================================

create table if not exists ajustes (
  id         text primary key,          -- negocio, reglas, vehiculos, portada
  valor      jsonb not null,
  creado_en  timestamptz default now()
);

create table if not exists equipos (
  id                 text primary key,
  codigo             text unique not null,
  nombre             text not null,
  marca              text default '',
  modelo             text default '',
  categoria          text not null check (categoria in ('audio','iluminacion','video','electrico','estructura')),
  rol                text not null,      -- top, sub, consola, par_led... (lo usa el recomendador)
  descripcion        text default '',
  precio             numeric(10,2) not null check (precio >= 0),  -- S/ por jornada
  precio_mayor       numeric(10,2) check (precio_mayor >= 0),     -- precio unitario desde `mayor_desde` unidades
  mayor_desde        integer,
  ajuste_sin_dmx     numeric(10,2) default 0,  -- p. ej. -5 en tachos si el evento no lleva DMX
  precio_adicional   numeric(10,2),            -- precio cuando se suma a un combo
  cantidad_total     integer not null default 1 check (cantidad_total >= 0),
  potencia_w         integer default 0,
  spl_db             integer,
  cobertura_personas integer,
  dimensiones        text default '',
  volumen_l          numeric(8,1) default 0,   -- para elegir el vehículo
  peso_kg            numeric(8,1) default 0,
  largo_cm           integer default 0,
  imagen             text default '',
  imagen_fuente      text default '',          -- crédito de la foto (autor · licencia)
  imagen_fuente_url  text default '',          -- página de la foto (obligatorio en licencias CC BY)
  estado             text not null default 'operativo' check (estado in ('operativo','mantenimiento','baja')),
  publicado          boolean not null default true,
  destacado          boolean not null default false,
  orden              integer default 0,
  creado_en          timestamptz default now()
);

create table if not exists combos (
  id            text primary key default gen_random_uuid()::text,
  nombre        text not null,
  nivel         text default 'esencial',
  descripcion   text default '',
  tipos_evento  text[] default '{}',
  personas_min  integer default 0,
  personas_max  integer default 100,
  horas_base    integer default 4,
  precio        numeric(10,2) not null check (precio >= 0),
  items         jsonb not null default '[]',
  adicionales   jsonb not null default '[]',  -- [{equipo_id, cantidad, precio, etiqueta}] extras opcionales
  imagen        text default '',
  imagen_fuente text default '',
  publicado     boolean default true,
  destacado     boolean default false,
  orden         integer default 0,
  creado_en     timestamptz default now()
);

create table if not exists promociones (
  id              text primary key default gen_random_uuid()::text,
  codigo          text unique not null,
  descripcion     text default '',
  porcentaje      numeric(5,2) not null check (porcentaje > 0 and porcentaje <= 50),
  solo_frecuentes boolean default false,
  activo          boolean default true,
  vence           date,
  creado_en       timestamptz default now()
);

create table if not exists publicaciones (
  id            text primary key default gen_random_uuid()::text,
  titulo        text not null,
  tipo          text default 'boda',
  texto         text default '',
  imagen        text default '',
  imagen_fuente text default '',
  publicado     boolean default true,
  orden         integer default 0,
  creado_en     timestamptz default now()
);

create table if not exists usuarios (
  id          text primary key default gen_random_uuid()::text,
  rol         text not null default 'cliente' check (rol in ('admin','publicador','cliente')),
  nombre      text not null,
  email       text unique,
  celular     text unique,
  dni         text,
  google_sub  text unique,
  clave_hash  text,            -- scrypt: PIN del cliente o contraseña del personal
  creado_en   timestamptz default now()
);

create table if not exists reservas (
  id              text primary key default gen_random_uuid()::text,
  codigo          text unique not null,      -- AEES-XXXX, el que ve el cliente
  usuario_id      text references usuarios(id),
  estado          text not null default 'pendiente_pago'
                  check (estado in ('pendiente_pago','adelanto_pagado','confirmada','completada','cancelada','expirada')),
  fecha_evento    date not null,
  hora_inicio     text,
  horas           integer not null default 4,
  tipo_evento     text,
  personas        integer,
  espacio         text,
  lugar           text,
  lat             double precision,
  lng             double precision,
  distancia_km    numeric(8,1),
  vehiculo        text,
  combo_id        text,
  adicionales     jsonb default '[]',
  items           jsonb not null default '[]',
  subtotal        numeric(10,2) not null,
  transporte      numeric(10,2) default 0,
  tecnico         numeric(10,2) default 0,
  descuento       numeric(10,2) default 0,
  total           numeric(10,2) not null,
  adelanto_pct    numeric(5,2) not null,
  adelanto        numeric(10,2) not null,
  pagado          numeric(10,2) default 0,
  promo_codigo    text,
  expira_en       timestamptz,
  datos_cliente   jsonb default '{}',        -- nombre, dni, celular, correo al reservar
  encuesta        jsonb default '{}',
  explicacion     text,
  reunion         jsonb,                     -- { fecha, hora, modalidad }
  notas_admin     text,
  creado_en       timestamptz default now()
);
create index if not exists reservas_fecha_idx on reservas (fecha_evento);

create table if not exists pagos (
  id          text primary key default gen_random_uuid()::text,
  reserva_id  text references reservas(id) on delete cascade,
  metodo      text not null check (metodo in ('mercadopago','yape','simulado')),
  monto       numeric(10,2) not null check (monto >= 0),
  estado      text not null default 'pendiente' check (estado in ('pendiente','aprobado','rechazado')),
  referencia  text,           -- id de pago de Mercado Pago o n.º de operación Yape
  detalle     jsonb default '{}',
  creado_en   timestamptz default now()
);

create table if not exists mensajes (
  id           text primary key default gen_random_uuid()::text,
  tipo         text default 'contacto' check (tipo in ('contacto','fecha_ocupada')),
  datos        jsonb default '{}',            -- en fecha_ocupada: el evento que no se pudo reservar
  nombre       text not null,
  telefono     text,
  fecha_evento date,
  mensaje      text not null,
  leido        boolean default false,
  creado_en    timestamptz default now()
);

-- Seguridad: activar RLS en todas las tablas (sin políticas = nadie con la anon key).
alter table ajustes       enable row level security;
alter table equipos       enable row level security;
alter table combos        enable row level security;
alter table promociones   enable row level security;
alter table publicaciones enable row level security;
alter table usuarios      enable row level security;
alter table reservas      enable row level security;
alter table pagos         enable row level security;
alter table mensajes      enable row level security;
