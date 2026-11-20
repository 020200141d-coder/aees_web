// ============================================================================
//  src/controladores/admin/galeria.js — Galería (/admin/galeria) y Reseñas (/admin/resenas)
//
//  Las dos secciones son "contenido" que publica el negocio en la web y las
//  usan tanto el publicador como el admin; por eso comparten controlador.
//   • Galería → servicios/publicaciones.js + validadores/publicaciones.js
//   • Reseñas → servicios/resenas.js (ya existía y trae su propio validar())
// ============================================================================

const publicaciones = require('../../servicios/publicaciones');
const resenas = require('../../servicios/resenas');
const { leerPublicacion, TIPOS_PUB } = require('../../validadores/publicaciones');
const { hayErrores, marcado, entero } = require('../../validadores/formulario');
const { quiereJson } = require('../comun');

// ── Galería ────────────────────────────────────────────────────────────────
const PUB_NUEVA = { tipo: 'boda', publicado: true, imagen_fuente: 'AeeS Acústico (foto propia)' };

async function lista(req, res) {
  res.render('admin/galeria', { titulo: 'Galería', publicaciones: await publicaciones.listar(), TIPOS_PUB });
}

function nueva(req, res) {
  res.render('admin/publicacion-form', { titulo: 'Nueva publicación', p: PUB_NUEVA, errores: {}, nuevo: true, TIPOS_PUB });
}

async function crear(req, res) {
  const { datos, errores } = leerPublicacion(req.body);
  if (hayErrores(errores)) return res.status(400).render('admin/publicacion-form', { titulo: 'Nueva publicación', p: datos, errores, nuevo: true, TIPOS_PUB });
  await publicaciones.crear(datos);
  req.flash('exito', 'Publicación agregada a la galería.');
  res.redirect('/admin/galeria');
}

async function editar(req, res, next) {
  const p = await publicaciones.obtener(req.params.id);
  if (!p) return next();
  res.render('admin/publicacion-form', { titulo: 'Editar publicación', p, errores: {}, nuevo: false, TIPOS_PUB });
}

async function guardar(req, res, next) {
  const actual = await publicaciones.obtener(req.params.id);
  if (!actual) return next();
  const { datos, errores } = leerPublicacion(req.body);
  if (hayErrores(errores)) return res.status(400).render('admin/publicacion-form', { titulo: 'Editar publicación', p: { ...actual, ...datos }, errores, nuevo: false, TIPOS_PUB });
  await publicaciones.actualizar(actual.id, datos);
  req.flash('exito', 'Publicación guardada.');
  res.redirect('/admin/galeria');
}

async function alternarPublicado(req, res, next) {
  const publicado = await publicaciones.alternarPublicado(req.params.id);
  if (publicado === null) return next();
  if (quiereJson(req)) return res.json({ ok: true, publicado });
  res.redirect('/admin/galeria');
}

async function eliminar(req, res) {
  await publicaciones.eliminar(req.params.id);
  req.flash('exito', 'Publicación eliminada.');
  res.redirect('/admin/galeria');
}

// ── Reseñas ────────────────────────────────────────────────────────────────
// Las de clientes llegan sin publicar; aquí se revisan, editan y publican.
async function pintarResenas(res, { editar = null, datos = {}, errores = {}, status = 200 } = {}) {
  const lista = await resenas.todas();
  res.status(status).render('admin/resenas', { titulo: 'Reseñas', lista: [...lista].reverse(), editar, datos, errores });
}

async function resenasLista(req, res) {
  const lista = await resenas.todas();
  const editar = req.query.editar ? lista.find(x => x.id === req.query.editar) || null : null;
  res.render('admin/resenas', { titulo: 'Reseñas', lista: [...lista].reverse(), editar, datos: editar || {}, errores: {} });
}

// Crear (id null) o actualizar (id) una reseña con el mismo formulario.
async function guardarResena(req, res, id) {
  const { datos, errores } = resenas.validar(req.body);
  datos.publicado = marcado(req.body.publicado);
  datos.orden = entero(req.body.orden, 0);
  if (hayErrores(errores)) return pintarResenas(res, { editar: id ? { id } : null, datos, errores, status: 400 });
  if (id) await resenas.actualizar(id, datos); else await resenas.agregar(datos, { origen: 'admin', publicado: datos.publicado });
  req.flash('exito', id ? 'Reseña actualizada.' : 'Reseña agregada.');
  res.redirect('/admin/resenas');
}
const resenaCrear = (req, res) => guardarResena(req, res, null);
const resenaGuardar = (req, res) => guardarResena(req, res, req.params.id);

async function resenaAlternarPublicado(req, res, next) {
  const x = (await resenas.todas()).find(r => r.id === req.params.id);
  if (!x) return next();
  await resenas.actualizar(x.id, { publicado: !x.publicado });
  if (quiereJson(req)) return res.json({ ok: true, publicado: !x.publicado });
  res.redirect('/admin/resenas');
}

async function resenaEliminar(req, res) {
  await resenas.eliminar(req.params.id);
  req.flash('exito', 'Reseña eliminada.');
  res.redirect('/admin/resenas');
}

module.exports = {
  lista, nueva, crear, editar, guardar, alternarPublicado, eliminar,
  resenasLista, resenaCrear, resenaGuardar, resenaAlternarPublicado, resenaEliminar
};
