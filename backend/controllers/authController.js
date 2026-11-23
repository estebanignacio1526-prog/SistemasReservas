const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const Tenant = require('../models/Tenant');
const User = require('../models/User');

const SOLO_LETRAS = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]+$/;
const TELEFONO_9_DIGITOS = /^\d{9}$/;

const generarToken = (usuario) => {
  return jwt.sign(
    { id: usuario._id, tenantId: usuario.tenantId, rol: usuario.rol },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );
};

const registrarEmpresa = async (req, res) => {
  try {
    const { nombreEmpresa, rubro, telefono, nombreAdmin, email, password } = req.body;

    if (!nombreEmpresa || !nombreAdmin || !email || !password) {
      return res.status(400).json({ mensaje: 'Todos los campos obligatorios deben completarse.' });
    }
    if (!SOLO_LETRAS.test(nombreAdmin.trim())) {
      return res.status(400).json({ mensaje: 'El nombre del administrador solo debe contener letras.' });
    }
    if (telefono && !TELEFONO_9_DIGITOS.test(telefono.trim())) {
      return res.status(400).json({ mensaje: 'El teléfono debe tener exactamente 9 dígitos numéricos.' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ mensaje: 'Formato de correo inválido.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ mensaje: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    // HU-15 (escenario 3): MongoDB genera un identificador único (ObjectId) para la nueva organización
    const nuevoTenant = await Tenant.create({ nombre: nombreEmpresa.trim(), rubro, telefono });
    const passwordHash = await bcrypt.hash(password, 10);

    let admin;
    try {
      admin = await User.create({
        tenantId: nuevoTenant._id,
        nombre: nombreAdmin.trim(),
        email: email.toLowerCase().trim(),
        password: passwordHash,
        telefono: telefono ? telefono.trim() : '',
        rol: 'admin'
      });
    } catch (errorUsuario) {
      await Tenant.deleteOne({ _id: nuevoTenant._id }); // evita organizaciones huérfanas
      throw errorUsuario;
    }

    const token = generarToken(admin);
    res.status(201).json({
      mensaje: 'Empresa registrada con éxito.',
      token,
      usuario: {
        id: admin._id,
        nombre: admin.nombre,
        email: admin.email,
        rol: admin.rol,
        tenantId: nuevoTenant._id,
        empresa: nuevoTenant.nombre
      }
    });
  } catch (error) {
    console.error('Error en registrarEmpresa:', error);
    // HU-14 (escenario 3): no se exponen detalles técnicos internos
    res.status(500).json({ mensaje: 'Error al registrar la empresa.' });
  }
};

const login = async (req, res) => {
  try {
    const { email, password, tenantId } = req.body;
    if (!email || !password) {
      return res.status(400).json({ mensaje: 'Ingresa correo y contraseña.' });
    }

    const filtro = { email: String(email).toLowerCase().trim(), activo: true };
    if (tenantId) filtro.tenantId = tenantId;

    // Multi-tenant: un mismo correo puede existir en varias organizaciones;
    // se valida la contraseña contra cada cuenta activa hasta encontrar la correcta
    const candidatos = await User.find(filtro).populate('tenantId', 'nombre rubro activo');
    let usuario = null;
    for (const candidato of candidatos) {
      if (candidato.tenantId?.activo === false) continue;
      if (await bcrypt.compare(password, candidato.password)) {
        usuario = candidato;
        break;
      }
    }

    if (!usuario) {
      return res.status(401).json({ mensaje: 'Credenciales incorrectas o usuario inactivo.' });
    }

    const token = generarToken(usuario);
    res.json({
      token,
      usuario: {
        id: usuario._id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
        tenantId: usuario.tenantId._id,
        empresa: usuario.tenantId.nombre
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ mensaje: 'Error interno al iniciar sesión.' });
  }
};

module.exports = { registrarEmpresa, login };