// api/index.js — entrada para Vercel.
// Vercel no ejecuta `npm start`: llama a esta función por cada petición.
// vercel.json redirige todas las rutas aquí, y Express decide qué responder.
// En Vercel usa Supabase: el disco es temporal y los datos locales se pierden.

const app = require('../app');
const { asegurarAdminInicial } = require('../src/middleware/auth');

// Se ejecuta una vez por "arranque en frío" de la función.
const listo = asegurarAdminInicial().catch(err => console.error('admin inicial:', err.message));

module.exports = async (req, res) => {
  await listo;
  return app(req, res);
};
