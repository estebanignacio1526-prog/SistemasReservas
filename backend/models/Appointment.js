const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  clienteId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  profesionalId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  servicioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  fechaInicio: { type: Date, required: true },
  fechaFin: { type: Date, required: true },
  costoRegistrado: { type: Number, required: true }, // Congela el precio vigente (HU-03)
  estado: {
    type: String,
    enum: ['programada', 'confirmada', 'completada', 'cancelada', 'no_asistio'],
    default: 'programada'
  },
  motivoCancelacion: { type: String, trim: true },
  notas: { type: String, trim: true },
  historialCambios: [{
    accion: String,
    fecha: { type: Date, default: Date.now },
    detalle: String
  }]
}, { timestamps: true });

module.exports = mongoose.model('Appointment', appointmentSchema);