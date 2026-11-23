const mongoose = require('mongoose');
const Appointment = require('../models/Appointment');
const Service = require('../models/Service');
const User = require('../models/User');

const ESTADOS_ACTIVOS = ['programada', 'confirmada'];
const ESTADOS_VALIDOS = ['programada', 'confirmada', 'completada', 'cancelada', 'no_asistio'];
const INTERVALO_SLOTS_MIN = 30;
const DIAS_BUSQUEDA_SUGERENCIAS = 7;
const MAX_SUGERENCIAS = 3;

// Transiciones permitidas del ciclo de vida de una cita (HU-10)
const TRANSICIONES_VALIDAS = {
  programada: ['confirmada', 'cancelada', 'no_asistio', 'completada'],
  confirmada: ['completada', 'cancelada', 'no_asistio'],
  completada: [],
  cancelada: [],
  no_asistio: []
};

// Estados que cada rol puede asignar (HU-06, HU-10, HU-11)
const ESTADOS_POR_ROL = {
  admin: ['confirmada', 'completada', 'cancelada', 'no_asistio'],
  recepcionista: ['confirmada', 'completada', 'cancelada', 'no_asistio'],
  profesional: ['confirmada', 'completada', 'no_asistio'],
  cliente: ['confirmada', 'cancelada']
};

// ==================== UTILIDADES DE FECHA ====================
// Las fechas "YYYY-MM-DD" se interpretan en la zona horaria del servidor (TZ, por defecto America/Lima)

const horaAMinutos = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const inicioDelDia = (fechaYMD) => new Date(`${fechaYMD}T00:00:00`);

const finDelDia = (fechaYMD) => new Date(`${fechaYMD}T23:59:59.999`);

