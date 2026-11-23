export const ESTADOS_ACTIVOS = ['programada', 'confirmada'];

export const ETIQUETA_ESTADO = {
  programada: 'Programada',
  confirmada: 'Confirmada',
  completada: 'Completada',
  cancelada: 'Cancelada',
  no_asistio: 'No asistió'
};

export const COLOR_ESTADO = {
  programada: '#2563eb',
  confirmada: '#16a34a',
  completada: '#64748b',
  cancelada: '#dc2626',
  no_asistio: '#d97706'
};

const pad = (n) => String(n).padStart(2, '0');

// Fecha local "YYYY-MM-DD" (evita el desfase de toISOString, que usa UTC)
export const fechaLocalYMD = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};

// Valor para <input type="datetime-local">
export const fechaHoraLocalInput = (d = new Date()) => {
  const x = new Date(d);
  return `${fechaLocalYMD(x)}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
};

export const rangoMesActual = () => {
  const hoy = new Date();
  return {
    fechaDesde: fechaLocalYMD(new Date(hoy.getFullYear(), hoy.getMonth(), 1)),
    fechaHasta: fechaLocalYMD(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0))
  };
};

export const formatearFechaHora = (iso) =>
  new Date(iso).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' });

export const formatearHora = (iso) =>
  new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false });

export const formatearFechaCorta = (ymd) =>
  new Date(`${ymd}T00:00:00`).toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' });

// Un profesional sin servicios asignados puede atender cualquier servicio
export const atiendeServicio = (profesional, servicioId) => {
  if (!servicioId) return true;
  const asignados = profesional.serviciosAsignados || [];
  return asignados.length === 0 || asignados.some((s) => String(s._id || s) === String(servicioId));
};

export const escaparHTML = (texto) =>
  String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
