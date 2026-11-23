const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const validator = require('validator');
const User = require('../models/User');
const Service = require('../models/Service');
const Appointment = require('../models/Appointment');
const { inicioDelDia, finDelDia, aFechaYMD } = require('./citaController');

const SOLO_LETRAS = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]+$/;
const TELEFONO_9_DIGITOS = /^\d{9}$/;
const DNI_8_DIGITOS = /^\d{8}$/;
const HORA_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ROLES_PERSONAL = ['profesional', 'recepcionista', 'admin'];

const esObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// Quita las claves undefined para que las actualizaciones parciales no borren datos
const soloDefinidos = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

const OPCIONES_UPDATE = { returnDocument: 'after', runValidators: true };

// Verifica que los servicios asignados existan y pertenezcan a la organización (HU-02, HU-15)
const validarServiciosAsignados = async (tenantId, serviciosAsignados) => {
  if (serviciosAsignados === undefined) return { ok: true, ids: undefined };
  if (!Array.isArray(serviciosAsignados) || !serviciosAsignados.every(esObjectId)) {
    return { ok: false, mensaje: 'La lista de servicios asignados no es válida.' };
  }
  const unicos = [...new Set(serviciosAsignados.map(String))];
  const encontrados = await Service.countDocuments({ _id: { $in: unicos }, tenantId, activo: true });
  if (encontrados !== unicos.length) {
    return { ok: false, mensaje: 'Uno o más servicios asignados no existen en tu organización.' };
  }
  return { ok: true, ids: unicos };
};

// ==================== CLIENTES (HU-01) ====================
const listarClientes = async (req, res) => {
  try {
    const clientes = await User.find({ tenantId: req.tenantId, rol: 'cliente', activo: true }).select('-password');
    res.json(clientes);
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al listar clientes.' });
  }
};

const crearCliente = async (req, res) => {
  try {
    const { nombre, documento, email, telefono, password } = req.body;
    if (!nombre || !documento || !email) {
      return res.status(400).json({ mensaje: 'Nombre, documento y correo son obligatorios.' });
    }
    if (!SOLO_LETRAS.test(nombre.trim())) {
      return res.status(400).json({ mensaje: 'El nombre solo debe contener letras y espacios.' });
    }
    if (!DNI_8_DIGITOS.test(documento.trim())) {
      return res.status(400).json({ mensaje: 'El documento (DNI) debe tener exactamente 8 dígitos.' });
    }
    if (telefono && !TELEFONO_9_DIGITOS.test(telefono.trim())) {
      return res.status(400).json({ mensaje: 'El teléfono debe tener exactamente 9 dígitos numéricos.' });
    }
    if (!validator.isEmail(email.trim())) {
      return res.status(400).json({ mensaje: 'Formato de correo inválido.' });
    }
    if (password && password.length < 6) {
      return res.status(400).json({ mensaje: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    const docExiste = await User.findOne({ tenantId: req.tenantId, documento: documento.trim(), activo: true });
    if (docExiste) {
      return res.status(400).json({ mensaje: 'El documento ya está registrado' });
    }

    // Si no se define contraseña, el cliente ingresa a su portal con su DNI como contraseña inicial
    const passwordHash = await bcrypt.hash(password || documento.trim(), 10);
    const cliente = await User.create({
      tenantId: req.tenantId,
      nombre: nombre.trim(),
      documento: documento.trim(),
      email: email.toLowerCase().trim(),
      telefono: telefono ? telefono.trim() : '',
      password: passwordHash,
      rol: 'cliente'
    });
    const { password: _omit, ...clienteSinPassword } = cliente.toObject();
    res.status(201).json({ mensaje: 'Cliente registrado con éxito.', cliente: clienteSinPassword });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ mensaje: 'El correo ya está registrado en esta organización.' });
    }
    res.status(500).json({ mensaje: 'Error al registrar cliente.' });
  }
};