const aFechaYMD = (date) => {
  const d = new Date(date);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

const sumarDias = (fechaYMD, dias) => {
  const d = inicioDelDia(fechaYMD);
  d.setDate(d.getDate() + dias);
  return aFechaYMD(d);
};

const esFechaValida = (date) => date instanceof Date && !Number.isNaN(date.getTime());

const esObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// Un profesional sin servicios asignados atiende cualquier servicio (compatibilidad con datos previos)
const atiendeServicio = (profesional, servicioId) => {
  if (!servicioId) return true;
  const asignados = profesional.serviciosAsignados || [];
  if (asignados.length === 0) return true;
  return asignados.some((s) => String(s._id || s) === String(servicioId));
};

// ==================== CÁLCULO DE HORARIOS LIBRES (HU-07) ====================
const calcularSlotsLibres = (profesional, fechaYMD, duracion, citasProfesional) => {
  const jInicio = horaAMinutos(profesional.horarioInicio || '08:00');
  const jFin = horaAMinutos(profesional.horarioFin || '18:00');
  const ahora = new Date();
  const slots = [];

  for (let min = jInicio; min + duracion <= jFin; min += INTERVALO_SLOTS_MIN) {
    const slotInicio = inicioDelDia(fechaYMD);
    slotInicio.setMinutes(min);
    const slotFin = new Date(slotInicio.getTime() + duracion * 60000);

    const ocupado = citasProfesional.some((c) => c.fechaInicio < slotFin && c.fechaFin > slotInicio);
    if (!ocupado && slotInicio > ahora) {
      slots.push({
        fecha: fechaYMD,
        inicio: slotInicio.toTimeString().slice(0, 5),
        fin: slotFin.toTimeString().slice(0, 5),
        fechaISO: slotInicio.toISOString()
      });
    }
  }
  return slots;
};

const obtenerSlotsDelDia = async ({ tenantId, profesional, fechaYMD, duracion, excluirCitaId = null }) => {
  const filtro = {
    tenantId,
    profesionalId: profesional._id,
    estado: { $in: ESTADOS_ACTIVOS },
    fechaInicio: { $lt: finDelDia(fechaYMD) },
    fechaFin: { $gt: inicioDelDia(fechaYMD) }
  };
  if (excluirCitaId) filtro._id = { $ne: excluirCitaId };

  const citas = await Appointment.find(filtro).select('fechaInicio fechaFin');
  return calcularSlotsLibres(profesional, fechaYMD, duracion, citas);
};

// HU-07 (escenario 2): fechas cercanas con al menos un horario libre
const sugerirFechasCercanas = async ({ tenantId, profesional, fechaYMD, duracion }) => {
  const fechas = [];
  for (let i = 1; i <= DIAS_BUSQUEDA_SUGERENCIAS && fechas.length < MAX_SUGERENCIAS; i++) {
    const fechaCandidata = sumarDias(fechaYMD, i);
    const slots = await obtenerSlotsDelDia({ tenantId, profesional, fechaYMD: fechaCandidata, duracion });
    if (slots.length > 0) fechas.push({ fecha: fechaCandidata, primerHorario: slots[0].inicio });
  }
  return fechas;
};

// HU-05 (escenario 3): horarios libres más cercanos a la hora solicitada
const sugerirHorariosCercanos = async ({ tenantId, profesional, fechaSolicitada, duracion, excluirCitaId = null }) => {
  const fechaBase = aFechaYMD(fechaSolicitada);
  const objetivo = fechaSolicitada.getTime();

  for (let i = 0; i <= DIAS_BUSQUEDA_SUGERENCIAS; i++) {
    const fechaYMD = sumarDias(fechaBase, i);
    const slots = await obtenerSlotsDelDia({ tenantId, profesional, fechaYMD, duracion, excluirCitaId });
    if (slots.length > 0) {
      return slots
        .sort((a, b) => Math.abs(new Date(a.fechaISO) - objetivo) - Math.abs(new Date(b.fechaISO) - objetivo))
        .slice(0, MAX_SUGERENCIAS)
        .sort((a, b) => new Date(a.fechaISO) - new Date(b.fechaISO));
    }
  }
  return [];
};

// ==================== VALIDACIÓN DE JORNADA Y TRASLAPES (HU-04, HU-05, HU-09) ====================
const validarDisponibilidadHorario = async ({ tenantId, profesional, fechaInicio, fechaFin, excluirCitaId = null }) => {
  if (fechaInicio <= new Date()) {
    return { valido: false, mensaje: 'No se pueden programar citas en fechas u horas pasadas.' };
  }

  if (aFechaYMD(fechaInicio) !== aFechaYMD(fechaFin - 1)) {
    return { valido: false, mensaje: 'La cita debe iniciar y terminar el mismo día.' };
  }

  const minInicio = fechaInicio.getHours() * 60 + fechaInicio.getMinutes();
  const minFin = fechaFin.getHours() * 60 + fechaFin.getMinutes() || 24 * 60;
  const jornadaInicio = horaAMinutos(profesional.horarioInicio || '08:00');
  const jornadaFin = horaAMinutos(profesional.horarioFin || '18:00');

  if (minInicio < jornadaInicio || minFin > jornadaFin) {
    return {
      valido: false,
      motivo: 'fuera_de_jornada',
      mensaje: `El horario está fuera de la jornada laboral del empleado (${profesional.horarioInicio || '08:00'} - ${profesional.horarioFin || '18:00'}).`
    };
  }

  // Regla de no traslape: inicioA < finB && finA > inicioB (horarios consecutivos sí se permiten)
  const queryTraslape = {
    tenantId,
    profesionalId: profesional._id,
    estado: { $in: ESTADOS_ACTIVOS },
    fechaInicio: { $lt: fechaFin },
    fechaFin: { $gt: fechaInicio }
  };
  if (excluirCitaId) queryTraslape._id = { $ne: excluirCitaId };

  const citaConflicto = await Appointment.findOne(queryTraslape);
  if (citaConflicto) {
    return { valido: false, motivo: 'traslape', mensaje: 'El empleado ya tiene una cita en ese horario.' };
  }

  return { valido: true };
};

const buscarProfesional = (tenantId, profesionalId) => {
  if (!esObjectId(profesionalId)) return null;
  return User.findOne({ _id: profesionalId, tenantId, rol: 'profesional', activo: true });
};

// ==================== LISTAR Y FILTRAR CITAS (HU-08, HU-11, HU-12) ====================
const listarCitas = async (req, res) => {
  try {
    const { fechaDesde, fechaHasta, profesionalId, servicioId, estado, buscarCliente } = req.query;
    const filtro = { tenantId: req.tenantId };

    if (req.usuario.rol === 'profesional') {
      filtro.profesionalId = req.usuario.id;
    } else if (req.usuario.rol === 'cliente') {
      filtro.clienteId = req.usuario.id;
    } else if (profesionalId) {
      if (!esObjectId(profesionalId)) return res.json([]);
      filtro.profesionalId = profesionalId;
    }

    if (servicioId) {
      if (!esObjectId(servicioId)) return res.json([]);
      filtro.servicioId = servicioId;
    }
    if (estado) {
      if (!ESTADOS_VALIDOS.includes(estado)) {
        return res.status(400).json({ mensaje: 'Estado de cita no válido.' });
      }
      filtro.estado = estado;
    }

    if (fechaDesde && fechaHasta && fechaHasta < fechaDesde) {
      return res.status(400).json({ mensaje: 'La fecha "Hasta" no puede ser anterior a la fecha "Desde".' });
    }
    if (fechaDesde || fechaHasta) {
      filtro.fechaInicio = {};
      if (fechaDesde) filtro.fechaInicio.$gte = inicioDelDia(fechaDesde);
      if (fechaHasta) filtro.fechaInicio.$lte = finDelDia(fechaHasta);
    }

    let citas = await Appointment.find(filtro)
      .populate('clienteId', 'nombre documento email telefono')
      .populate('profesionalId', 'nombre especialidad')
      .populate('servicioId', 'nombre duracionMinutos precio')
      .sort({ fechaInicio: 1 });

    if (buscarCliente) {
      const q = String(buscarCliente).toLowerCase().trim();
      citas = citas.filter((c) =>
        c.clienteId?.nombre?.toLowerCase().includes(q) ||
        c.clienteId?.documento?.toLowerCase().includes(q)
      );
    }

    res.json(citas);
  } catch (error) {
    console.error('Error en listarCitas:', error);
    res.status(500).json({ mensaje: 'Error al obtener las citas.' });
  }
};

// ==================== CONSULTAR HORARIOS LIBRES (HU-07) ====================
const consultarDisponibilidad = async (req, res) => {
  try {
    const { fecha, profesionalId, servicioId } = req.query;
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !esFechaValida(inicioDelDia(fecha))) {
      return res.status(400).json({ mensaje: 'Debes indicar una fecha válida (YYYY-MM-DD).' });
    }

    let duracion = INTERVALO_SLOTS_MIN;
    if (servicioId) {
      if (!esObjectId(servicioId)) return res.status(400).json({ mensaje: 'Servicio no válido.' });
      const srv = await Service.findOne({ _id: servicioId, tenantId: req.tenantId, activo: true });
      if (!srv) return res.status(404).json({ mensaje: 'El servicio seleccionado no existe o está inactivo.' });
      duracion = srv.duracionMinutos;
    }

    const filtroEmp = { tenantId: req.tenantId, rol: 'profesional', activo: true };
    if (profesionalId) {
      if (!esObjectId(profesionalId)) return res.status(400).json({ mensaje: 'Empleado no válido.' });
      filtroEmp._id = profesionalId;
    }

    // HU-07 (escenario 3): solo empleados calificados para el servicio
    const profesionales = (await User.find(filtroEmp)
      .select('nombre especialidad horarioInicio horarioFin serviciosAsignados'))
      .filter((prof) => atiendeServicio(prof, servicioId));

    const resultado = await Promise.all(profesionales.map(async (prof) => {
      const slots = await obtenerSlotsDelDia({ tenantId: req.tenantId, profesional: prof, fechaYMD: fecha, duracion });
      const fechasSugeridas = slots.length === 0
        ? await sugerirFechasCercanas({ tenantId: req.tenantId, profesional: prof, fechaYMD: fecha, duracion })
        : [];

      return {
        profesionalId: prof._id,
        profesional: prof.nombre,
        especialidad: prof.especialidad,
        slots,
        fechasSugeridas
      };
    }));

    res.json(resultado);
  } catch (error) {
    console.error('Error en consultarDisponibilidad:', error);
    res.status(500).json({ mensaje: 'Error al consultar disponibilidad.' });
  }
};

