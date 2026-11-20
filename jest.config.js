// Configuración de Jest. Las pruebas de Jest viven en pruebas/ con la extensión
// .spec.js; las de node:test siguen en test/*.test.js. Así `npm test` corre
// ambas sin que un corredor intente ejecutar los archivos del otro.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/pruebas/**/*.spec.js'],
  // Cobertura (npm run cobertura) medida sobre las capas de reglas y validación.
  collectCoverageFrom: ['src/servicios/**/*.js', 'src/validadores/**/*.js', 'src/lib/errores.js'],
  clearMocks: true
};