const actualizarCliente = async (req, res) => {
  try {
    const { nombre, documento, email, telefono } = req.body;
    if (!esObjectId(req.params.id)) return res.status(404).json({ mensaje: 'Cliente no encontrado.' });

    if (nombre !== undefined && !SOLO_LETRAS.test(String(nombre).trim())) {
      return res.status(400).json({ mensaje: 'El nombre solo debe contener letras y espacios.' });
    }
    if (documento !== undefined && !DNI_8_DIGITOS.test(String(documento).trim())) {
      return res.status(400).json({ mensaje: 'El documento (DNI) debe tener exactamente 8 dígitos.' });
    }
    if (telefono && !TELEFONO_9_DIGITOS.test(String(telefono).trim())) {
      return res.status(400).json({ mensaje: 'El teléfono debe tener exactamente 9 dígitos numéricos.' });
    }
    if (email !== undefined && !validator.isEmail(String(email).trim())) {
      return res.status(400).json({ mensaje: 'Formato de correo inválido.' });
    }

    if (documento !== undefined) {
      const docExiste = await User.findOne({
        tenantId: req.tenantId, documento: String(documento).trim(), activo: true, _id: { $ne: req.params.id }
      });
      if (docExiste) return res.status(400).json({ mensaje: 'El documento ya está registrado' });
    }

    const cambios = soloDefinidos({
      nombre: nombre?.trim(),
      documento: documento?.trim(),
      email: email?.toLowerCase().trim(),
      telefono: telefono === undefined ? undefined : String(telefono).trim()
    });

    const cliente = await User.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId, rol: 'cliente', activo: true },
      cambios,
      OPCIONES_UPDATE
    ).select('-password');
    if (!cliente) return res.status(404).json({ mensaje: 'Cliente no encontrado.' });
    res.json({ mensaje: 'Cliente actualizado.', cliente });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ mensaje: 'El correo ya está registrado en esta organización.' });
    }
    res.status(500).json({ mensaje: 'Error al actualizar cliente.' });
  }
};

const eliminarCliente = async (req, res) => {
  try {
    if (!esObjectId(req.params.id)) return res.status(404).json({ mensaje: 'Cliente no encontrado.' });
    const cliente = await User.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId, rol: 'cliente' },
      { activo: false },
      { returnDocument: 'after' }
    );
    if (!cliente) return res.status(404).json({ mensaje: 'Cliente no encontrado.' });
    res.json({ mensaje: 'Cliente desactivado correctamente (historial preservado).' });
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al eliminar cliente.' });
  }
};

// ==================== EMPLEADOS / PERSONAL (HU-02) ====================
// Panel administrativo de personal (solo admin, HU-11)
const listarEmpleados = async (req, res) => {
  try {
    const filtro = { tenantId: req.tenantId, rol: { $in: ROLES_PERSONAL }, activo: true };
    if (req.query.especialidad) {
      const texto = String(req.query.especialidad).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filtro.especialidad = { $regex: texto, $options: 'i' };
    }
    const empleados = await User.find(filtro)
      .populate('serviciosAsignados', 'nombre duracionMinutos precio')
      .select('-password');
    res.json(empleados);
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al listar empleados.' });
  }
};

// Directorio público de profesionales para reservar (cualquier rol autenticado, sin datos de contacto)
const listarProfesionales = async (req, res) => {
  try {
    const profesionales = await User.find({ tenantId: req.tenantId, rol: 'profesional', activo: true })
      .populate('serviciosAsignados', 'nombre')
      .select('nombre especialidad horarioInicio horarioFin serviciosAsignados rol');
    res.json(profesionales);
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al listar profesionales.' });
  }
};

const validarDatosEmpleado = ({ nombre, telefono, email, rol, horarioInicio, horarioFin }) => {
  if (nombre !== undefined && !SOLO_LETRAS.test(String(nombre).trim())) {
    return 'El nombre solo debe contener letras y espacios.';
  }
  if (telefono && !TELEFONO_9_DIGITOS.test(String(telefono).trim())) {
    return 'El teléfono debe tener exactamente 9 dígitos numéricos.';
  }
  if (email !== undefined && !validator.isEmail(String(email).trim())) {
    return 'Formato de correo inválido.';
  }
  if (rol !== undefined && !ROLES_PERSONAL.includes(rol)) {
    return 'El rol debe ser profesional, recepcionista o admin.';
  }
  if ((horarioInicio && !HORA_HHMM.test(horarioInicio)) || (horarioFin && !HORA_HHMM.test(horarioFin))) {
    return 'El horario debe tener el formato HH:mm.';
  }
  if (horarioInicio && horarioFin && horarioFin <= horarioInicio) {
    return 'El horario de fin debe ser posterior al horario de inicio.';
  }
  return null;
};

