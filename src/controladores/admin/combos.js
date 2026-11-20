// ============================================================================
//  src/controladores/admin/combos.js — páginas y acciones de Combos (/admin/combos)
//
//  ruta → controlador → validador (leerCombo) → servicio (combos) → db
//  Lo usan el publicador y el admin.
// ============================================================================

const combos = require('../../servicios/combos');
const { leerCombo } = require('../../validadores/combos');
const { hayErrores } = require('../../validadores/formulario');
const { quiereJson } = require('../comun');

const COMBO_NUEVO = { nivel: 'esencial', tipos_evento: [], personas_min: 20, personas_max: 100, horas_base: 4, items: [], adicionales: [], publicado: true };

async function lista(req, res) {
  const [lista, { mapa }] = await Promise.all([combos.listar(), combos.equiposParaFormulario()]);
  res.render('admin/combos', { titulo: 'Combos', combos: lista, mapa });
}

async function nuevo(req, res) {
  const { equipos } = await combos.equiposParaFormulario();
  res.render('admin/combo-form', { titulo: 'Nuevo combo', c: COMBO_NUEVO, errores: {}, nuevo: true, equipos });
}

async function crear(req, res) {
  const { equipos, mapa } = await combos.equiposParaFormulario();
  const { datos, errores } = leerCombo(req.body, mapa);
  if (hayErrores(errores)) return res.status(400).render('admin/combo-form', { titulo: 'Nuevo combo', c: datos, errores, nuevo: true, equipos });
  await combos.crear(datos);
  req.flash('exito', `Combo «${datos.nombre}» creado.`);
  res.redirect('/admin/combos');
}

async function editar(req, res, next) {
  const c = await combos.obtener(req.params.id);
  if (!c) return next();
  const { equipos } = await combos.equiposParaFormulario();
  res.render('admin/combo-form', { titulo: `Editar ${c.nombre}`, c, errores: {}, nuevo: false, equipos });
}

async function guardar(req, res, next) {
  const actual = await combos.obtener(req.params.id);
  if (!actual) return next();
  const { equipos, mapa } = await combos.equiposParaFormulario();
  const { datos, errores } = leerCombo(req.body, mapa);
  if (hayErrores(errores)) return res.status(400).render('admin/combo-form', { titulo: `Editar ${actual.nombre}`, c: { ...actual, ...datos }, errores, nuevo: false, equipos });
  await combos.actualizar(actual.id, datos);
  req.flash('exito', `Combo «${datos.nombre}» guardado.`);
  res.redirect('/admin/combos');
}

async function alternarPublicado(req, res, next) {
  const publicado = await combos.alternarPublicado(req.params.id);
  if (publicado === null) return next();
  if (quiereJson(req)) return res.json({ ok: true, publicado });
  res.redirect('/admin/combos');
}

async function eliminar(req, res) {
  await combos.eliminar(req.params.id);
  req.flash('exito', 'Combo eliminado.');
  res.redirect('/admin/combos');
}

module.exports = { lista, nuevo, crear, editar, guardar, alternarPublicado, eliminar };
