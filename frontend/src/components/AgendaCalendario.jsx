import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import esLocale from '@fullcalendar/core/locales/es';
import { COLOR_ESTADO, ETIQUETA_ESTADO, ESTADOS_ACTIVOS } from '../utils/citas';

// HU-08: agenda en vistas diaria, semanal y mensual con arrastrar y soltar
export default function AgendaCalendario({ citas, puedeReprogramar, onReprogramar, onVerDetalle }) {
  const eventos = citas.map((cita) => {
    const editable = puedeReprogramar && ESTADOS_ACTIVOS.includes(cita.estado) && new Date(cita.fechaInicio) > new Date();
    return {
      id: cita._id,
      title: `${cita.clienteId?.nombre || 'Cliente'} · ${cita.servicioId?.nombre || 'Servicio'}`,
      start: cita.fechaInicio,
      end: cita.fechaFin,
      backgroundColor: COLOR_ESTADO[cita.estado],
      borderColor: COLOR_ESTADO[cita.estado],
      startEditable: editable,
      durationEditable: false,
      extendedProps: { cita }
    };
  });

  const manejarSoltar = async (info) => {
    const { cita } = info.event.extendedProps;
    if (info.event.start <= new Date()) {
      info.revert();
      return;
    }
    const ok = await onReprogramar(cita, { fechaInicio: info.event.start.toISOString() });
    if (!ok) info.revert();
  };

  return (
    <div className="calendario">
      <div className="leyenda-estados">
        {Object.entries(ETIQUETA_ESTADO).map(([estado, etiqueta]) => (
          <span key={estado}>
            <i style={{ background: COLOR_ESTADO[estado] }} /> {etiqueta}
          </span>
        ))}
      </div>
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        locale={esLocale}
        initialView="timeGridWeek"
        headerToolbar={{ left: 'prev,next today', center: 'title', right: 'timeGridDay,timeGridWeek,dayGridMonth' }}
        buttonText={{ today: 'Hoy', day: 'Día', week: 'Semana', month: 'Mes' }}
        events={eventos}
        eventDrop={manejarSoltar}
        eventClick={(info) => onVerDetalle(info.event.extendedProps.cita)}
        slotMinTime="06:00:00"
        slotMaxTime="22:00:00"
        allDaySlot={false}
        nowIndicator
        height="auto"
        eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
      />
    </div>
  );
}
