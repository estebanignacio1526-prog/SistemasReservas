import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import Swal from 'sweetalert2';
import { ToastContainer, toast } from 'react-toastify';
import isEmail from 'validator/es/lib/isEmail';
import api from './services/api';
import {
  ESTADOS_ACTIVOS, ETIQUETA_ESTADO, atiendeServicio, escaparHTML, fechaHoraLocalInput,
  fechaLocalYMD, formatearFechaCorta, formatearFechaHora, formatearHora, rangoMesActual
} from './utils/citas';

// FullCalendar se carga en un chunk aparte para aligerar la carga inicial
const AgendaCalendario = lazy(() => import('./components/AgendaCalendario'));

const OBLIGATORIO = 'Este campo es obligatorio';
const pestanaInicial = (u) => (u?.rol === 'admin' ? 'dashboard' : 'agenda');

const CLIENTE_VACIO = { id: null, nombre: '', documento: '', email: '', telefono: '' };
const EMPLEADO_VACIO = {
  id: null, nombre: '', email: '', password: '', telefono: '', rol: 'profesional',
  especialidad: '', serviciosAsignados: [], horarioInicio: '08:00', horarioFin: '18:00'
};
const SERVICIO_VACIO = { id: null, nombre: '', descripcion: '', duracionMinutos: 30, precio: 50 };
const FILTROS_VACIOS = { buscarCliente: '', profesionalId: '', servicioId: '', estado: '', fechaDesde: '', fechaHasta: '' };

// HU-14: mensaje de error bajo cada campo inválido
function CampoError({ mensaje }) {
  return mensaje ? <small className="field-error">{mensaje}</small> : null;
}

const claseCampo = (errores, campo) => (errores[campo] ? 'input-error' : undefined);

