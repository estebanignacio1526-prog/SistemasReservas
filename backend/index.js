require('dotenv').config();
// Zona horaria de la organización: jornadas laborales y rangos de fechas se evalúan en hora local
process.env.TZ = process.env.TZ || 'America/Lima';

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const apiRoutes = require('./routes/apiRoutes');

const app = express();
app.use(cors());
app.use(express.json());

// Rutas principales de la API
app.use('/api', apiRoutes);

const PORT = process.env.PORT || 4000;

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ Conectado exitosamente a MongoDB Atlas');
    app.listen(PORT, () => {
      console.log(`🚀 Servidor Backend corriendo en http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Error de conexión a MongoDB:', err.message);
  });