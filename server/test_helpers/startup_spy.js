// Spy module used exclusively by test_isolation.js to verify genuine server.js startup
// Intercepts mongoose.connect to inspect MONGODB_URI and exits before opening DB connection or starting listener.
const mongoose = require('mongoose');
mongoose.connect = function(uri) {
  process.stdout.write(`HOOKED_URI:${uri}\n`);
  process.exit(0);
};
