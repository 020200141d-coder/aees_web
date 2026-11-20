// ============================================================================
//  src/lib/errores.js — errores de negocio
//
//  ¿Por qué una clase propia?
//   Los servicios (capa de reglas) no saben si los llamó una página del panel
//   o la API JSON; solo saben que una regla no se cumple. Por eso lanzan un
//   ErrorNegocio con el mensaje para el usuario y el código HTTP que mejor lo
//   describe (409 conflicto, 422 dato inválido, 404 no existe...).
//
//  Flujo:
//    servicio → throw new ErrorNegocio('No se puede eliminar…', 409)
//    controlador del panel → lo atrapa y lo convierte en flash + redirect
//    controlador de la API  → lo deja pasar: el manejador central de app.js
//                              responde { ok: false, error } con ese status
//
//  `campo` (opcional) indica qué input del formulario causó el error, para
//  mostrar el mensaje junto a ese campo al volver a pintar el formulario.
//  `extra` (opcional) lleva datos para la vista, por ejemplo { pedirPin: true }
//  para que el formulario de ingreso muestre el campo del PIN.
// ============================================================================

class ErrorNegocio extends Error {
  constructor(mensaje, status = 400, { campo = null, extra = null } = {}) {
    super(mensaje);
    this.name = 'ErrorNegocio';
    this.status = status;
    this.campo = campo;
    this.extra = extra;
    this.publico = true; // el manejador central puede mostrar el mensaje tal cual
  }
}

const esErrorNegocio = err => err instanceof ErrorNegocio;

module.exports = { ErrorNegocio, esErrorNegocio };
