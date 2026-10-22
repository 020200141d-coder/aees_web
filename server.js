// server.js — enciende el servidor (Render o tu PC).
// Render asigna el puerto en process.env.PORT; en tu PC se usa el 3000.

const app = require('./app');
const db = require('./src/db');
const { asegurarAdminInicial } = require('./src/middleware/auth');

const PORT = process.env.PORT || 3000;

asegurarAdminInicial()
  .catch(err => console.error('  ✗ No se pudo revisar la cuenta de administrador:', err.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`\n  ▶ AeeS Acústico en http://localhost:${PORT}`);
      console.log(`    Base de datos: ${db.motor === 'supabase' ? 'Supabase (PostgreSQL)' : 'archivo local data/db.local.json'}\n`);
    });
  });