// ==================== CREAR CITA (HU-04 & HU-09) ====================
const crearCita = async (req, res) => {
  try {
    const { clienteId, profesionalId, servicioId, fechaInicio, notas } = req.body;
    const clienteFinal = req.usuario.rol === 'cliente' ? req.usuario.id : clienteId;

    if (!clienteFinal || !profesionalId || !servicioId || !fechaInicio) {
      return res.status(400).json({ mensaje: 'Cliente, empleado, servicio y fecha son obligatorios.' });
    }
    if (![clienteFinal, profesionalId, servicioId].every(esObjectId)) {
      return res.status(400).json({ mensaje: 'Cliente, empleado o servicio no válido.' });
    }

    const inicio = new Date(fechaInicio);
    if (!esFechaValida(inicio)) {
      return res.status(400).json({ mensaje: 'La fecha y hora de inicio no son válidas.' });
    }

    const [cliente, profesional, servicio] = await Promise.all([
      User.findOne({ _id: clienteFinal, tenantId: req.tenantId, rol: 'cliente', activo: true }),
      buscarProfesional(req.tenantId, profesionalId),
      Service.findOne({ _id: servicioId, tenantId: req.tenantId, activo: true })
    ]);

    if (!cliente || !profesional || !servicio) {
      return res.status(404).json({ mensaje: 'Cliente, empleado o servicio no válido.' });
    }
    if (!atiendeServicio(profesional, servicio._id)) {
      return res.status(400).json({ mensaje: 'El empleado seleccionado no ofrece el servicio elegido.' });
    }

    // HU-04 (escenario 2): la hora de fin se calcula con la duración del servicio
    const fin = new Date(inicio.getTime() + servicio.duracionMinutos * 60000);

    const chequeo = await validarDisponibilidadHorario({
      tenantId: req.tenantId, profesional, fechaInicio: inicio, fechaFin: fin
    });

    if (!chequeo.valido) {
      const sugerencias = chequeo.motivo === 'traslape'
        ? await sugerirHorariosCercanos({ tenantId: req.tenantId, profesional, fechaSolicitada: inicio, duracion: servicio.duracionMinutos })
        : [];
      return res.status(409).json({ mensaje: chequeo.mensaje, sugerencias });
    }

    const nuevaCita = await Appointment.create({
      tenantId: req.tenantId,
      clienteId: cliente._id,
      profesionalId: profesional._id,
      servicioId: servicio._id,
      fechaInicio: inicio,
      fechaFin: fin,
      costoRegistrado: servicio.precio, // HU-03: precio congelado al momento de reservar
      estado: 'programada',
      notas,
      historialCambios: [{ accion: 'CREADA', detalle: `Cita registrada por ${req.usuario.rol}` }]
    });

    res.status(201).json({ mensaje: 'Cita programada con éxito.', cita: nuevaCita });
  } catch (error) {
    console.error('Error en crearCita:', error);
    res.status(500).json({ mensaje: 'Error al registrar la cita.' });
  }
};

