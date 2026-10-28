// server.js — enciende el servidor (Render o tu PC).
// Render asigna el puerto en process.env.PORT; en tu PC se usa el 3000.
//
// Orden importante: PRIMERO se abre el puerto y DESPUÉS se revisa la cuenta de
// administrador en la base de datos. Si fuera al revés y Supabase tardara o
// fallara, Render no vería el puerto abierto y daría el despliegue por fallido.

const app = require('./app');
const db = require('./src/db');
const { asegurarAdminInicial } = require('./src/middleware/auth');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n  ▶ AeeS Acústico en http://localhost:${PORT}`);
  console.log(`    Base de datos: ${db.motor === 'supabase' ? 'Supabase (PostgreSQL)' : 'archivo local data/db.local.json'}\n`);
  asegurarAdminInicial().catch(err => console.error('  ✗ No se pudo revisar la cuenta de administrador:', err.message));
});
