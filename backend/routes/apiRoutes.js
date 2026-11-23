const express = require('express');
const router = express.Router();
const { registrarEmpresa, login } = require('../controllers/authController');
const {
  listarClientes, crearCliente, actualizarCliente, eliminarCliente,
  listarEmpleados, listarProfesionales, crearEmpleado, actualizarEmpleado, eliminarEmpleado,
  listarServicios, crearServicio, actualizarServicio, eliminarServicio,
  obtenerIndicadores
} = require('../controllers/crudController');
const {
  listarCitas, consultarDisponibilidad, crearCita, reprogramarCita, cambiarEstadoCita
} = require('../controllers/citaController');
const { verificarToken, permitirRoles } = require('../middlewares/authMiddleware');

const TODOS_LOS_ROLES = ['admin', 'recepcionista', 'profesional', 'cliente'];

// Auth pública
router.post('/auth/registrar-empresa', registrarEmpresa);
router.post('/auth/login', login);

// Dashboard (HU-13)
router.get('/indicadores', verificarToken, permitirRoles('admin', 'recepcionista'), obtenerIndicadores);

// Clientes (HU-01)
router.get('/clientes', verificarToken, permitirRoles('admin', 'recepcionista'), listarClientes);
router.post('/clientes', verificarToken, permitirRoles('admin', 'recepcionista'), crearCliente);
router.put('/clientes/:id', verificarToken, permitirRoles('admin', 'recepcionista'), actualizarCliente);
router.delete('/clientes/:id', verificarToken, permitirRoles('admin', 'recepcionista'), eliminarCliente);

// Empleados (HU-02) — panel de administración exclusivo del admin (HU-11)
router.get('/empleados', verificarToken, permitirRoles('admin'), listarEmpleados);
router.post('/empleados', verificarToken, permitirRoles('admin'), crearEmpleado);
router.put('/empleados/:id', verificarToken, permitirRoles('admin'), actualizarEmpleado);
router.delete('/empleados/:id', verificarToken, permitirRoles('admin'), eliminarEmpleado);

// Directorio de profesionales para reservar citas (sin datos de contacto)
router.get('/profesionales', verificarToken, permitirRoles(...TODOS_LOS_ROLES), listarProfesionales);

// Servicios (HU-03)
router.get('/servicios', verificarToken, permitirRoles(...TODOS_LOS_ROLES), listarServicios);
router.post('/servicios', verificarToken, permitirRoles('admin'), crearServicio);
router.put('/servicios/:id', verificarToken, permitirRoles('admin'), actualizarServicio);
router.delete('/servicios/:id', verificarToken, permitirRoles('admin'), eliminarServicio);

// Citas y Agenda (HU-04 a HU-10, HU-12)
router.get('/citas', verificarToken, permitirRoles(...TODOS_LOS_ROLES), listarCitas);                                   // HU-08, HU-12
router.get('/citas/disponibilidad', verificarToken, permitirRoles(...TODOS_LOS_ROLES), consultarDisponibilidad);       // HU-07
router.post('/citas', verificarToken, permitirRoles('admin', 'recepcionista', 'cliente'), crearCita);                  // HU-04, HU-09
router.put('/citas/:id/reprogramar', verificarToken, permitirRoles('admin', 'recepcionista'), reprogramarCita);       // HU-05, HU-09
router.patch('/citas/:id/estado', verificarToken, permitirRoles(...TODOS_LOS_ROLES), cambiarEstadoCita);              // HU-06, HU-10

module.exports = router;
