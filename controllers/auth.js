const User = require('../models/User');
const jwt = require('jsonwebtoken');

// Custom asyncHandler to replace express-async-handler if not installed
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Utility function to send token response
const sendTokenResponse = (user, statusCode, res) => {
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE
  });

  const options = {
    expires: new Date(Date.now() + process.env.JWT_COOKIE_EXPIRE * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  };

  res
    .status(statusCode)
    .cookie('token', token, options)
    .json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
exports.register = asyncHandler(async (req, res, next) => {
  console.log('Registration attempt:', req.body); // Debug log
  
  try {
    const { username, email, password } = req.body;
    
    // Validate input
    if (!username || !email || !password) {
      console.log('Missing fields:', { username, email, password: !!password });
      return res.status(400).json({ 
        success: false,
        error: 'Please provide all required fields' 
      });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long'
      });
    }

    // Check if user exists by email
    const existingUserByEmail = await User.findOne({ email });
    if (existingUserByEmail) {
      console.log('Email already exists:', email);
      return res.status(400).json({
        success: false,
        error: 'Email already exists'
      });
    }

    // Check if user exists by username
    const existingUserByUsername = await User.findOne({ username });
    if (existingUserByUsername) {
      console.log('Username already exists:', username);
      return res.status(400).json({
        success: false,
        error: 'Username already exists'
      });
    }

    console.log('Creating new user...');
    // Create user
    const user = await User.create({ username, email, password });
    console.log('User created successfully:', user.username);
    
    // Send token response instead of just user data
    sendTokenResponse(user, 201, res);

  } catch (error) {
    console.error('Registration error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });

    // Handle specific mongoose errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        error: messages.join(', ')
      });
    }

    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({
        success: false,
        error: `${field} already exists`
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Server error during registration',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = asyncHandler(async (req, res, next) => {
  console.log('Login attempt for:', req.body.email); // Debug log
  
  const { email, password } = req.body;

  // Validate email & password
  if (!email || !password) {
    console.log('Missing email or password');
    return res.status(400).json({ 
      success: false, 
      error: 'Please provide email and password' 
    });
  }

  try {
    // Check for user - explicitly select password
    console.log('Looking for user with email:', email);
    const user = await User.findOne({ email }).select('+password');
    
    if (!user) {
      console.log('User not found with email:', email);
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid credentials' 
      });
    }

    console.log('User found, checking password...');
    // Check if password matches
    const isMatch = await user.matchPassword(password);
    console.log('Password match result:', isMatch);
    
    if (!isMatch) {
      console.log('Password does not match for user:', email);
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid credentials' 
      });
    }

    console.log('Login successful for user:', user.username);
    sendTokenResponse(user, 200, res);

  } catch (error) {
    console.error('Login error details:', {
      message: error.message,
      stack: error.stack
    });
    
    return res.status(500).json({
      success: false,
      error: 'Server error during login'
    });
  }
});

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  res.status(200).json({
    success: true,
    data: user
  });
});

// @desc    Log user out / clear cookie
// @route   GET /api/auth/logout
// @access  Private
exports.logout = asyncHandler(async (req, res, next) => {
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 10 * 1000), // 10 seconds
    httpOnly: true
  });

  res.status(200).json({
    success: true,
    data: {}
  });
});

// @desc    Update user details
// @route   PUT /api/auth/updatedetails
// @access  Private
exports.updateDetails = asyncHandler(async (req, res, next) => {
  const fieldsToUpdate = {
    username: req.body.username,
    email: req.body.email
  };

  const user = await User.findByIdAndUpdate(req.user.id, fieldsToUpdate, {
    new: true,
    runValidators: true
  });

  res.status(200).json({
    success: true,
    data: user
  });
});

// @desc    Update password
// @route   PUT /api/auth/updatepassword
// @access  Private
exports.updatePassword = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id).select('+password');

  // Check current password
  if (!(await user.matchPassword(req.body.currentPassword))) {
    return res.status(401).json({ success: false, error: 'Password is incorrect' });
  }

  user.password = req.body.newPassword;
  await user.save();

  sendTokenResponse(user, 200, res);
});