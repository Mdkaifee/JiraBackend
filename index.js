// index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');

const connectDB = require('./db');
const authRoutes = require('./routes/auth');
const swaggerSpec = require('./swagger');

const app = express();

// middlewares
app.use(cors());
app.use(express.json());
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));

// routes
app.use('/auth', authRoutes);

app.get('/', (req, res) => {
  res.send('API is running');
});

// start
const PORT = process.env.PORT || 5000;
connectDB().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
