const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // Para manejar archivos del sistema
const app = express(); // ¡<<<< ESTA LÍNEA ES CRUCIAL!
const PORT = process.env.PORT || 3000;

// Configuración de la base de datos SQLite
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log('Conectado a la base de datos SQLite.');
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                university TEXT,
                faculty TEXT,
                career TEXT
            )
        `, (err) => {
            if (err) {
                console.error('Error al crear la tabla "users":', err.message);
            } else {
                console.log('Tabla "users" creada o ya existe.');
            }
        });

        db.run(`
    CREATE TABLE IF NOT EXISTS apuntes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,  -- <<<<<<<< ¡Esta línea es clave!
        title TEXT NOT NULL,
        description TEXT,
        university TEXT NOT NULL,
        faculty TEXT NOT NULL,
        career TEXT NOT NULL,
        subject TEXT NOT NULL,
        file_path TEXT NOT NULL,
        upload_date TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
`, (err) => {
    if (err) {
        console.error('Error al crear la tabla "apuntes":', err.message);
    } else {
        console.log('Tabla "apuntes" creada o ya existe.');
    }
});
    }
});

// Configuración de Express y EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Servir archivos estáticos (CSS, JS, imágenes, etc.)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Para servir los archivos de apuntes

// Middleware para parsear cuerpos de solicitud
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Configuración de sesión
app.use(session({
    secret: 'tu_secreto_muy_seguro', // Cambia esto por una cadena más compleja en producción
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 horas
}));

// Middleware para pasar el objeto 'user' a todas las vistas EJS
app.use((req, res, next) => {
    res.locals.user = req.session.user;
    next();
});

// Middleware para proteger rutas (autenticación)
function isAuthenticated(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Configuración de Multer para la subida de archivos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads/';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// API de Universidades
app.get('/api/universidades', (req, res) => {
    const universidadesData = require('./data/universidades'); // Asegúrate de que esta ruta sea correcta
    res.json(universidadesData);
});

// RUTAS

// Ruta de inicio
app.get('/', (req, res) => {
    res.render('index');
});

// Ruta de registro (GET)
app.get('/register', (req, res) => {
    res.render('register');
});

// Ruta de registro (POST)
app.post('/register', async (req, res) => {
    const { username, email, password, university, faculty, career } = req.body;

    if (!username || !email || !password || !university || !faculty || !career) {
        return res.render('register', { error: 'Por favor, completa todos los campos.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(
            'INSERT INTO users (username, email, password, university, faculty, career) VALUES (?, ?, ?, ?, ?, ?)',
            [username, email, hashedPassword, university, faculty, career],
            function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.render('register', { error: 'El nombre de usuario o email ya están registrados.' });
                    }
                    console.error('Error al registrar usuario:', err.message);
                    return res.render('register', { error: 'Error al registrar el usuario.' });
                }
                res.redirect('/login');
            }
        );
    } catch (error) {
        console.error('Error en el hash de la contraseña:', error);
        res.render('register', { error: 'Error interno del servidor.' });
    }
});

// Ruta de login (GET)
app.get('/login', (req, res) => {
    res.render('login', { error: req.session.error }); // Pasa errores de sesión si existen
    req.session.error = null; // Limpia el error después de mostrarlo
});

// Ruta de login (POST)
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        req.session.error = 'Por favor, ingresa tu email y contraseña.';
        return res.redirect('/login');
    }

    db.get('SELECT * FROM users WHERE email = ? OR username = ?', [email, email], async (err, user) => {
        if (err) {
            console.error('Error en la consulta de login:', err.message);
            req.session.error = 'Error interno del servidor.';
            return res.redirect('/login');
        }
        if (!user) {
            req.session.error = 'Email/usuario o contraseña incorrectos.';
            return res.redirect('/login');
        }

        const match = await bcrypt.compare(password, user.password);
        if (match) {
            req.session.user = {
                id: user.id,
                username: user.username,
                email: user.email,
                university: user.university,
                faculty: user.faculty,
                career: user.career
            };
            res.redirect('/profile'); // Redirigir al perfil después del login exitoso
        } else {
            req.session.error = 'Email/usuario o contraseña incorrectos.';
            res.redirect('/login');
        }
    });
});

// Ruta de logout
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Error al cerrar sesión:', err);
            return res.redirect('/');
        }
        res.clearCookie('connect.sid'); // Limpiar la cookie de sesión
        res.redirect('/login');
    });
});

// Ruta para el perfil del usuario
app.get('/profile', isAuthenticated, (req, res) => {
    // Asegurarse de que el usuario esté autenticado y su sesión contenga el ID
    if (!req.session.user || !req.session.user.id) {
        return res.redirect('/login'); // Redirige si no hay usuario o ID de usuario en la sesión
    }

    const userId = req.session.user.id;

    // Consultar los apuntes subidos por este usuario
    db.all('SELECT * FROM apuntes WHERE user_id = ? ORDER BY upload_date DESC', [userId], (err, userApuntes) => {
        if (err) {
            console.error('Error al obtener apuntes del usuario:', err.message);
            return res.render('profile', { 
                user: req.session.user, 
                userApuntes: [], // Pasa un array vacío en caso de error para evitar ReferenceError
                error: 'Error al cargar tus apuntes.' 
            });
        }
        
        res.render('profile', { 
            user: req.session.user, 
            userApuntes: userApuntes 
        });
    });
});

// Ruta para subir apunte (GET)
app.get('/subir-apunte', isAuthenticated, (req, res) => {
    res.render('subir-apunte');
});

// Ruta para subir apunte (POST)
app.post('/subir-apunte', isAuthenticated, upload.single('file'), (req, res) => {
    const { title, description, university, faculty, career, subject } = req.body;
    const userId = req.session.user.id;
    const filePath = req.file ? '/uploads/' + req.file.filename : null;

    if (!title || !university || !faculty || !career || !subject || !filePath) {
        // Eliminar el archivo si algo falla en la DB para evitar huérfanos
        if (filePath && fs.existsSync(path.join(__dirname, filePath))) {
            fs.unlinkSync(path.join(__dirname, filePath));
        }
        return res.render('subir-apunte', { error: 'Por favor, completa todos los campos y sube un archivo.' });
    }

    db.run(
        'INSERT INTO apuntes (user_id, title, description, university, faculty, career, subject, file_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [userId, title, description, university, faculty, career, subject, filePath],
        function (err) {
            if (err) {
                console.error('Error al guardar el apunte:', err.message);
                // Eliminar el archivo si falla la inserción en la DB
                if (filePath && fs.existsSync(path.join(__dirname, filePath))) {
                    fs.unlinkSync(path.join(__dirname, filePath));
                }
                return res.render('subir-apunte', { error: 'Error al guardar el apunte en la base de datos.' });
            }
            res.redirect('/profile'); // Redirigir al perfil o a una página de éxito
        }
    );
});


// Ruta para buscar apuntes
app.get('/buscar', async (req, res) => {
    const query = req.query.q || ''; 
    const universityFilter = req.query.university || ''; 
    const facultyFilter = req.query.faculty || '';     
    const careerFilter = req.query.career || '';       
    const subjectFilter = req.query.subject || '';     

    let sql = `
        SELECT a.*, u.username 
        FROM apuntes a
        JOIN users u ON a.user_id = u.id
        WHERE 1=1
    `;
    const params = [];

    if (query) {
        sql += ` AND (a.title LIKE ? OR a.description LIKE ? OR a.subject LIKE ?)`;
        params.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }
    if (universityFilter) {
        sql += ` AND a.university = ?`;
        params.push(universityFilter);
    }
    if (facultyFilter) {
        sql += ` AND a.faculty = ?`;
        params.push(facultyFilter);
    }
    if (careerFilter) {
        sql += ` AND a.career = ?`;
        params.push(careerFilter);
    }
    if (subjectFilter) {
        sql += ` AND a.subject LIKE ?`;
        params.push(`%${subjectFilter}%`);
    }

    sql += ` ORDER BY a.upload_date DESC`;

    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error(err.message);
            return res.render('buscar', { 
                user: req.session.user, 
                apuntes: [], 
                query: query,
                university: universityFilter,
                faculty: facultyFilter,
                career: careerFilter,
                subject: subjectFilter
            });
        }
        res.render('buscar', { 
            user: req.session.user, 
            apuntes: rows, 
            query: query,
            university: universityFilter,
            faculty: facultyFilter,
            career: careerFilter,
            subject: subjectFilter
        });
    });
});

// Ruta para ver un apunte específico
app.get('/apuntes/:id', async (req, res) => {
    const apunteId = req.params.id;

    db.get(`
        SELECT a.*, u.username 
        FROM apuntes a
        JOIN users u ON a.user_id = u.id
        WHERE a.id = ?
    `, [apunteId], (err, apunte) => {
        if (err) {
            console.error('Error al obtener el apunte:', err.message);
            return res.status(500).send('Error al cargar el apunte.');
        }
        if (!apunte) {
            return res.status(404).send('Apunte no encontrado.');
        }

        // Renderiza la vista del apunte, pasando los datos
        res.render('apunte-detalle', {
            user: req.session.user,
            apunte: apunte
        });
    });
});


// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});