const crearEmpleado = async (req, res) => {
  try {
    const { nombre, email, password, telefono, rol, especialidad, serviciosAsignados, horarioInicio, horarioFin } = req.body;
    if (!nombre || !email || !password) {
      return res.status(400).json({ mensaje: 'Nombre, correo y contraseña son obligatorios.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ mensaje: 'La contraseña debe tener al menos 6 caracteres.' });
    }
    const inicio = horarioInicio || '08:00';
    const fin = horarioFin || '18:00';
    const error = validarDatosEmpleado({ nombre, telefono, email, rol: rol || 'profesional', horarioInicio: inicio, horarioFin: fin });
    if (error) return res.status(400).json({ mensaje: error });

    const servicios = await validarServiciosAsignados(req.tenantId, serviciosAsignados || []);
    if (!servicios.ok) return res.status(400).json({ mensaje: servicios.mensaje });

    const passwordHash = await bcrypt.hash(password, 10);
    const empleado = await User.create({
      tenantId: req.tenantId,
      nombre: nombre.trim(),
      email: email.toLowerCase().trim(),
      password: passwordHash,
      telefono: telefono ? telefono.trim() : '',
      rol: rol || 'profesional',
      especialidad: especialidad ? especialidad.trim() : '',
      serviciosAsignados: servicios.ids,
      horarioInicio: inicio,
      horarioFin: fin
    });
    const { password: _omit, ...empleadoSinPassword } = empleado.toObject();
    res.status(201).json({ mensaje: 'Empleado registrado con éxito.', empleado: empleadoSinPassword });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ mensaje: 'Ya existe un usuario con ese correo.' });
    }
    res.status(500).json({ mensaje: 'Error al registrar empleado.' });
  }
};

const actualizarEmpleado = async (req, res) => {
  try {
    if (!esObjectId(req.params.id)) return res.status(404).json({ mensaje: 'Empleado no encontrado.' });
    const { nombre, email, telefono, rol, especialidad, serviciosAsignados, horarioInicio, horarioFin } = req.body;

    const actual = await User.findOne({ _id: req.params.id, tenantId: req.tenantId, rol: { $in: ROLES_PERSONAL }, activo: true });
    if (!actual) return res.status(404).json({ mensaje: 'Empleado no encontrado.' });

    const error = validarDatosEmpleado({
      nombre, telefono, email, rol,
      horarioInicio: horarioInicio || actual.horarioInicio,
      horarioFin: horarioFin || actual.horarioFin
    });
    if (error) return res.status(400).json({ mensaje: error });

    if (String(actual._id) === String(req.usuario.id) && rol && rol !== 'admin') {
      return res.status(400).json({ mensaje: 'No puedes quitarte a ti mismo el rol de administrador.' });
    }

    const servicios = await validarServiciosAsignados(req.tenantId, serviciosAsignados);
    if (!servicios.ok) return res.status(400).json({ mensaje: servicios.mensaje });

    const cambios = soloDefinidos({
      nombre: nombre?.trim(),
      email: email?.toLowerCase().trim(),
      telefono: telefono === undefined ? undefined : String(telefono).trim(),
      rol,
      especialidad: especialidad === undefined ? undefined : String(especialidad).trim(),
      serviciosAsignados: servicios.ids,
      horarioInicio,
      horarioFin
    });

    const empleado = await User.findByIdAndUpdate(actual._id, cambios, OPCIONES_UPDATE)
      .populate('serviciosAsignados', 'nombre duracionMinutos precio')
      .select('-password');
    res.json({ mensaje: 'Empleado actualizado.', empleado });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ mensaje: 'Ya existe un usuario con ese correo.' });
    }
    res.status(500).json({ mensaje: 'Error al actualizar empleado.' });
  }
};