// ==================== REPROGRAMAR CITA (HU-05) ====================
const reprogramarCita = async (req, res) => {
  try {
    const { fechaInicio, profesionalId } = req.body;
    if (!esObjectId(req.params.id)) return res.status(404).json({ mensaje: 'Cita no encontrada.' });

    const cita = await Appointment.findOne({ _id: req.params.id, tenantId: req.tenantId }).populate('servicioId');
    if (!cita) return res.status(404).json({ mensaje: 'Cita no encontrada.' });

    if (!ESTADOS_ACTIVOS.includes(cita.estado)) {
      const nombreEstado = cita.estado === 'no_asistio' ? 'marcada como inasistencia' : cita.estado;
      return res.status(400).json({ mensaje: `No es posible modificar una cita ${nombreEstado}.` });
    }

    const nuevoInicio = fechaInicio ? new Date(fechaInicio) : new Date(cita.fechaInicio);
    if (!esFechaValida(nuevoInicio)) {
      return res.status(400).json({ mensaje: 'La nueva fecha y hora no son válidas.' });
    }

    const profIdFinal = profesionalId || cita.profesionalId;
    const profesional = await buscarProfesional(req.tenantId, profIdFinal);
    if (!profesional) return res.status(404).json({ mensaje: 'Empleado no válido o inactivo.' });

    // HU-05 (escenario 4): el nuevo empleado debe ofrecer el mismo servicio
    if (!atiendeServicio(profesional, cita.servicioId?._id)) {
      return res.status(400).json({ mensaje: 'El empleado seleccionado no ofrece el servicio de esta cita.' });
    }

    const duracion = cita.servicioId?.duracionMinutos || INTERVALO_SLOTS_MIN;
    const nuevoFin = new Date(nuevoInicio.getTime() + duracion * 60000);

    const chequeo = await validarDisponibilidadHorario({
      tenantId: req.tenantId,
      profesional,
      fechaInicio: nuevoInicio,
      fechaFin: nuevoFin,
      excluirCitaId: cita._id
    });

    if (!chequeo.valido) {
      // HU-05 (escenario 3): sugerir los horarios libres más cercanos
      const sugerencias = await sugerirHorariosCercanos({
        tenantId: req.tenantId, profesional, fechaSolicitada: nuevoInicio, duracion, excluirCitaId: cita._id
      });
      return res.status(409).json({ mensaje: chequeo.mensaje, sugerencias });
    }

    const cambios = [];
    if (String(cita.profesionalId) !== String(profesional._id)) cambios.push(`empleado: ${profesional.nombre}`);
    if (cita.fechaInicio.getTime() !== nuevoInicio.getTime()) {
      cambios.push(`fecha: ${cita.fechaInicio.toLocaleString('es-PE')} → ${nuevoInicio.toLocaleString('es-PE')}`);
    }
    if (cambios.length === 0) {
      return res.status(400).json({ mensaje: 'No se detectaron cambios para reprogramar.' });
    }

    cita.profesionalId = profesional._id;
    cita.fechaInicio = nuevoInicio;
    cita.fechaFin = nuevoFin;
    cita.historialCambios.push({
      accion: 'REPROGRAMADA',
      detalle: `Reprogramada por ${req.usuario.rol}. Cambios: ${cambios.join('; ')}`
    });

    await cita.save();
    res.json({ mensaje: 'Cita reprogramada con éxito.', cita });
  } catch (error) {
    console.error('Error en reprogramarCita:', error);
    res.status(500).json({ mensaje: 'Error al reprogramar la cita.' });
  }
};