export default function App() {
  const [usuario, setUsuario] = useState(() => {
    try {
      const saved = localStorage.getItem('usuario');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [tab, setTab] = useState(() => pestanaInicial(usuario));

  const rol = usuario?.rol;
  const esAdmin = rol === 'admin';
  const esGestion = rol === 'admin' || rol === 'recepcionista';
  const puedeAgendar = esGestion || rol === 'cliente';

  // Filtros de entrada en tiempo real (HU-14)
  const soloLetras = (valor) => valor.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]/g, '');
  const solo9Digitos = (valor) => valor.replace(/\D/g, '').slice(0, 9);
  const solo8Digitos = (valor) => valor.replace(/\D/g, '').slice(0, 8);

  // Auth
  const [modoRegistro, setModoRegistro] = useState(true);
  const [authForm, setAuthForm] = useState({
    nombreEmpresa: '', rubro: '', telefono: '', nombreAdmin: '', email: '', password: ''
  });

  // Datos maestros (aislados por tenantId)
  const [indicadores, setIndicadores] = useState({
    totalCitas: 0, citasActivas: 0, citasCompletadas: 0, citasCanceladas: 0, citasNoAsistio: 0,
    ingresosEstimados: 0, topServicios: [], topClientes: []
  });
  const [rangoKpi, setRangoKpi] = useState(rangoMesActual);
  const [clientes, setClientes] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [profesionales, setProfesionales] = useState([]);
  const [servicios, setServicios] = useState([]);
  const [citas, setCitas] = useState([]);

  // Filtros de citas (HU-12) y vista de agenda (HU-08)
  const [filtros, setFiltros] = useState(FILTROS_VACIOS);
  const [vistaAgenda, setVistaAgenda] = useState('calendario');

  // Formularios CRUD
  const [clienteForm, setClienteForm] = useState(CLIENTE_VACIO);
  const [erroresCliente, setErroresCliente] = useState({});
  const [empleadoForm, setEmpleadoForm] = useState(EMPLEADO_VACIO);
  const [erroresEmpleado, setErroresEmpleado] = useState({});
  const [filtroEspecialidad, setFiltroEspecialidad] = useState('');
  const [servicioForm, setServicioForm] = useState(SERVICIO_VACIO);
  const [erroresServicio, setErroresServicio] = useState({});

  // Reserva y disponibilidad (HU-04 & HU-07)
  const [citaForm, setCitaForm] = useState(() => ({
    clienteId: '', profesionalId: '', servicioId: '', fecha: fechaLocalYMD(), fechaInicio: '', notas: ''
  }));
  const [erroresCita, setErroresCita] = useState({});
  const [disponibilidad, setDisponibilidad] = useState(null);

  const hoyYMD = fechaLocalYMD();

  useEffect(() => {
    const goOnline = () => { setIsOnline(true); toast.success('Conexión restablecida.'); };
    const goOffline = () => { setIsOnline(false); toast.warning('Sin conexión: operando con datos en caché.'); };
    const handleInstallPrompt = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    // HU-11 (escenario 3): token expirado → volver a la pantalla de inicio de sesión
    const handleSessionExpired = () => { setUsuario(null); toast.error('Tu sesión ha expirado. Inicia sesión nuevamente.'); };

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('sesion-expirada', handleSessionExpired);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('sesion-expirada', handleSessionExpired);
    };
  }, []);

  const instalarPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setDeferredPrompt(null);
  };

  // HU-14 (escenario 3): notificación clara sin detalles técnicos
  const notificarError = useCallback((error, mensajePorDefecto) => {
    if (!navigator.onLine) return;
    if (error.response?.status === 401) return; // lo maneja el interceptor de sesión
    const mensaje = error.response?.status >= 500 || !error.response
      ? mensajePorDefecto
      : error.response?.data?.mensaje || mensajePorDefecto;
    toast.error(mensaje);
  }, []);

  // ==================== CARGA DE DATOS ====================
  const cargarMaestros = useCallback(async () => {
    if (!usuario) return;
    try {
      const [resServ, resProf] = await Promise.all([api.get('/servicios'), api.get('/profesionales')]);
      setServicios(resServ.data);
      setProfesionales(resProf.data);
      if (['admin', 'recepcionista'].includes(usuario.rol)) {
        const resCli = await api.get('/clientes');
        setClientes(resCli.data);
      }
      if (usuario.rol === 'admin') {
        const resEmp = await api.get('/empleados');
        setEmpleados(resEmp.data);
      }
    } catch (error) {
      notificarError(error, 'Error al sincronizar datos.');
    }
  }, [usuario, notificarError]);

  const cargarCitas = useCallback(async () => {
    if (!usuario) return;
    try {
      const params = Object.fromEntries(Object.entries(filtros).filter(([, v]) => v));
      const { data } = await api.get('/citas', { params });
      setCitas(data);
    } catch (error) {
      notificarError(error, 'Error al obtener las citas.');
    }
  }, [usuario, filtros, notificarError]);

  const cargarIndicadores = useCallback(async () => {
    if (!usuario || !['admin', 'recepcionista'].includes(usuario.rol)) return;
    try {
      const params = Object.fromEntries(Object.entries(rangoKpi).filter(([, v]) => v));
      const { data } = await api.get('/indicadores', { params });
      setIndicadores(data);
    } catch (error) {
      notificarError(error, 'Error al calcular indicadores.');
    }
  }, [usuario, rangoKpi, notificarError]);

  const recargarTodo = () => {
    cargarMaestros();
    cargarCitas();
    cargarIndicadores();
  };

  useEffect(() => { cargarMaestros(); }, [cargarMaestros]);
  useEffect(() => { cargarCitas(); }, [cargarCitas]);
  useEffect(() => { cargarIndicadores(); }, [cargarIndicadores]);

  // ==================== AUTH ====================
  const manejarAuth = async (e) => {
    e.preventDefault();
    if (modoRegistro && authForm.telefono && authForm.telefono.length !== 9) {
      return toast.warning('El teléfono debe tener exactamente 9 dígitos.');
    }
    if (!isEmail(authForm.email.trim())) {
      return toast.warning('Formato de correo inválido');
    }
    try {
      const endpoint = modoRegistro ? '/auth/registrar-empresa' : '/auth/login';
      const { data } = await api.post(endpoint, authForm);
      localStorage.setItem('token', data.token);
      localStorage.setItem('usuario', JSON.stringify(data.usuario));
      setTab(pestanaInicial(data.usuario));
      setUsuario(data.usuario);
      toast.success(`Bienvenido, ${data.usuario.nombre}`);
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'Error de autenticación.');
    }
  };

  const cerrarSesion = async () => {
    localStorage.clear();
    // Borra las respuestas de la API guardadas por el Service Worker (datos privados de la sesión)
    if ('caches' in window) {
      const claves = await caches.keys();
      await Promise.all(claves.filter((k) => k.startsWith('reservasaas-api')).map((k) => caches.delete(k)));
    }
    setCitas([]);
    setClientes([]);
    setEmpleados([]);
    setUsuario(null);
  };

  // ==================== CLIENTES (HU-01) ====================
  const validarCliente = () => {
    const e = {};
    if (!clienteForm.nombre.trim()) e.nombre = OBLIGATORIO;
    if (!clienteForm.documento) e.documento = OBLIGATORIO;
    else if (clienteForm.documento.length !== 8) e.documento = 'El documento (DNI) debe tener exactamente 8 dígitos.';
    if (!clienteForm.email.trim()) e.email = OBLIGATORIO;
    else if (!isEmail(clienteForm.email.trim())) e.email = 'Formato de correo inválido';
    if (clienteForm.telefono && clienteForm.telefono.length !== 9) e.telefono = 'El teléfono debe tener exactamente 9 dígitos.';
    return e;
  };

  const guardarCliente = async (e) => {
    e.preventDefault();
    const errores = validarCliente();
    setErroresCliente(errores);
    if (Object.keys(errores).length > 0) return;

    try {
      const { id, ...datos } = clienteForm;
      if (id) {
        await api.put(`/clientes/${id}`, datos);
        toast.success('Cliente actualizado.');
      } else {
        await api.post('/clientes', datos);
        toast.success('Cliente registrado con éxito.');
      }
      setClienteForm(CLIENTE_VACIO);
      cargarMaestros();
    } catch (error) {
      notificarError(error, 'Error al guardar cliente.');
    }
  };

  const eliminarCliente = async (cliente) => {
    const confirm = await Swal.fire({
      title: '¿Desactivar cliente?',
      text: `Se preservará el historial de citas de ${cliente.nombre}.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, desactivar',
      cancelButtonText: 'Cancelar'
    });
    if (!confirm.isConfirmed) return;
    try {
      await api.delete(`/clientes/${cliente._id}`);
      toast.success('Cliente desactivado.');
      cargarMaestros();
    } catch (error) {
      notificarError(error, 'Error al desactivar cliente.');
    }
  };

  // ==================== EMPLEADOS (HU-02) ====================
  const validarEmpleado = () => {
    const e = {};
    if (!empleadoForm.nombre.trim()) e.nombre = OBLIGATORIO;
    if (!empleadoForm.email.trim()) e.email = OBLIGATORIO;
    else if (!isEmail(empleadoForm.email.trim())) e.email = 'Formato de correo inválido';
    if (!empleadoForm.id) {
      if (!empleadoForm.password) e.password = OBLIGATORIO;
      else if (empleadoForm.password.length < 6) e.password = 'La contraseña debe tener al menos 6 caracteres.';
    }
    if (empleadoForm.telefono && empleadoForm.telefono.length !== 9) e.telefono = 'El teléfono debe tener exactamente 9 dígitos.';
    if (!empleadoForm.horarioInicio) e.horarioInicio = OBLIGATORIO;
    if (!empleadoForm.horarioFin) e.horarioFin = OBLIGATORIO;
    else if (empleadoForm.horarioFin <= empleadoForm.horarioInicio) e.horarioFin = 'El Horario Fin debe ser posterior al Horario Inicio.';
    return e;
  };

  const guardarEmpleado = async (e) => {
    e.preventDefault();
    const errores = validarEmpleado();
    setErroresEmpleado(errores);
    if (Object.keys(errores).length > 0) return;

    try {
      const { id, password, ...datos } = empleadoForm;
      if (id) {
        await api.put(`/empleados/${id}`, datos);
        toast.success('Empleado actualizado.');
      } else {
        await api.post('/empleados', { ...datos, password });
        toast.success('Empleado registrado.');
      }
      setEmpleadoForm(EMPLEADO_VACIO);
      cargarMaestros();
    } catch (error) {
      notificarError(error, 'Error al guardar empleado.');
    }
  };

  const alternarServicioEmpleado = (servicioId) => {
    setEmpleadoForm((prev) => ({
      ...prev,
      serviciosAsignados: prev.serviciosAsignados.includes(servicioId)
        ? prev.serviciosAsignados.filter((id) => id !== servicioId)
        : [...prev.serviciosAsignados, servicioId]
    }));
  };

  const eliminarEmpleado = async (emp) => {
    const confirm = await Swal.fire({
      title: '¿Desactivar empleado?',
      text: `¿Seguro que deseas desactivar a ${emp.nombre}?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, continuar',
      cancelButtonText: 'Cancelar'
    });
    if (!confirm.isConfirmed) return;

    try {
      await api.delete(`/empleados/${emp._id}`);
      toast.success('Empleado desactivado.');
      recargarTodo();
    } catch (error) {
      // HU-02 (escenario 3): advertencia por citas futuras y confirmación
      if (error.response?.status === 409) {
        const forzar = await Swal.fire({
          title: 'Citas futuras pendientes',
          text: error.response.data.mensaje,
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Confirmar desactivación',
          cancelButtonText: 'Cancelar'
        });
        if (forzar.isConfirmed) {
          try {
            await api.delete(`/empleados/${emp._id}?forzar=true`);
            toast.success('Empleado desactivado.');
            recargarTodo();
          } catch (err) {
            notificarError(err, 'Error al desactivar empleado.');
          }
        }
      } else {
        notificarError(error, 'Error al eliminar empleado.');
      }
    }
  };

  // ==================== SERVICIOS (HU-03) ====================
  const validarServicio = () => {
    const e = {};
    if (!servicioForm.nombre.trim()) e.nombre = OBLIGATORIO;
    if (servicioForm.duracionMinutos === '' || servicioForm.duracionMinutos === null) e.duracionMinutos = OBLIGATORIO;
    else if (!(Number(servicioForm.duracionMinutos) > 0)) e.duracionMinutos = 'La duración debe ser mayor a 0';
    if (servicioForm.precio === '' || servicioForm.precio === null) e.precio = OBLIGATORIO;
    else if (Number(servicioForm.precio) < 0) e.precio = 'El costo no puede ser negativo.';
    return e;
  };

  const guardarServicio = async (e) => {
    e.preventDefault();
    const errores = validarServicio();
    setErroresServicio(errores);
    if (Object.keys(errores).length > 0) return;

    try {
      const { id, ...datos } = servicioForm;
      const payload = { ...datos, duracionMinutos: Number(datos.duracionMinutos), precio: Number(datos.precio) };
      if (id) {
        await api.put(`/servicios/${id}`, payload);
        toast.success('Servicio actualizado. El nuevo costo aplica solo a las citas que se agenden desde ahora.');
      } else {
        await api.post('/servicios', payload);
        toast.success('Servicio registrado.');
      }
      setServicioForm(SERVICIO_VACIO);
      cargarMaestros();
    } catch (error) {
      notificarError(error, 'Error al guardar servicio.');
    }
  };

  const eliminarServicio = async (srv) => {
    const confirm = await Swal.fire({
      title: '¿Desactivar servicio?',
      text: `El servicio "${srv.nombre}" dejará de ofrecerse sin perder el historial.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, desactivar',
      cancelButtonText: 'Cancelar'
    });
    if (!confirm.isConfirmed) return;
    try {
      await api.delete(`/servicios/${srv._id}`);
      toast.success('Servicio desactivado.');
      cargarMaestros();
    } catch (error) {
      notificarError(error, 'Error al desactivar servicio.');
    }
  };

  // ==================== DISPONIBILIDAD (HU-07) ====================
  const buscarHorariosLibres = async (fecha = citaForm.fecha) => {
    if (!fecha) return toast.warning('Selecciona una fecha.');
    try {
      const { data } = await api.get('/citas/disponibilidad', {
        params: {
          fecha,
          profesionalId: citaForm.profesionalId || undefined,
          servicioId: citaForm.servicioId || undefined
        }
      });
      setDisponibilidad(data);
    } catch (error) {
      notificarError(error, 'No se pudo consultar la disponibilidad.');
    }
  };

  const consultarFechaSugerida = (fecha) => {
    setCitaForm((prev) => ({ ...prev, fecha }));
    buscarHorariosLibres(fecha);
  };

  // HU-05 (escenario 3): elegir uno de los horarios libres más cercanos
  const elegirSugerencia = async (mensaje, sugerencias) => {
    const { value, isConfirmed } = await Swal.fire({
      title: 'Horario no disponible',
      text: `${mensaje} Estos son los horarios libres más cercanos:`,
      icon: 'info',
      input: 'radio',
      inputOptions: Object.fromEntries(
        sugerencias.map((s) => [s.fechaISO, `${formatearFechaCorta(s.fecha)} · ${s.inicio} - ${s.fin}`])
      ),
      inputValidator: (v) => (!v ? 'Selecciona un horario.' : undefined),
      showCancelButton: true,
      confirmButtonText: 'Usar este horario',
      cancelButtonText: 'Cerrar'
    });
    return isConfirmed ? value : null;
  };

  // ==================== CREAR CITA (HU-04) ====================
  const validarCita = () => {
    const e = {};
    if (rol !== 'cliente' && !citaForm.clienteId) e.clienteId = OBLIGATORIO;
    if (!citaForm.servicioId) e.servicioId = OBLIGATORIO;
    if (!citaForm.profesionalId) e.profesionalId = OBLIGATORIO;
    if (!citaForm.fechaInicio) e.fechaInicio = OBLIGATORIO;
    else if (new Date(citaForm.fechaInicio) <= new Date()) e.fechaInicio = 'No puedes agendar una cita en una fecha u hora pasada.';
    return e;
  };

  const agendarCita = async (e) => {
    e.preventDefault();
    const errores = validarCita();
    setErroresCita(errores);
    if (Object.keys(errores).length > 0) return;

    try {
      const { fecha: _fecha, ...datos } = citaForm;
      const { data } = await api.post('/citas', { ...datos, fechaInicio: new Date(citaForm.fechaInicio).toISOString() });
      await Swal.fire({
        icon: 'success',
        title: 'Cita programada',
        html: `Estado: <b>programada</b><br/>${escaparHTML(formatearFechaHora(data.cita.fechaInicio))} - ${escaparHTML(formatearHora(data.cita.fechaFin))}`,
        timer: 3500
      });
      toast.success('Cita programada correctamente.');
      setCitaForm((prev) => ({ ...prev, fechaInicio: '', notas: '' }));
      setDisponibilidad(null);
      cargarCitas();
      cargarIndicadores();
    } catch (error) {
      const data = error.response?.data;
      if (error.response?.status === 409 && data?.sugerencias?.length) {
        const elegido = await elegirSugerencia(data.mensaje, data.sugerencias);
        if (elegido) {
          setCitaForm((prev) => ({ ...prev, fechaInicio: fechaHoraLocalInput(new Date(elegido)) }));
          toast.info('Horario sugerido seleccionado. Presiona "Confirmar Reserva".');
        }
      } else {
        notificarError(error, 'No se pudo agendar la cita.');
      }
    }
  };

  // ==================== ESTADOS (HU-06 & HU-10) ====================
  const cancelarCita = async (cita) => {
    const { value: motivo, isConfirmed } = await Swal.fire({
      title: 'Cancelar cita',
      input: 'text',
      inputLabel: 'Motivo de la cancelación',
      inputPlaceholder: 'Ej. Solicitud del cliente',
      inputValidator: (v) => (!v || !v.trim() ? 'Debes indicar el motivo de la cancelación.' : undefined),
      showCancelButton: true,
      confirmButtonText: 'Cancelar cita',
      cancelButtonText: 'Volver'
    });
    if (!isConfirmed) return;

    const enviar = (extra = {}) => api.patch(`/citas/${cita._id}/estado`, { estado: 'cancelada', motivoCancelacion: motivo, ...extra });
    try {
      await enviar();
    } catch (err) {
      // HU-06 (escenario 3): advertencia por cancelación fuera de plazo
      if (err.response?.status === 409 && err.response.data?.requiereConfirmacion) {
        const confPlazo = await Swal.fire({
          title: 'Cancelación fuera de plazo',
          text: err.response.data.mensaje,
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Confirmar de todas formas',
          cancelButtonText: 'Volver'
        });
        if (!confPlazo.isConfirmed) return;
        try {
          await enviar({ confirmarFueraDePlazo: true });
        } catch (err2) {
          return notificarError(err2, 'Error al cancelar.');
        }
      } else {
        return notificarError(err, 'Error al cancelar.');
      }
    }
    toast.success('Cita cancelada y horario liberado.');
    cargarCitas();
    cargarIndicadores();
  };

  const cambiarEstado = async (cita, nuevoEstado) => {
    if (nuevoEstado === 'cancelada') return cancelarCita(cita);
    try {
      await api.patch(`/citas/${cita._id}/estado`, { estado: nuevoEstado });
      toast.success(`Cita marcada como "${ETIQUETA_ESTADO[nuevoEstado]}".`);
      cargarCitas();
      cargarIndicadores();
    } catch (error) {
      notificarError(error, 'Transición de estado no permitida.');
    }
  };

  // ==================== REPROGRAMAR (HU-05) ====================
  const ejecutarReprogramacion = async (cita, payload) => {
    try {
      await api.put(`/citas/${cita._id}/reprogramar`, payload);
      toast.success('Cita reprogramada con éxito.');
      cargarCitas();
      return true;
    } catch (error) {
      const data = error.response?.data;
      if (error.response?.status === 409 && data?.sugerencias?.length) {
        const elegido = await elegirSugerencia(data.mensaje, data.sugerencias);
        if (elegido) return ejecutarReprogramacion(cita, { ...payload, fechaInicio: elegido });
        return false;
      }
      notificarError(error, 'No se pudo reprogramar la cita.');
      return false;
    }
  };

  const reprogramarCitaModal = async (cita) => {
    const servicioId = cita.servicioId?._id;
    const opcionesEmpleado = profesionales
      .filter((p) => atiendeServicio(p, servicioId))
      .map((p) => `<option value="${p._id}" ${String(p._id) === String(cita.profesionalId?._id) ? 'selected' : ''}>${escaparHTML(p.nombre)} (${escaparHTML(p.horarioInicio)}-${escaparHTML(p.horarioFin)})</option>`)
      .join('');

    const { value, isConfirmed } = await Swal.fire({
      title: 'Reprogramar Cita',
      html: `
        <label class="swal-label">Nueva fecha y hora</label>
        <input id="swal-fecha" type="datetime-local" min="${fechaHoraLocalInput()}" class="swal2-input" value="${fechaHoraLocalInput(cita.fechaInicio)}">
        <label class="swal-label">Empleado (solo quienes ofrecen ${escaparHTML(cita.servicioId?.nombre || 'el servicio')})</label>
        <select id="swal-empleado" class="swal2-select">${opcionesEmpleado}</select>`,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Guardar cambio',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const fecha = document.getElementById('swal-fecha').value;
        const profesionalId = document.getElementById('swal-empleado').value;
        if (!fecha || new Date(fecha) <= new Date()) {
          Swal.showValidationMessage('Selecciona una fecha y hora futura.');
          return false;
        }
        return { fechaInicio: new Date(fecha).toISOString(), profesionalId };
      }
    });
    if (!isConfirmed || !value) return;
    await ejecutarReprogramacion(cita, value);
  };

  // HU-08 (escenario 4): detalle rápido de la cita
  const verDetalleCita = (cita) => {
    const historial = (cita.historialCambios || [])
      .map((h) => `<li><b>${escaparHTML(h.accion)}</b> · ${escaparHTML(formatearFechaHora(h.fecha))}<br/><small>${escaparHTML(h.detalle)}</small></li>`)
      .join('');
    Swal.fire({
      title: 'Detalle de la cita',
      html: `
        <div class="swal-detalle">
          <p><b>Cliente:</b> ${escaparHTML(cita.clienteId?.nombre || '-')} ${cita.clienteId?.documento ? `(DNI ${escaparHTML(cita.clienteId.documento)})` : ''}</p>
          <p><b>Servicio:</b> ${escaparHTML(cita.servicioId?.nombre || '-')} · S/ ${escaparHTML(cita.costoRegistrado)}</p>
          <p><b>Empleado:</b> ${escaparHTML(cita.profesionalId?.nombre || '-')}</p>
          <p><b>Horario:</b> ${escaparHTML(formatearFechaHora(cita.fechaInicio))} - ${escaparHTML(formatearHora(cita.fechaFin))}</p>
          <p><b>Estado:</b> ${escaparHTML(ETIQUETA_ESTADO[cita.estado])}</p>
          ${cita.motivoCancelacion ? `<p><b>Motivo de cancelación:</b> ${escaparHTML(cita.motivoCancelacion)}</p>` : ''}
          ${cita.notas ? `<p><b>Notas:</b> ${escaparHTML(cita.notas)}</p>` : ''}
          ${historial ? `<p><b>Historial:</b></p><ul>${historial}</ul>` : ''}
        </div>`,
      confirmButtonText: 'Cerrar'
    });
  };

  // Acciones disponibles según rol y estado (HU-10, HU-11)
  const accionesCita = (cita) => {
    const activa = ESTADOS_ACTIVOS.includes(cita.estado);
    const yaInicio = new Date(cita.fechaInicio) <= new Date();
    return {
      confirmar: cita.estado === 'programada',
      completar: activa && rol !== 'cliente',
      noAsistio: activa && yaInicio && rol !== 'cliente',
      reprogramar: activa && esGestion && !yaInicio,
      cancelar: activa && (esGestion || rol === 'cliente')
    };
  };

  const actualizarFiltroFecha = (campo, valor) => {
    const siguiente = { ...filtros, [campo]: valor };
    if (siguiente.fechaDesde && siguiente.fechaHasta && siguiente.fechaHasta < siguiente.fechaDesde) {
      toast.warning('La fecha "Hasta" no puede ser anterior a la fecha "Desde".');
      return;
    }
    setFiltros(siguiente);
  };

  const profesionalesParaServicio = profesionales.filter((p) => atiendeServicio(p, citaForm.servicioId));

  // ==================== PANTALLA LOGIN / REGISTRO SAAS ====================
  if (!usuario) {
    return (
      <div className="auth-wrapper">
        <ToastContainer position="top-right" autoClose={3500} />
        <div className="card auth-box">
          <h2 style={{ marginBottom: 4 }}>
            {modoRegistro ? 'Registrar Nueva Empresa (SaaS)' : 'Iniciar Sesión'}
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: 16 }}>
            Sistema Web Progresivo de Reservas Multi-Empresa
          </p>

          <form onSubmit={manejarAuth}>
            {modoRegistro && (
              <>
                <div className="form-group">
                  <label>Nombre de la Organización *</label>
                  <input required placeholder="Ej. Clínica Sonrisa" value={authForm.nombreEmpresa}
                    onChange={(e) => setAuthForm({ ...authForm, nombreEmpresa: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Rubro</label>
                  <input placeholder="Ej. Odontología, Spa, Consultoría" value={authForm.rubro}
                    onChange={(e) => setAuthForm({ ...authForm, rubro: soloLetras(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Nombre del Administrador * (Solo letras)</label>
                  <input required placeholder="Tu nombre completo" value={authForm.nombreAdmin}
                    onChange={(e) => setAuthForm({ ...authForm, nombreAdmin: soloLetras(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Teléfono (9 dígitos)</label>
                  <input type="tel" maxLength={9} placeholder="999888777" value={authForm.telefono}
                    onChange={(e) => setAuthForm({ ...authForm, telefono: solo9Digitos(e.target.value) })} />
                </div>
              </>
            )}

            <div className="form-group">
              <label>Correo Electrónico *</label>
              <input type="email" required placeholder="admin@empresa.com" value={authForm.email}
                onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} />
            </div>

            <div className="form-group">
              <label>Contraseña *</label>
              <input type="password" required minLength={6} placeholder="Mínimo 6 caracteres" value={authForm.password}
                onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 8 }}>
              {modoRegistro ? 'Crear Cuenta Empresarial' : 'Ingresar al Sistema'}
            </button>
          </form>

          <button type="button" className="btn btn-outline" style={{ width: '100%', marginTop: 10 }}
            onClick={() => setModoRegistro(!modoRegistro)}>
            {modoRegistro ? '¿Ya tienes cuenta? Inicia sesión' : '¿Nueva empresa? Regístrate gratis'}
          </button>
          {!modoRegistro && (
            <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: 10 }}>
              Clientes: usen el correo registrado por la recepción y su DNI como contraseña inicial.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ==================== DASHBOARD PRINCIPAL ====================
  return (
    <div>
      <ToastContainer position="top-right" autoClose={3500} />

      {!isOnline && (
        <div className="offline-banner">
          Modo Sin Conexión (Offline) — Visualizando información almacenada en caché local por el Service Worker.
        </div>
      )}

      <header className="navbar">
        <div>
          <strong>{usuario.empresa || 'ReservaSaaS'}</strong>
          <span style={{ marginLeft: 10, fontSize: '0.85rem', opacity: 0.9 }}>
            {usuario.nombre} ({usuario.rol.toUpperCase()})
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {deferredPrompt && (
            <button className="btn btn-success btn-sm" onClick={instalarPWA}>
              Instalar App (PWA)
            </button>
          )}
          <button className="btn btn-outline btn-sm" style={{ color: '#fff', borderColor: '#fff' }} onClick={cerrarSesion}>
            Cerrar Sesión
          </button>
        </div>
      </header>

      {/* HU-11: la interfaz oculta los módulos no autorizados para el rol */}
      <nav className="nav-tabs">
        {esGestion && (
          <button className={`tab-btn ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}>
            Indicadores (HU-13)
          </button>
        )}
        <button className={`tab-btn ${tab === 'agenda' ? 'active' : ''}`} onClick={() => setTab('agenda')}>
          Agenda y Citas (HU-04 a HU-10, HU-12)
        </button>
        {esGestion && (
          <button className={`tab-btn ${tab === 'clientes' ? 'active' : ''}`} onClick={() => setTab('clientes')}>
            Clientes (HU-01)
          </button>
        )}
        {esAdmin && (
          <>
            <button className={`tab-btn ${tab === 'empleados' ? 'active' : ''}`} onClick={() => setTab('empleados')}>
              Empleados (HU-02)
            </button>
            <button className={`tab-btn ${tab === 'servicios' ? 'active' : ''}`} onClick={() => setTab('servicios')}>
              Servicios (HU-03)
            </button>
          </>
        )}
      </nav>

      <main className="container">
        {/* ==================== TAB: DASHBOARD (HU-13) ==================== */}
        {tab === 'dashboard' && esGestion && (
          <div>
            <div className="card" style={{ marginBottom: 20 }}>
              <h3>Indicadores de Gestión (Aislados por Organización)</h3>
              <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <label style={{ fontSize: '0.8rem' }}>Desde</label>
                  <input
                    type="date"
                    value={rangoKpi.fechaDesde}
                    max={rangoKpi.fechaHasta || undefined}
                    onChange={(e) => {
                      const nuevaDesde = e.target.value;
                      if (rangoKpi.fechaHasta && nuevaDesde && nuevaDesde > rangoKpi.fechaHasta) {
                        toast.warning('La fecha "Hasta" no puede ser anterior a la fecha "Desde".');
                        return;
                      }
                      setRangoKpi((prev) => ({ ...prev, fechaDesde: nuevaDesde }));
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem' }}>Hasta</label>
                  <input
                    type="date"
                    value={rangoKpi.fechaHasta}
                    min={rangoKpi.fechaDesde || undefined}
                    onChange={(e) => {
                      const nuevaHasta = e.target.value;
                      if (rangoKpi.fechaDesde && nuevaHasta && nuevaHasta < rangoKpi.fechaDesde) {
                        toast.warning('La fecha "Hasta" no puede ser anterior a la fecha "Desde".');
                        return;
                      }
                      setRangoKpi((prev) => ({ ...prev, fechaHasta: nuevaHasta }));
                    }}
                  />
                </div>
                <button className="btn btn-outline btn-sm" onClick={() => setRangoKpi(rangoMesActual())}>
                  Mes en curso
                </button>
              </div>
            </div>

            {indicadores.totalCitas === 0 && (
              <div className="info-banner">
                Aún no hay citas registradas en este periodo. Registra citas desde la pestaña “Agenda y Citas” para ver tus indicadores.
              </div>
            )}

            <div className="grid-4">
              <div className="kpi-card">
                <div className="kpi-value">{indicadores.totalCitas}</div>
                <div className="kpi-label">Total Citas Registradas</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-value">{indicadores.citasActivas}</div>
                <div className="kpi-label">Citas Programadas / Confirmadas</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-value">{indicadores.citasCompletadas}</div>
                <div className="kpi-label">Citas Completadas</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-value">{indicadores.citasCanceladas}</div>
                <div className="kpi-label">Citas Canceladas</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-value">{indicadores.citasNoAsistio}</div>
                <div className="kpi-label">Inasistencias (No asistió)</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-value">S/ {indicadores.ingresosEstimados}</div>
                <div className="kpi-label">Ingresos Proyectados</div>
              </div>
            </div>

            <div className="grid-2">
              <div className="card">
                <h4>Servicios Más Solicitados</h4>
                {indicadores.topServicios.length === 0 ? (
                  <p style={{ color: 'var(--muted)', marginTop: 8 }}>Aún no hay citas registradas en este periodo.</p>
                ) : (
                  <table>
                    <thead><tr><th>#</th><th>Servicio</th><th>Reservas</th></tr></thead>
                    <tbody>
                      {indicadores.topServicios.map((s, i) => (
                        <tr key={s.nombre}><td>{i + 1}</td><td>{s.nombre}</td><td><strong>{s.cantidad}</strong></td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="card">
                <h4>Clientes Frecuentes</h4>
                {indicadores.topClientes.length === 0 ? (
                  <p style={{ color: 'var(--muted)', marginTop: 8 }}>Sin datos suficientes aún.</p>
                ) : (
                  <table>
                    <thead><tr><th>Cliente</th><th>Citas</th><th>Inasistencias</th></tr></thead>
                    <tbody>
                      {indicadores.topClientes.map((c, i) => (
                        <tr key={`${c.nombre}-${i}`}>
                          <td>{c.nombre}</td><td><strong>{c.cantidad}</strong></td><td>{c.inasistencias}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB: AGENDA Y CITAS (HU-04 a HU-10, HU-12) ==================== */}
        {tab === 'agenda' && (
          <div className={puedeAgendar ? 'grid-agenda' : ''}>
            {puedeAgendar && (
              <div className="card">
                <h3>Nueva Reserva de Cita (HU-04 & HU-07)</h3>
                <form onSubmit={agendarCita} noValidate style={{ marginTop: 12 }}>
                  {rol !== 'cliente' && (
                    <div className="form-group">
                      <label>Cliente *</label>
                      <select className={claseCampo(erroresCita, 'clienteId')} value={citaForm.clienteId}
                        onChange={(e) => setCitaForm({ ...citaForm, clienteId: e.target.value })}>
                        <option value="">-- Seleccionar cliente --</option>
                        {clientes.map((c) => <option key={c._id} value={c._id}>{c.nombre} ({c.documento})</option>)}
                      </select>
                      <CampoError mensaje={erroresCita.clienteId} />
                    </div>
                  )}

                  <div className="form-group">
                    <label>Servicio *</label>
                    <select className={claseCampo(erroresCita, 'servicioId')} value={citaForm.servicioId}
                      onChange={(e) => {
                        const servicioId = e.target.value;
                        setCitaForm((prev) => {
                          const prof = profesionales.find((p) => p._id === prev.profesionalId);
                          const sigueValido = !prof || atiendeServicio(prof, servicioId);
                          return { ...prev, servicioId, profesionalId: sigueValido ? prev.profesionalId : '' };
                        });
                        setDisponibilidad(null);
                      }}>
                      <option value="">-- Seleccionar servicio --</option>
                      {servicios.map((s) => (
                        <option key={s._id} value={s._id}>{s.nombre} ({s.duracionMinutos} min - S/ {s.precio})</option>
                      ))}
                    </select>
                    <CampoError mensaje={erroresCita.servicioId} />
                  </div>

                  <div className="form-group">
                    <label>Empleado / Especialista *</label>
                    <select className={claseCampo(erroresCita, 'profesionalId')} value={citaForm.profesionalId}
                      onChange={(e) => { setCitaForm({ ...citaForm, profesionalId: e.target.value }); setDisponibilidad(null); }}>
                      <option value="">-- Cualquier empleado calificado --</option>
                      {profesionalesParaServicio.map((emp) => (
                        <option key={emp._id} value={emp._id}>
                          {emp.nombre} ({emp.especialidad || 'General'} | {emp.horarioInicio}-{emp.horarioFin})
                        </option>
                      ))}
                    </select>
                    <CampoError mensaje={erroresCita.profesionalId} />
                  </div>

                  <div className="form-group">
                    <label>Fecha para consultar disponibilidad</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="date" min={hoyYMD} value={citaForm.fecha}
                        onChange={(e) => { setCitaForm({ ...citaForm, fecha: e.target.value }); setDisponibilidad(null); }} />
                      <button type="button" className="btn btn-outline" onClick={() => buscarHorariosLibres()}>
                        Ver libres
                      </button>
                    </div>
                  </div>

                  {disponibilidad && (
                    <div className="form-group">
                      <label>Horarios Libres Disponibles ({formatearFechaCorta(citaForm.fecha)}):</label>
                      {disponibilidad.length === 0 && (
                        <p className="texto-alerta">No hay empleados calificados para el servicio seleccionado.</p>
                      )}
                      {disponibilidad.map((d) => (
                        <div key={d.profesionalId} style={{ marginBottom: 8 }}>
                          <small><strong>{d.profesional}</strong>{d.especialidad ? ` · ${d.especialidad}` : ''}</small>
                          {d.slots.length === 0 ? (
                            <div>
                              <p className="texto-alerta">Sin horarios disponibles</p>
                              {d.fechasSugeridas?.length > 0 && (
                                <div className="slot-grid">
                                  <small style={{ width: '100%' }}>Fechas cercanas con disponibilidad:</small>
                                  {d.fechasSugeridas.map((f) => (
                                    <button type="button" key={f.fecha} className="slot-chip"
                                      onClick={() => consultarFechaSugerida(f.fecha)}>
                                      {formatearFechaCorta(f.fecha)} (desde {f.primerHorario})
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="slot-grid">
                              {d.slots.map((slot) => {
                                const valor = fechaHoraLocalInput(new Date(slot.fechaISO));
                                const seleccionado = citaForm.fechaInicio === valor && citaForm.profesionalId === d.profesionalId;
                                return (
                                  <button type="button" key={slot.fechaISO}
                                    className={`slot-chip ${seleccionado ? 'selected' : ''}`}
                                    onClick={() => setCitaForm({ ...citaForm, profesionalId: d.profesionalId, fechaInicio: valor })}>
                                    {slot.inicio} - {slot.fin}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="form-group">
                    <label>Fecha y Hora de Inicio *</label>
                    <input type="datetime-local" className={claseCampo(erroresCita, 'fechaInicio')}
                      min={fechaHoraLocalInput()} value={citaForm.fechaInicio}
                      onChange={(e) => setCitaForm({ ...citaForm, fechaInicio: e.target.value })} />
                    <CampoError mensaje={erroresCita.fechaInicio} />
                  </div>

                  <div className="form-group">
                    <label>Notas</label>
                    <input placeholder="Observaciones opcionales" value={citaForm.notas}
                      onChange={(e) => setCitaForm({ ...citaForm, notas: e.target.value })} />
                  </div>

                  <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                    Confirmar Reserva
                  </button>
                </form>
              </div>
            )}

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <h3>Agenda de Citas ({citas.length})</h3>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className={`btn btn-sm ${vistaAgenda === 'calendario' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setVistaAgenda('calendario')}>Calendario</button>
                  <button className={`btn btn-sm ${vistaAgenda === 'lista' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setVistaAgenda('lista')}>Lista</button>
                </div>
              </div>

              {/* HU-12: búsqueda y filtros combinables */}
              <div className="filtros-grid">
                <input placeholder="Buscar por cliente (nombre o DNI)..." value={filtros.buscarCliente}
                  onChange={(e) => setFiltros({ ...filtros, buscarCliente: e.target.value.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñÜü\s\d]/g, '') })} />
                <select value={filtros.estado}
                  onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}>
                  <option value="">Todos los estados</option>
                  {Object.entries(ETIQUETA_ESTADO).map(([valor, etiqueta]) => (
                    <option key={valor} value={valor}>{etiqueta}</option>
                  ))}
                </select>
                {esGestion && (
                  <select value={filtros.profesionalId}
                    onChange={(e) => setFiltros({ ...filtros, profesionalId: e.target.value })}>
                    <option value="">Todos los empleados</option>
                    {profesionales.map((p) => <option key={p._id} value={p._id}>{p.nombre}</option>)}
                  </select>
                )}
                <select value={filtros.servicioId}
                  onChange={(e) => setFiltros({ ...filtros, servicioId: e.target.value })}>
                  <option value="">Todos los servicios</option>
                  {servicios.map((s) => <option key={s._id} value={s._id}>{s.nombre}</option>)}
                </select>
                <label className="filtro-fecha">Desde
                  <input type="date" value={filtros.fechaDesde} max={filtros.fechaHasta || undefined}
                    onChange={(e) => actualizarFiltroFecha('fechaDesde', e.target.value)} />
                </label>
                <label className="filtro-fecha">Hasta
                  <input type="date" value={filtros.fechaHasta} min={filtros.fechaDesde || undefined}
                    onChange={(e) => actualizarFiltroFecha('fechaHasta', e.target.value)} />
                </label>
              </div>
              {Object.values(filtros).some(Boolean) && (
                <button className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => setFiltros(FILTROS_VACIOS)}>
                  Limpiar filtros
                </button>
              )}

              {citas.length === 0 && (
                <p className="texto-vacio">No se encontraron citas con los criterios seleccionados.</p>
              )}

              {vistaAgenda === 'calendario' && (
                <Suspense fallback={<p className="texto-vacio">Cargando calendario...</p>}>
                  <AgendaCalendario
                    citas={citas}
                    puedeReprogramar={esGestion}
                    onReprogramar={ejecutarReprogramacion}
                    onVerDetalle={verDetalleCita}
                  />
                </Suspense>
              )}

              {vistaAgenda === 'lista' && citas.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {citas.map((cita) => {
                    const acciones = accionesCita(cita);
                    return (
                      <div key={cita._id} className="cita-item">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <strong>{cita.clienteId?.nombre || 'Cliente'}</strong>
                          <span className={`badge badge-${cita.estado}`}>{ETIQUETA_ESTADO[cita.estado]}</span>
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '4px 0' }}>
                          {cita.servicioId?.nombre} con <strong>{cita.profesionalId?.nombre}</strong>
                          <br />
                          {formatearFechaHora(cita.fechaInicio)} - {formatearHora(cita.fechaFin)}
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                          <button className="btn btn-outline btn-sm" onClick={() => verDetalleCita(cita)}>Detalle</button>
                          {acciones.confirmar && (
                            <button className="btn btn-success btn-sm" onClick={() => cambiarEstado(cita, 'confirmada')}>Confirmar</button>
                          )}
                          {acciones.completar && (
                            <button className="btn btn-primary btn-sm" onClick={() => cambiarEstado(cita, 'completada')}>Completar</button>
                          )}
                          {acciones.noAsistio && (
                            <button className="btn btn-warning btn-sm" onClick={() => cambiarEstado(cita, 'no_asistio')}>No asistió</button>
                          )}
                          {acciones.reprogramar && (
                            <button className="btn btn-outline btn-sm" onClick={() => reprogramarCitaModal(cita)}>Reprogramar</button>
                          )}
                          {acciones.cancelar && (
                            <button className="btn btn-danger btn-sm" onClick={() => cambiarEstado(cita, 'cancelada')}>Cancelar</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================== TAB: CLIENTES (HU-01) ==================== */}
        {tab === 'clientes' && esGestion && (
          <div className="grid-2">
            <div className="card">
              <h3>{clienteForm.id ? 'Editar Cliente' : 'Registrar Cliente'}</h3>
              <form onSubmit={guardarCliente} noValidate style={{ marginTop: 12 }}>
                <div className="form-group">
                  <label>Nombre Completo * (Solo letras)</label>
                  <input className={claseCampo(erroresCliente, 'nombre')} placeholder="Ej. Ana Maria Torres" value={clienteForm.nombre}
                    onChange={(e) => setClienteForm({ ...clienteForm, nombre: soloLetras(e.target.value) })} />
                  <CampoError mensaje={erroresCliente.nombre} />
                </div>
                <div className="form-group">
                  <label>Documento de Identidad (8 dígitos DNI) *</label>
                  <input className={claseCampo(erroresCliente, 'documento')} maxLength={8} placeholder="12345678" value={clienteForm.documento}
                    onChange={(e) => setClienteForm({ ...clienteForm, documento: solo8Digitos(e.target.value) })} />
                  <CampoError mensaje={erroresCliente.documento} />
                </div>
                <div className="form-group">
                  <label>Correo Electrónico *</label>
                  <input className={claseCampo(erroresCliente, 'email')} placeholder="cliente@correo.com" value={clienteForm.email}
                    onChange={(e) => setClienteForm({ ...clienteForm, email: e.target.value })} />
                  <CampoError mensaje={erroresCliente.email} />
                </div>
                <div className="form-group">
                  <label>Teléfono (9 dígitos)</label>
                  <input type="tel" className={claseCampo(erroresCliente, 'telefono')} maxLength={9} placeholder="999888777" value={clienteForm.telefono}
                    onChange={(e) => setClienteForm({ ...clienteForm, telefono: solo9Digitos(e.target.value) })} />
                  <CampoError mensaje={erroresCliente.telefono} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-primary">
                    {clienteForm.id ? 'Actualizar' : 'Guardar'}
                  </button>
                  {clienteForm.id && (
                    <button type="button" className="btn btn-outline"
                      onClick={() => { setClienteForm(CLIENTE_VACIO); setErroresCliente({}); }}>
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            </div>

            <div className="card">
              <h3>Directorio de Clientes ({clientes.length})</h3>
              <div className="tabla-scroll">
                <table>
                  <thead>
                    <tr><th>Nombre</th><th>Documento</th><th>Contacto</th><th>Acciones</th></tr>
                  </thead>
                  <tbody>
                    {clientes.map((c) => (
                      <tr key={c._id}>
                        <td>{c.nombre}</td>
                        <td>{c.documento}</td>
                        <td>
                          <div style={{ fontSize: '0.85rem' }}>{c.email}</div>
                          <small style={{ color: 'var(--muted)' }}>{c.telefono}</small>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-outline btn-sm" onClick={() => {
                              setErroresCliente({});
                              setClienteForm({
                                id: c._id, nombre: c.nombre || '', documento: c.documento || '', email: c.email || '', telefono: c.telefono || ''
                              });
                            }}>Editar</button>
                            <button className="btn btn-danger btn-sm" onClick={() => eliminarCliente(c)}>Eliminar</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB: EMPLEADOS (HU-02) ==================== */}
        {tab === 'empleados' && esAdmin && (
          <div className="grid-2">
            <div className="card">
              <h3>{empleadoForm.id ? 'Editar Empleado' : 'Registrar Empleado / Profesional'}</h3>
              <form onSubmit={guardarEmpleado} noValidate style={{ marginTop: 12 }}>
                <div className="form-group">
                  <label>Nombre Completo * (Solo letras)</label>
                  <input className={claseCampo(erroresEmpleado, 'nombre')} placeholder="Ej. Carlos Mendoza" value={empleadoForm.nombre}
                    onChange={(e) => setEmpleadoForm({ ...empleadoForm, nombre: soloLetras(e.target.value) })} />
                  <CampoError mensaje={erroresEmpleado.nombre} />
                </div>
                <div className="form-group">
                  <label>Correo *</label>
                  <input className={claseCampo(erroresEmpleado, 'email')} value={empleadoForm.email}
                    onChange={(e) => setEmpleadoForm({ ...empleadoForm, email: e.target.value })} />
                  <CampoError mensaje={erroresEmpleado.email} />
                </div>
                {!empleadoForm.id && (
                  <div className="form-group">
                    <label>Contraseña *</label>
                    <input type="password" className={claseCampo(erroresEmpleado, 'password')} value={empleadoForm.password}
                      onChange={(e) => setEmpleadoForm({ ...empleadoForm, password: e.target.value })} />
                    <CampoError mensaje={erroresEmpleado.password} />
                  </div>
                )}
                <div className="form-group">
                  <label>Teléfono (9 dígitos)</label>
                  <input type="tel" className={claseCampo(erroresEmpleado, 'telefono')} maxLength={9} placeholder="999888777" value={empleadoForm.telefono}
                    onChange={(e) => setEmpleadoForm({ ...empleadoForm, telefono: solo9Digitos(e.target.value) })} />
                  <CampoError mensaje={erroresEmpleado.telefono} />
                </div>
                <div className="form-group">
                  <label>Rol *</label>
                  <select value={empleadoForm.rol}
                    onChange={(e) => setEmpleadoForm({ ...empleadoForm, rol: e.target.value })}>
                    <option value="profesional">Profesional / Especialista</option>
                    <option value="recepcionista">Recepcionista</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Especialidad (Solo letras)</label>
                  <input placeholder="Ej. Ortodoncia, Estética" value={empleadoForm.especialidad}
                    onChange={(e) => setEmpleadoForm({ ...empleadoForm, especialidad: soloLetras(e.target.value) })} />
                </div>
                {empleadoForm.rol === 'profesional' && (
                  <div className="form-group">
                    <label>Servicios que atiende</label>
                    {servicios.length === 0 ? (
                      <small style={{ color: 'var(--muted)' }}>Primero registra servicios en la pestaña Servicios.</small>
                    ) : (
                      <div className="checkbox-list">
                        {servicios.map((s) => (
                          <label key={s._id}>
                            <input type="checkbox" checked={empleadoForm.serviciosAsignados.includes(s._id)}
                              onChange={() => alternarServicioEmpleado(s._id)} />
                            {s.nombre}
                          </label>
                        ))}
                      </div>
                    )}
                    <small style={{ color: 'var(--muted)' }}>Si no marcas ninguno, podrá atender todos los servicios.</small>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label>Horario Inicio *</label>
                    <input type="time" className={claseCampo(erroresEmpleado, 'horarioInicio')} value={empleadoForm.horarioInicio}
                      onChange={(e) => setEmpleadoForm({ ...empleadoForm, horarioInicio: e.target.value })} />
                    <CampoError mensaje={erroresEmpleado.horarioInicio} />
                  </div>
                  <div className="form-group">
                    <label>Horario Fin *</label>
                    <input type="time" className={claseCampo(erroresEmpleado, 'horarioFin')} value={empleadoForm.horarioFin}
                      min={empleadoForm.horarioInicio || undefined}
                      onChange={(e) => setEmpleadoForm({ ...empleadoForm, horarioFin: e.target.value })} />
                    <CampoError mensaje={erroresEmpleado.horarioFin} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-primary">
                    {empleadoForm.id ? 'Actualizar' : 'Guardar Empleado'}
                  </button>
                  {empleadoForm.id && (
                    <button type="button" className="btn btn-outline"
                      onClick={() => { setEmpleadoForm(EMPLEADO_VACIO); setErroresEmpleado({}); }}>
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h3>Personal ({empleados.length})</h3>
                <input style={{ maxWidth: 200 }} placeholder="Filtrar especialidad..." value={filtroEspecialidad}
                  onChange={(e) => setFiltroEspecialidad(soloLetras(e.target.value))} />
              </div>
              <div className="tabla-scroll">
                <table>
                  <thead>
                    <tr><th>Nombre</th><th>Rol / Especialidad</th><th>Servicios</th><th>Jornada</th><th>Acciones</th></tr>
                  </thead>
                  <tbody>
                    {empleados
                      .filter((emp) => !filtroEspecialidad || (emp.especialidad || '').toLowerCase().includes(filtroEspecialidad.toLowerCase()))
                      .map((emp) => (
                        <tr key={emp._id}>
                          <td>
                            <strong>{emp.nombre}</strong>
                            <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{emp.email}</div>
                          </td>
                          <td>
                            <span className="badge badge-confirmada">{emp.rol}</span>
                            <div style={{ fontSize: '0.8rem' }}>{emp.especialidad || '-'}</div>
                          </td>
                          <td style={{ fontSize: '0.8rem' }}>
                            {emp.rol !== 'profesional'
                              ? '-'
                              : emp.serviciosAsignados?.length
                                ? emp.serviciosAsignados.map((s) => s.nombre).join(', ')
                                : 'Todos'}
                          </td>
                          <td>{emp.horarioInicio} - {emp.horarioFin}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn btn-outline btn-sm" onClick={() => {
                                setErroresEmpleado({});
                                setEmpleadoForm({
                                  id: emp._id, nombre: emp.nombre, email: emp.email, password: '',
                                  telefono: emp.telefono || '', rol: emp.rol, especialidad: emp.especialidad || '',
                                  serviciosAsignados: (emp.serviciosAsignados || []).map((s) => s._id || s),
                                  horarioInicio: emp.horarioInicio || '08:00', horarioFin: emp.horarioFin || '18:00'
                                });
                              }}>Editar</button>
                              {emp._id !== usuario.id && (
                                <button className="btn btn-danger btn-sm" onClick={() => eliminarEmpleado(emp)}>Eliminar</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB: SERVICIOS (HU-03) ==================== */}
        {tab === 'servicios' && esAdmin && (
          <div className="grid-2">
            <div className="card">
              <h3>{servicioForm.id ? 'Editar Servicio' : 'Nuevo Servicio'}</h3>
              <form onSubmit={guardarServicio} noValidate style={{ marginTop: 12 }}>
                <div className="form-group">
                  <label>Nombre del Servicio *</label>
                  <input className={claseCampo(erroresServicio, 'nombre')} placeholder="Ej. Consulta General" value={servicioForm.nombre}
                    onChange={(e) => setServicioForm({ ...servicioForm, nombre: e.target.value })} />
                  <CampoError mensaje={erroresServicio.nombre} />
                </div>
                <div className="form-group">
                  <label>Descripción</label>
                  <input placeholder="Detalle breve" value={servicioForm.descripcion}
                    onChange={(e) => setServicioForm({ ...servicioForm, descripcion: e.target.value })} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label>Duración (minutos) *</label>
                    <input type="number" className={claseCampo(erroresServicio, 'duracionMinutos')} value={servicioForm.duracionMinutos}
                      onChange={(e) => setServicioForm({ ...servicioForm, duracionMinutos: e.target.value })} />
                    <CampoError mensaje={erroresServicio.duracionMinutos} />
                  </div>
                  <div className="form-group">
                    <label>Costo (S/) *</label>
                    <input type="number" step="0.01" className={claseCampo(erroresServicio, 'precio')} value={servicioForm.precio}
                      onChange={(e) => setServicioForm({ ...servicioForm, precio: e.target.value })} />
                    <CampoError mensaje={erroresServicio.precio} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-primary">
                    {servicioForm.id ? 'Guardar cambios' : 'Guardar Servicio'}
                  </button>
                  {servicioForm.id && (
                    <button type="button" className="btn btn-outline"
                      onClick={() => { setServicioForm(SERVICIO_VACIO); setErroresServicio({}); }}>
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            </div>

            <div className="card">
              <h3>Catálogo de Servicios ({servicios.length})</h3>
              <div className="tabla-scroll">
                <table>
                  <thead>
                    <tr><th>Servicio</th><th>Duración</th><th>Costo</th><th>Acciones</th></tr>
                  </thead>
                  <tbody>
                    {servicios.map((srv) => (
                      <tr key={srv._id}>
                        <td>
                          <strong>{srv.nombre}</strong>
                          <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{srv.descripcion}</div>
                        </td>
                        <td>{srv.duracionMinutos} min</td>
                        <td>S/ {srv.precio}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-outline btn-sm" onClick={() => {
                              setErroresServicio({});
                              setServicioForm({
                                id: srv._id, nombre: srv.nombre, descripcion: srv.descripcion || '',
                                duracionMinutos: srv.duracionMinutos, precio: srv.precio
                              });
                            }}>Editar</button>
                            <button className="btn btn-danger btn-sm" onClick={() => eliminarServicio(srv)}>Eliminar</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
