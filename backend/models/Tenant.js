const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  nombre: {
    type: String,
    required: [true, 'El nombre de la empresa es obligatorio'],
    trim: true
  },
  rubro: {
    type: String,
    trim: true,
    default: 'General'
  },
  telefono: {
    type: String,
    trim: true
  },
  activo: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Tenant', tenantSchema);