const eliminarEmpleado = async (req, res) => {
  try {
    if (!esObjectId(req.params.id)) return res.status(404).json({ mensaje: 'Empleado no encontrado.' });
    if (String(req.params.id) === String(req.usuario.id)) {
      return res.status(400).json({ mensaje: 'No puedes desactivar tu propia cuenta.' });
    }

    const empleado = await User.findOne({ _id: req.params.id, tenantId: req.tenantId, rol: { $in: ROLES_PERSONAL }, activo: true });
    if (!empleado) return res.status(404).json({ mensaje: 'Empleado no encontrado.' });

    const citasFuturas = await Appointment.countDocuments({
      tenantId: req.tenantId,
      profesionalId: empleado._id,
      fechaInicio: { $gte: new Date() },
      estado: { $in: ['programada', 'confirmada'] }
    });

    if (citasFuturas > 0 && req.query.forzar !== 'true') {
      return res.status(409).json({
        requiereConfirmacion: true,
        mensaje: `El empleado tiene ${citasFuturas} cita(s) futura(s) pendiente(s). ¿Deseas desactivarlo de todas formas?`
      });
    }

    empleado.activo = false;
    await empleado.save();
    res.json({ mensaje: 'Empleado desactivado correctamente.' });
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al desactivar empleado.' });
  }
};

// ==================== SERVICIOS (HU-03) ====================
const listarServicios = async (req, res) => {
  try {
    const servicios = await Service.find({ tenantId: req.tenantId, activo: true });
    res.json(servicios);
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al listar servicios.' });
  }
};

const validarDatosServicio = ({ nombre, duracionMinutos, precio }, esNuevo) => {
  if (esNuevo && !String(nombre || '').trim()) return 'El nombre del servicio es obligatorio.';
  if (!esNuevo && nombre !== undefined && !String(nombre).trim()) return 'El nombre del servicio es obligatorio.';
  if ((esNuevo || duracionMinutos !== undefined) && !(Number(duracionMinutos) > 0)) {
    return 'La duración debe ser mayor a 0';
  }
  if ((esNuevo || precio !== undefined) && (precio === '' || Number.isNaN(Number(precio)) || Number(precio) < 0)) {
    return 'El costo no puede ser negativo.';
  }
  return null;
};

const crearServicio = async (req, res) => {
  try {
    const { nombre, descripcion, duracionMinutos, precio } = req.body;
    const error = validarDatosServicio({ nombre, duracionMinutos, precio }, true);
    if (error) return res.status(400).json({ mensaje: error });

    const servicio = await Service.create({
      tenantId: req.tenantId,
      nombre: nombre.trim(),
      descripcion,
      duracionMinutos: Number(duracionMinutos),
      precio: Number(precio)
    });
    res.status(201).json({ mensaje: 'Servicio creado con éxito.', servicio });
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al crear servicio.' });
  }
};

// HU-03 (escenario 3): el nuevo costo solo afecta a citas futuras (las existentes guardan costoRegistrado)
const actualizarServicio = async (req, res) => {
  try {
    if (!esObjectId(req.params.id)) return res.status(404).json({ mensaje: 'Servicio no encontrado.' });
    const { nombre, descripcion, duracionMinutos, precio } = req.body;
    const error = validarDatosServicio({ nombre, duracionMinutos, precio }, false);
    if (error) return res.status(400).json({ mensaje: error });

    const cambios = soloDefinidos({
      nombre: nombre?.trim(),
      descripcion,
      duracionMinutos: duracionMinutos === undefined ? undefined : Number(duracionMinutos),
      precio: precio === undefined ? undefined : Number(precio)
    });

    const servicio = await Service.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId, activo: true },
      cambios,
      OPCIONES_UPDATE
    );
    if (!servicio) return res.status(404).json({ mensaje: 'Servicio no encontrado.' });
    res.json({ mensaje: 'Servicio actualizado.', servicio });
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al actualizar servicio.' });
  }
};

