# ReservaSaaS — Sistema Multi-Tenant de Reservas y Citas (MERN + PWA)

![Estado](https://img.shields.io/badge/Estado-Producci%C3%B3n-success)
![Stack](https://img.shields.io/badge/Stack-MERN%20%2B%20PWA-blue)
![Arquitectura](https://img.shields.io/badge/Arquitectura-Multi--Tenant%20SaaS-indigo)
![RBAC](https://img.shields.io/badge/Seguridad-JWT%20%2B%20RBAC-orange)

**ReservaSaaS** es una Aplicación Web Progresiva (**PWA**) desarrollada con el stack **MERN** (*MongoDB, Express.js, React y Node.js*) diseñada bajo una arquitectura **Multi-Tenant** con aislamiento lógico de datos y control de acceso basado en roles (**RBAC**). Permite a múltiples empresas o centros de atención (clínicas, consultorios, barberías, estudios, etc.) gestionar sus clientes, profesionales, servicios, agendas, indicadores de rendimiento y operación sin conexión (*Offline-First*).

---

## Tabla de Contenidos

1. [Arquitectura y Stack Tecnológico](#1-arquitectura-y-stack-tecnológico)
2. [Estructura del Proyecto](#2-estructura-del-proyecto)
3. [Requisitos Previos](#3-requisitos-previos)
4. [Guía de Instalación y Ejecución Paso a Paso](#4-guía-de-instalación-y-ejecución-paso-a-paso)
5. [Matriz de Historias de Usuario Implementadas (HU-01 a HU-15)](#5-matriz-de-historias-de-usuario-implementadas-hu-01-a-hu-15)
6. [Capacidades PWA (Instalabilidad y Modo Offline)](#6-capacidades-pwa-instalabilidad-y-modo-offline)
7. [Seguridad, Validaciones y Gobernanza de Datos](#7-seguridad-validaciones-y-gobernanza-de-datos)

---

## 1. Arquitectura y Stack Tecnológico

* **Frontend (SPA + PWA):** React 19, Vite, CSS propio, FullCalendar (agenda día/semana/mes con arrastrar y soltar), SweetAlert2 (confirmaciones), React-Toastify (notificaciones), Validator.js (validación de formularios), Web App Manifest (`manifest.json`) y Service Worker nativo (`sw.js`) con estrategia *Network-First* para la API y *Cache-First* para estáticos.
* **Backend (API RESTful):** Node.js, Express.js 5, JSON Web Tokens (`jsonwebtoken`) para autenticación stateless, `bcryptjs` para cifrado de contraseñas y `validator` para validar correos.
* **Base de Datos en la Nube:** MongoDB Atlas con Mongoose ODM, índices compuestos por `tenantId` y validación de esquemas.
* **Aislamiento Multi-Tenant (`tenantId`):** Cada petición autenticada extrae el `tenantId` directamente del payload firmado del JWT en el middleware de autorización, garantizando que ninguna organización pueda consultar, modificar o eliminar registros de otra.

---

## 2. Estructura del Proyecto

```text
sistema-reservas-pwa/
├── backend/
│   ├── controllers/
│   │   ├── authController.js         # Registro de empresas (tenants) y login JWT multi-tenant
│   │   ├── crudController.js         # CRUD de Clientes, Empleados, Servicios e Indicadores
│   │   └── citaController.js         # Agenda, horarios libres, sugerencias, traslapes y estados
│   ├── middlewares/
│   │   └── authMiddleware.js         # Verificación JWT, inyección de tenantId y guardias RBAC
│   ├── models/
│   │   ├── Tenant.js                 # Esquema de organizaciones/empresas SaaS
│   │   ├── User.js                   # Esquema unificado (admin, recepcionista, profesional, cliente)
│   │   ├── Service.js                # Catálogo de servicios con duración y costo
│   │   └── Appointment.js            # Citas con historial de cambios y costo congelado
│   ├── routes/
│   │   └── apiRoutes.js              # Endpoints REST protegidos por rol
│   ├── .env                          # Variables de entorno locales (ignorado por Git)
│   ├── index.js                      # Punto de entrada del servidor Express y conexión Atlas
│   └── package.json
├── frontend/
│   ├── public/
│   │   ├── icon.svg                  # Ícono vectorial adaptativo de la PWA
│   │   ├── manifest.json             # Manifiesto de instalación (standalone)
│   │   └── sw.js                     # Service Worker para caché estático y resiliencia offline
│   ├── src/
│   │   ├── App.jsx                   # Interfaz: módulos CRUD, agenda, filtros e indicadores
│   │   ├── components/
│   │   │   └── AgendaCalendario.jsx  # Calendario FullCalendar (HU-08)
│   │   ├── services/api.js           # Cliente Axios con token JWT y manejo de sesión expirada
│   │   ├── utils/citas.js            # Estados, colores y utilidades de fecha
│   │   ├── main.jsx                  # Registro del Service Worker y montaje de React
│   │   └── index.css                 # Estilos de la aplicación
│   ├── index.html                    # Metadatos PWA y enlace al manifest
│   └── package.json
├── Rubricas/                         # Rúbrica, guía Gherkin y Excel de HU y criterios de aceptación
├── .gitignore                        # Exclusión de node_modules, dist y archivos .env
└── README.md                         # Documentación técnica del sistema
```

---

## 3. Requisitos Previos

Antes de ejecutar el proyecto en una máquina local, asegúrate de contar con:

1. **Node.js** versión `18.0` o superior (`node -v`).
2. **npm** versión `9.0` o superior (`npm -v`).
3. **Git** instalado para clonar el repositorio.
4. Una cuenta en **MongoDB Atlas** con un clúster activo y acceso de red habilitado (`0.0.0.0/0` en *Network Access* para pruebas en equipo).

---

## 4. Guía de Instalación y Ejecución Paso a Paso

### Paso 1: Clonar el repositorio
```bash
git clone https://github.com/Fire-lang321/sistema-reservas-pwa.git
cd sistema-reservas-pwa
```

### Paso 2: Configurar e iniciar el Backend
Abre una terminal en la carpeta `backend`:
```bash
cd backend
npm install
```

Crea un archivo llamado **`.env`** dentro de `backend/` (`backend/.env`) con las siguientes variables:
```env
PORT=4000
MONGO_URI=mongodb+srv://<usuario>:<password>@<cluster>.mongodb.net/reservas_saas?retryWrites=true&w=majority
JWT_SECRET=clave_secreta_super_segura_2026
TZ=America/Lima
```

> `TZ` define la zona horaria con la que se evalúan las jornadas laborales y los rangos de fechas (por defecto `America/Lima`).

Inicia el servidor en modo desarrollo:
```bash
npx nodemon index.js
```
> Si la configuración es correcta, la consola mostrará:
> `✅ Conectado exitosamente a MongoDB Atlas`
> `🚀 Servidor Backend corriendo en http://localhost:4000`

### Paso 3: Configurar e iniciar el Frontend (Desarrollo)
Abre una **segunda terminal** en la carpeta `frontend`:
```bash
cd frontend
npm install
npm run dev
```
> Abre en tu navegador: **`http://localhost:5173`**

### Paso 4: Compilar y probar en Modo Producción PWA (Instalable + Offline)
Para probar el `Service Worker` compilado y la instalación de escritorio/móvil:
```bash
cd frontend
npm run build
npm run preview
```
> Abre en Google Chrome: **`http://localhost:4173`**

---

## 5. Matriz de Historias de Usuario Implementadas (HU-01 a HU-15)

La numeración y los criterios de aceptación (Gherkin) coinciden con el Excel `Rubricas/Sistema web de reserva de citas_usuario_y_criterios_de_aceptación.xlsx`.

| Código | Historia de Usuario / Módulo | Descripción Funcional Implementada |
| :--- | :--- | :--- |
| **HU-01** | Gestión de Clientes | Registro, edición parcial, listado y desactivación lógica con DNI (8 dígitos, único por organización), correo válido y teléfono (9 dígitos). |
| **HU-02** | Gestión de Empleados | Alta de personal (`admin`, `recepcionista`, `profesional`) con especialidad, **servicios que atiende** y jornada (`horarioInicio` - `horarioFin`); filtro por especialidad y advertencia por citas futuras al desactivar. |
| **HU-03** | Catálogo de Servicios | Duración en minutos (`> 0`) y costo (`>= 0`); el cambio de costo solo afecta citas nuevas (costo congelado); eliminación lógica que preserva el historial. |
| **HU-04** | Registro de Citas | Reserva por recepción o por el cliente desde su portal; hora de fin calculada con la duración del servicio; valida jornada laboral y que el empleado ofrezca el servicio. |
| **HU-05** | Reprogramación de Citas | Cambio de fecha/hora y/o empleado (que ofrezca el mismo servicio); si hay conflicto sugiere los 3 horarios libres más cercanos; historial de cada cambio. |
| **HU-06** | Cancelación de Citas | Motivo obligatorio, liberación inmediata del horario, advertencia si faltan menos de 2 horas y bloqueo de citas ya atendidas. |
| **HU-07** | Consulta de Disponibilidad | Bloques libres cada 30 min según jornada, duración del servicio y citas existentes; agrupados por empleado calificado; sugiere fechas cercanas si el día está lleno. |
| **HU-08** | Calendario Interactivo | FullCalendar con vistas Día/Semana/Mes, colores por estado, arrastrar y soltar para reprogramar y detalle de la cita al hacer clic. |
| **HU-09** | Prevención de Traslapes | Regla `inicioA < finB && finA > inicioB` en creación y reprogramación; los horarios consecutivos sí se permiten. |
| **HU-10** | Ciclo de Vida de la Cita | `programada` → `confirmada` → `completada` / `cancelada` / `no_asistio` con transiciones validadas, permisos por rol e historial; las inasistencias alimentan los indicadores. |
| **HU-11** | Control de Acceso (RBAC) | Rutas de la API y pestañas de la UI según rol; profesionales y clientes solo operan sobre sus propias citas; 401 cierra la sesión. |
| **HU-12** | Búsqueda y Filtros | Filtros combinables por cliente (nombre o DNI), empleado, servicio, estado y rango de fechas validado. |
| **HU-13** | Dashboard e Indicadores | Por defecto el mes en curso: total de citas, activas, completadas, canceladas, inasistencias, ingresos estimados, Top Servicios y Top Clientes. |
| **HU-14** | Validación y Mensajes | Errores por campo ("Este campo es obligatorio", "Formato de correo inválido" con Validator.js), confirmaciones SweetAlert2 y notificaciones Toastify sin detalles técnicos. |
| **HU-15** | Arquitectura Multi-Tenant | Aislamiento por `tenantId` en todas las consultas; el acceso a recursos de otra organización responde 404; un mismo correo puede existir en varias organizaciones. |

---

## 6. Capacidades PWA (Instalabilidad y Modo Offline)

1. **Web App Manifest (`frontend/public/manifest.json`):** Configurado con `display: "standalone"`, `theme_color: "#2563eb"`, `start_url: "/"` e ícono SVG adaptativo (`icon.svg`).
2. **Service Worker (`frontend/public/sw.js`):**
   * Pre-cachea los recursos críticos en el evento `install` y limpia versiones antiguas en `activate`.
   * Aplica estrategia *Network-First* para peticiones `/api/` y recursos dinámicos, sirviendo respuestas desde caché cuando se pierde la conexión a internet.
3. **Experiencia Offline en UI:** Detecta eventos `online`/`offline` del navegador, muestra un banner informativo de **Modo Sin Conexión** y mantiene consultables las últimas respuestas de la API guardadas por el Service Worker (se eliminan al cerrar sesión).

---

## 7. Seguridad, Validaciones y Gobernanza de Datos

* **Expresiones Regulares Estrictas:**
  * Nombres y especialidades: `/^[A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]+$/` (solo letras y espacios).
  * Documento de identidad (DNI): `/^\d{8}$/` (exactamente 8 dígitos numéricos).
  * Teléfono móvil: `/^\d{9}$/` (exactamente 9 dígitos numéricos).
* **Protección de Credenciales:** Las contraseñas se almacenan encriptadas mediante `bcrypt` (10 rondas de sal) y nunca se devuelven en las respuestas JSON (`.select('-password')`).
* **Integridad Referencial Histórica:** Las bajas de clientes, empleados y servicios se realizan mediante borrado lógico (`activo: false`) para mantener íntegros los reportes históricos e indicadores financieros.
* **Contraseña inicial de clientes:** si la recepción no define una contraseña, el cliente ingresa a su portal con su correo y su DNI como contraseña inicial.
* **Zona horaria:** las jornadas laborales y los rangos de fechas se evalúan en la zona `TZ` del servidor (por defecto `America/Lima`).
