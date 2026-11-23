const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  nombre: { type: String, required: true, trim: true },
  descripcion: { type: String, trim: true },
  duracionMinutos: { type: Number, required: true, min: 1 },
  precio: { type: Number, required: true, min: 0 },
  activo: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Service', serviceSchema);