const eliminarServicio = async (req, res) => {
  try {
    if (!esObjectId(req.params.id)) return res.status(404).json({ mensaje: 'Servicio no encontrado.' });
    const servicio = await Service.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId, activo: true },
      { activo: false }
    );
    if (!servicio) return res.status(404).json({ mensaje: 'Servicio no encontrado.' });
    res.json({ mensaje: 'Servicio desactivado (historial preservado).' });
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al eliminar servicio.' });
  }
};

// ==================== DASHBOARD / INDICADORES (HU-13 & HU-15) ====================
const rangoMesActual = () => {
  const hoy = new Date();
  const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
  return { desde: aFechaYMD(primerDia), hasta: aFechaYMD(ultimoDia) };
};

const obtenerIndicadores = async (req, res) => {
  try {
    let { fechaDesde, fechaHasta } = req.query;
    if (fechaDesde && fechaHasta && fechaHasta < fechaDesde) {
      return res.status(400).json({ mensaje: 'La fecha "Hasta" no puede ser anterior a la fecha "Desde".' });
    }

    // HU-13 (escenario 1): sin rango explícito se usan las métricas del mes en curso
    if (!fechaDesde && !fechaHasta) {
      const mes = rangoMesActual();
      fechaDesde = mes.desde;
      fechaHasta = mes.hasta;
    }

    // HU-15: el filtro por tenantId garantiza métricas exclusivas de la organización
    const filtroFecha = { tenantId: req.tenantId, fechaInicio: {} };
    if (fechaDesde) filtroFecha.fechaInicio.$gte = inicioDelDia(fechaDesde);
    if (fechaHasta) filtroFecha.fechaInicio.$lte = finDelDia(fechaHasta);

    const citas = await Appointment.find(filtroFecha)
      .populate('servicioId', 'nombre')
      .populate('clienteId', 'nombre');

    const contar = (estado) => citas.filter((c) => c.estado === estado).length;
    const totalCitas = citas.length;
    const citasActivas = citas.filter((c) => ['programada', 'confirmada'].includes(c.estado)).length;
    const citasCompletadas = contar('completada');
    const citasCanceladas = contar('cancelada');
    const citasNoAsistio = contar('no_asistio');
    const ingresosEstimados = citas
      .filter((c) => !['cancelada', 'no_asistio'].includes(c.estado))
      .reduce((acc, c) => acc + (c.costoRegistrado || 0), 0);

    const conteoServicios = {};
    const conteoClientes = {};

    citas.forEach((c) => {
      if (c.servicioId?.nombre) {
        conteoServicios[c.servicioId.nombre] = (conteoServicios[c.servicioId.nombre] || 0) + 1;
      }
      if (c.clienteId?.nombre) {
        const clave = String(c.clienteId._id);
        conteoClientes[clave] = conteoClientes[clave] || { nombre: c.clienteId.nombre, cantidad: 0, inasistencias: 0 };
        conteoClientes[clave].cantidad += 1;
        if (c.estado === 'no_asistio') conteoClientes[clave].inasistencias += 1;
      }
    });

    const topServicios = Object.entries(conteoServicios)
      .map(([nombre, cantidad]) => ({ nombre, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 5);

    const topClientes = Object.values(conteoClientes)
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 5);

    res.json({
      periodo: { fechaDesde: fechaDesde || null, fechaHasta: fechaHasta || null },
      totalCitas,
      citasActivas,
      citasCompletadas,
      citasCanceladas,
      citasNoAsistio,
      ingresosEstimados: Math.round(ingresosEstimados * 100) / 100,
      topServicios,
      topClientes
    });
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al calcular indicadores.' });
  }
};

module.exports = {
  listarClientes, crearCliente, actualizarCliente, eliminarCliente,
  listarEmpleados, listarProfesionales, crearEmpleado, actualizarEmpleado, eliminarEmpleado,
  listarServicios, crearServicio, actualizarServicio, eliminarServicio,
  obtenerIndicadores
};