// ==================== CANCELAR Y CAMBIAR ESTADO (HU-06 & HU-10) ====================
const cambiarEstadoCita = async (req, res) => {
  try {
    const { estado, motivoCancelacion, confirmarFueraDePlazo } = req.body;
    const { rol, id: usuarioId } = req.usuario;

    if (!ESTADOS_VALIDOS.includes(estado)) {
      return res.status(400).json({ mensaje: 'Estado de cita no válido.' });
    }
    if (!esObjectId(req.params.id)) return res.status(404).json({ mensaje: 'Cita no encontrada.' });

    const cita = await Appointment.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!cita) return res.status(404).json({ mensaje: 'Cita no encontrada.' });

    // HU-11: control de acceso por rol y propiedad de la cita
    if (!(ESTADOS_POR_ROL[rol] || []).includes(estado)) {
      return res.status(403).json({ mensaje: `Tu rol (${rol}) no puede marcar una cita como "${estado}".` });
    }
    if (rol === 'profesional' && String(cita.profesionalId) !== String(usuarioId)) {
      return res.status(403).json({ mensaje: 'Solo puedes actualizar las citas de tu propia agenda.' });
    }
    if (rol === 'cliente' && String(cita.clienteId) !== String(usuarioId)) {
      return res.status(403).json({ mensaje: 'Solo puedes actualizar tus propias citas.' });
    }

    if (!TRANSICIONES_VALIDAS[cita.estado]?.includes(estado)) {
      if (cita.estado === 'completada' && estado === 'cancelada') {
        return res.status(400).json({ mensaje: 'No es posible cancelar esta cita porque ya fue atendida.' });
      }
      return res.status(400).json({
        mensaje: `Transición inválida: una cita "${cita.estado}" no puede pasar a "${estado}".`
      });
    }

    if (estado === 'no_asistio' && new Date(cita.fechaInicio) > new Date()) {
      return res.status(400).json({ mensaje: 'Solo se puede marcar la inasistencia cuando la hora de la cita ya pasó.' });
    }

    if (estado === 'cancelada') {
      const motivo = String(motivoCancelacion || '').trim();
      if (!motivo) {
        return res.status(400).json({ mensaje: 'Debes indicar el motivo de la cancelación.' });
      }
      // HU-06 (escenario 3): política de cancelación con 2 horas de anticipación
      const horasRestantes = (new Date(cita.fechaInicio) - new Date()) / (1000 * 60 * 60);
      if (horasRestantes < 2 && !confirmarFueraDePlazo) {
        return res.status(409).json({
          requiereConfirmacion: true,
          mensaje: 'Faltan menos de 2 horas para la cita: la cancelación está fuera del plazo permitido. ¿Deseas confirmarla de todas formas?'
        });
      }
      cita.motivoCancelacion = motivo;
    }

    cita.estado = estado;
    cita.historialCambios.push({
      accion: `ESTADO_${estado.toUpperCase()}`,
      detalle: estado === 'cancelada'
        ? `Cancelada por ${rol}. Motivo: ${cita.motivoCancelacion}`
        : `Cambio de estado a ${estado} por ${rol}`
    });

    await cita.save();
    res.json({ mensaje: `Estado actualizado a "${estado}".`, cita });
  } catch (error) {
    console.error('Error en cambiarEstadoCita:', error);
    res.status(500).json({ mensaje: 'Error al actualizar el estado de la cita.' });
  }
};

module.exports = {
  listarCitas,
  consultarDisponibilidad,
  crearCita,
  reprogramarCita,
  cambiarEstadoCita,
  // Utilidades compartidas con el dashboard
  inicioDelDia,
  finDelDia,
  aFechaYMD
};
