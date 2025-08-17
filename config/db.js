const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const options = {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 0, // Disable socket timeout
      connectTimeoutMS: 30000,
      family: 4,
      maxPoolSize: 10,
      retryWrites: true,
      retryReads: true,
      bufferCommands: false,
      bufferMaxEntries: 0,
    };

    await mongoose.connect(process.env.MONGO_URI, options);
    console.log('MongoDB Connected...');

    // Handle connection errors after initial connection
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected. Attempting to reconnect...');
    });
    
  } catch (err) {
    console.error('Database connection error:', err.message);
    
    // Retry once after 2 seconds for ECONNRESET
    if (err.code === 'ECONNRESET' || err.message.includes('ECONNRESET')) {
      console.log('Retrying connection in 2 seconds...');
      setTimeout(() => connectDB(), 2000);
      return;
    }
    
    process.exit(1);
  }
};

module.exports = connectDB;