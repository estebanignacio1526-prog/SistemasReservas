const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  nombre: {
    type: String,
    required: true,
    trim: true
  },
  documento: {
    type: String,
    trim: true,
    default: ''
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  telefono: {
    type: String,
    trim: true,
    default: ''
  },
  rol: {
    type: String,
    enum: ['admin', 'recepcionista', 'profesional', 'cliente'],
    default: 'cliente'
  },
  especialidad: {
    type: String,
    trim: true,
    default: ''
  },
  serviciosAsignados: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service'
  }],
  horarioInicio: {
    type: String,
    default: '08:00'
  },
  horarioFin: {
    type: String,
    default: '18:00'
  },
  activo: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

// Índice compuesto: permite el mismo correo en distintas empresas (Multi-Tenant)
userSchema.index({ tenantId: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);